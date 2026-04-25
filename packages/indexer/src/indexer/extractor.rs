use std::collections::HashMap;
use tree_sitter::Node;

use crate::protocol::{node_id, node_hash, EdgeType, GraphEdge, GraphNode, IndexResult, NodeType, ReExport};

pub struct Extractor<'src> {
    source: &'src [u8],
    rel_path: String,
    lang: String,
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
    re_exports: Vec<ReExport>,
    imported_names: HashMap<String, String>,
    file_node_id: String,
}

impl<'src> Extractor<'src> {
    pub fn new(rel_path: String, source: &'src [u8], lang: String) -> Self {
        let file_name = rel_path.split('/').last().unwrap_or(&rel_path).to_string();
        let file_id = node_id(&rel_path, "file", &file_name, 0);
        let line_count = source.iter().filter(|&&b| b == b'\n').count();
        let mut nodes = Vec::new();
        nodes.push(GraphNode {
            id: file_id.clone(),
            node_type: NodeType::File,
            name: file_name,
            file_path: rel_path.clone(),
            start_line: 0,
            end_line: line_count,
            language: lang.clone(),
            code_snippet: String::new(),
            node_hash: String::new(),
            metadata: serde_json::json!({}),
        });
        Self {
            source,
            rel_path,
            lang,
            nodes,
            edges: Vec::new(),
            re_exports: Vec::new(),
            imported_names: HashMap::new(),
            file_node_id: file_id,
        }
    }

    /// Iterative DFS using TreeCursor — avoids stack overflows on deep trees.
    pub fn walk(&mut self, root: Node) {
        let mut cursor = root.walk();
        loop {
            self.visit(cursor.node());
            if cursor.goto_first_child() {
                continue;
            }
            if cursor.goto_next_sibling() {
                continue;
            }
            loop {
                if !cursor.goto_parent() {
                    return;
                }
                if cursor.goto_next_sibling() {
                    break;
                }
            }
        }
    }

    fn visit(&mut self, node: Node) {
        match node.kind() {
            // TypeScript / JavaScript
            "function_declaration" | "method_declaration" | "function_definition" | "function_item"
                => self.handle_fn_decl(node, false),
            "method_definition" => self.handle_fn_decl(node, true),
            "class_declaration" | "class" | "class_definition" | "struct_item" | "enum_item"
                => self.handle_class(node),
            "interface_declaration" => self.handle_named_node(node, NodeType::Interface, "interface"),
            "type_alias_declaration" => self.handle_named_node(node, NodeType::TypeAlias, "type"),
            "import_statement" => self.handle_import(node),
            "variable_declarator" => self.handle_variable_declarator(node),
            "call_expression" => self.handle_call(node),
            "export_statement" => self.handle_export_stmt(node),
            "jsx_opening_element" | "jsx_self_closing_element" => self.handle_jsx(node),
            "pair" => self.handle_pair(node),
            _ => {}
        }
    }

    fn text<'a>(&'a self, node: Node<'src>) -> &'a str
    where
        'src: 'a,
    {
        node.utf8_text(self.source).unwrap_or("")
    }

    fn make_id(&self, kind: &str, name: &str, line: usize) -> String {
        node_id(&self.rel_path, kind, name, line)
    }

    fn snippet(&self, node: Node, max: usize) -> String {
        let start = node.start_byte();
        let end = (start + max).min(node.end_byte()).min(self.source.len());
        String::from_utf8_lossy(&self.source[start..end]).into_owned()
    }

    fn push_fn_node(&mut self, id: String, name: String, node: Node, meta: serde_json::Value) {
        let snip = self.snippet(node, 500);
        let hash = node_hash(&snip);
        self.nodes.push(GraphNode {
            id: id.clone(),
            node_type: NodeType::Function,
            name,
            file_path: self.rel_path.clone(),
            start_line: node.start_position().row,
            end_line: node.end_position().row,
            language: self.lang.clone(),
            code_snippet: snip,
            node_hash: hash,
            metadata: meta,
        });
        self.edges.push(GraphEdge {
            source_id: self.file_node_id.clone(),
            target_id: id,
            edge_type: EdgeType::Exports,
        });
    }

    fn handle_fn_decl(&mut self, node: Node, is_method: bool) {
        let name_node = match node.child_by_field_name("name") {
            Some(n) => n,
            None => return,
        };
        let name = self.text(name_node).to_string();
        if name.is_empty() {
            return;
        }
        let id = self.make_id("function", &name, node.start_position().row);
        let meta = if is_method {
            serde_json::json!({"method": true})
        } else {
            serde_json::json!({})
        };
        self.push_fn_node(id, name, node, meta);
    }

    fn handle_class(&mut self, node: Node) {
        let name_node = match node.child_by_field_name("name") {
            Some(n) => n,
            None => return,
        };
        let name = self.text(name_node).to_string();
        if name.is_empty() {
            return;
        }
        let id = self.make_id("class", &name, node.start_position().row);
        let snip = self.snippet(node, 500);
        let hash = node_hash(&snip);
        self.nodes.push(GraphNode {
            id: id.clone(),
            node_type: NodeType::Class,
            name: name.clone(),
            file_path: self.rel_path.clone(),
            start_line: node.start_position().row,
            end_line: node.end_position().row,
            language: self.lang.clone(),
            code_snippet: snip,
            node_hash: hash,
            metadata: serde_json::json!({}),
        });
        self.edges.push(GraphEdge {
            source_id: self.file_node_id.clone(),
            target_id: id.clone(),
            edge_type: EdgeType::Exports,
        });

        // Inheritance: class Foo extends Bar
        let mut cur = node.walk();
        for child in node.children(&mut cur) {
            if child.kind() == "class_heritage" {
                let mut hc = child.walk();
                for h in child.children(&mut hc) {
                    if h.kind() == "extends_clause" {
                        if let Some(val) = h.child_by_field_name("value") {
                            let super_name = self.text(val).to_string();
                            let target = self
                                .resolve_import(&super_name)
                                .unwrap_or_else(|| self.make_id("class", &super_name, 0));
                            self.edges.push(GraphEdge {
                                source_id: id.clone(),
                                target_id: target,
                                edge_type: EdgeType::Extends,
                            });
                        }
                    }
                }
            }
        }
    }

    fn handle_named_node(&mut self, node: Node, ntype: NodeType, kind: &str) {
        let name_node = match node.child_by_field_name("name") {
            Some(n) => n,
            None => return,
        };
        let name = self.text(name_node).to_string();
        if name.is_empty() {
            return;
        }
        let id = self.make_id(kind, &name, node.start_position().row);
        self.nodes.push(GraphNode {
            id,
            node_type: ntype,
            name,
            file_path: self.rel_path.clone(),
            start_line: node.start_position().row,
            end_line: node.end_position().row,
            language: self.lang.clone(),
            code_snippet: String::new(),
            node_hash: String::new(),
            metadata: serde_json::json!({}),
        });
    }

    fn handle_import(&mut self, node: Node) {
        let source_node = match node.child_by_field_name("source") {
            Some(n) => n,
            None => return,
        };
        let raw = self.text(source_node);
        let module = raw.trim_matches(|c| c == '\'' || c == '"').to_string();
        if module.is_empty() {
            return;
        }

        let import_id = self.make_id("import", &module, node.start_position().row);
        let import_text = self.text(node).to_string();
        self.nodes.push(GraphNode {
            id: import_id.clone(),
            node_type: NodeType::Import,
            name: module.clone(),
            file_path: self.rel_path.clone(),
            start_line: node.start_position().row,
            end_line: node.end_position().row,
            language: self.lang.clone(),
            code_snippet: import_text,
            node_hash: String::new(),
            metadata: serde_json::json!({"module": module}),
        });
        self.edges.push(GraphEdge {
            source_id: self.file_node_id.clone(),
            target_id: import_id,
            edge_type: EdgeType::Imports,
        });

        // Track local name → module for call resolution
        let mut cur = node.walk();
        for child in node.children(&mut cur) {
            if child.kind() != "import_clause" {
                continue;
            }
            let mut cc = child.walk();
            for clause_child in child.children(&mut cc) {
                match clause_child.kind() {
                    "identifier" => {
                        let name = self.text(clause_child).to_string();
                        self.imported_names.insert(name, module.clone());
                    }
                    "named_imports" => {
                        let mut nc = clause_child.walk();
                        for spec in clause_child.children(&mut nc) {
                            if spec.kind() != "import_specifier" {
                                continue;
                            }
                            let alias = spec.child_by_field_name("alias");
                            let name_field = spec.child_by_field_name("name");
                            let local = alias
                                .or(name_field)
                                .map(|n| self.text(n).to_string())
                                .unwrap_or_default();
                            if local.is_empty() {
                                continue;
                            }
                            self.imported_names.insert(local.clone(), module.clone());

                            // Emit a per-symbol import node so FTS search by symbol
                            // name finds all importers, even those using barrel imports
                            // where the module path doesn't contain the symbol name.
                            let sym_id = self.make_id("import", &local, node.start_position().row);
                            let import_text = format!("import {{ {} }} from '{}'", local, module);
                            self.nodes.push(GraphNode {
                                id: sym_id.clone(),
                                node_type: NodeType::Import,
                                name: local.clone(),
                                file_path: self.rel_path.clone(),
                                start_line: node.start_position().row,
                                end_line: node.end_position().row,
                                language: self.lang.clone(),
                                code_snippet: import_text,
                                node_hash: String::new(),
                                metadata: serde_json::json!({"module": module, "symbol_import": true}),
                            });
                            self.edges.push(GraphEdge {
                                source_id: self.file_node_id.clone(),
                                target_id: sym_id,
                                edge_type: EdgeType::Imports,
                            });
                        }
                    }
                    "namespace_import" => {
                        let mut nc = clause_child.walk();
                        for ns_child in clause_child.children(&mut nc) {
                            if ns_child.kind() == "identifier" {
                                let name = self.text(ns_child).to_string();
                                self.imported_names.insert(name, module.clone());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    fn handle_variable_declarator(&mut self, node: Node) {
        let name_node = match node.child_by_field_name("name") {
            Some(n) => n,
            None => return,
        };
        let value_node = match node.child_by_field_name("value") {
            Some(n) => n,
            None => return,
        };
        let name = self.text(name_node).to_string();
        if name.is_empty() {
            return;
        }

        let is_direct_fn = matches!(value_node.kind(), "arrow_function" | "function");
        let is_wrapped = value_node.kind() == "call_expression"
            && name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false);

        if !is_direct_fn && !is_wrapped {
            return;
        }

        let id = self.make_id("function", &name, node.start_position().row);
        let (snip, hash) = if is_direct_fn {
            let s = self.snippet(node, 500);
            let h = node_hash(&s);
            (s, h)
        } else {
            (String::new(), String::new())
        };

        self.nodes.push(GraphNode {
            id: id.clone(),
            node_type: NodeType::Function,
            name,
            file_path: self.rel_path.clone(),
            start_line: node.start_position().row,
            end_line: node.end_position().row,
            language: self.lang.clone(),
            code_snippet: snip,
            node_hash: hash,
            metadata: serde_json::json!({"arrow": is_direct_fn, "wrapped": is_wrapped}),
        });
        self.edges.push(GraphEdge {
            source_id: self.file_node_id.clone(),
            target_id: id,
            edge_type: EdgeType::Exports,
        });
    }

    fn handle_call(&mut self, node: Node) {
        let func_node = match node.child_by_field_name("function") {
            Some(n) => n,
            None => return,
        };
        let callee_text = self.text(func_node);
        let callee = callee_text.split('.').last().unwrap_or(callee_text).to_string();

        if let Some(caller_id) = self.find_enclosing_fn(node) {
            let target = self
                .resolve_import(&callee)
                .unwrap_or_else(|| self.make_id("function", &callee, 0));
            self.edges.push(GraphEdge {
                source_id: caller_id,
                target_id: target,
                edge_type: EdgeType::Calls,
            });
        }
    }

    fn handle_export_stmt(&mut self, node: Node) {
        let source_node = match node.child_by_field_name("source") {
            Some(n) => n,
            None => return,
        };
        let raw = self.text(source_node);
        let source_mod = raw.trim_matches(|c| c == '\'' || c == '"');
        let resolved = if source_mod.starts_with('.') {
            let dir = std::path::Path::new(&self.rel_path)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            Some(normalize_path(&format!("{}/{}", dir, source_mod)))
        } else if let Some(rest) = source_mod.strip_prefix("@/") {
            Some(format!("src/{}", rest))
        } else {
            None
        };

        let base = match resolved {
            Some(b) => b,
            None => return,
        };

        let mut cur = node.walk();
        for child in node.children(&mut cur) {
            if child.kind() != "export_clause" {
                continue;
            }
            let mut ec = child.walk();
            for spec in child.children(&mut ec) {
                if spec.kind() != "export_specifier" {
                    continue;
                }
                if let Some(name_node) = spec.child_by_field_name("name") {
                    let source_name = self.text(name_node).to_string();
                    let exported_name = spec
                        .child_by_field_name("alias")
                        .map(|n| self.text(n).to_string())
                        .unwrap_or_else(|| source_name.clone());
                    if !source_name.is_empty() {
                        self.re_exports.push(ReExport {
                            barrel_file: self.rel_path.clone(),
                            exported_name,
                            source_name,
                            resolved_source_base: base.clone(),
                        });
                    }
                }
            }
        }
    }

    fn handle_jsx(&mut self, node: Node) {
        let name_node = match node.child_by_field_name("name") {
            Some(n) => n,
            None => return,
        };
        let full = self.text(name_node);
        let component = full.split('.').next().unwrap_or(full);
        if !component.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
            return;
        }

        if let Some(caller_id) = self.find_enclosing_fn(node) {
            let target = self
                .resolve_import(component)
                .unwrap_or_else(|| self.make_id("function", component, 0));
            self.edges.push(GraphEdge {
                source_id: caller_id,
                target_id: target,
                edge_type: EdgeType::Calls,
            });
        }
    }

    /// Index object-literal methods: `{ authenticate: () => {...} }`.
    fn handle_pair(&mut self, node: Node) {
        let key_node = match node.child_by_field_name("key") {
            Some(n) if n.kind() == "property_identifier" => n,
            _ => return,
        };
        let value_node = match node.child_by_field_name("value") {
            Some(n) => n,
            None => return,
        };
        if !matches!(value_node.kind(), "arrow_function" | "function" | "function_expression") {
            return;
        }
        let name = self.text(key_node).to_string();
        if name.is_empty() {
            return;
        }
        let id = self.make_id("function", &name, node.start_position().row);
        let snip = self.snippet(value_node, 500);
        let hash = node_hash(&snip);
        self.nodes.push(GraphNode {
            id: id.clone(),
            node_type: NodeType::Function,
            name,
            file_path: self.rel_path.clone(),
            start_line: node.start_position().row,
            end_line: node.end_position().row,
            language: self.lang.clone(),
            code_snippet: snip,
            node_hash: hash,
            metadata: serde_json::json!({"object_method": true}),
        });
        self.edges.push(GraphEdge {
            source_id: self.file_node_id.clone(),
            target_id: id,
            edge_type: EdgeType::Exports,
        });
    }

    /// Walk parent chain to find the enclosing function/method/component.
    fn find_enclosing_fn(&self, node: Node) -> Option<String> {
        let mut current = node.parent();
        while let Some(n) = current {
            match n.kind() {
                "function_declaration" | "method_definition" | "function"
                | "function_definition" | "function_item" | "method_declaration" => {
                    let name = n.child_by_field_name("name")?;
                    let name_str = name.utf8_text(self.source).ok()?;
                    return Some(self.make_id("function", name_str, n.start_position().row));
                }
                "arrow_function" => {
                    // Climb past arguments/call_expression wrappers to variable_declarator
                    let mut ancestor = n.parent();
                    while let Some(a) = ancestor {
                        match a.kind() {
                            "arguments" | "call_expression" => ancestor = a.parent(),
                            _ => break,
                        }
                    }
                    if let Some(a) = ancestor {
                        if a.kind() == "variable_declarator" {
                            let name = a.child_by_field_name("name")?;
                            let name_str = name.utf8_text(self.source).ok()?;
                            return Some(self.make_id("function", name_str, a.start_position().row));
                        }
                    }
                }
                _ => {}
            }
            current = n.parent();
        }
        None
    }

    fn resolve_base(&self, module: &str) -> Option<String> {
        if module.starts_with('.') {
            let dir = std::path::Path::new(&self.rel_path)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            Some(normalize_path(&format!("{}/{}", dir, module)))
        } else if let Some(rest) = module.strip_prefix("@/") {
            Some(format!("src/{}", rest))
        } else {
            None
        }
    }

    fn resolve_import(&self, name: &str) -> Option<String> {
        let module = self.imported_names.get(name)?;
        let base = self.resolve_base(module)?;
        Some(format!("{}:function:{}:0", base, name))
    }

    pub fn finish(self) -> IndexResult {
        IndexResult {
            nodes: self.nodes,
            edges: self.edges,
            re_exports: self.re_exports,
            skipped_files: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tree_sitter::{Language, Parser};

    fn parse_ts(source: &str) -> IndexResult {
        let lang: Language = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
        let mut parser = Parser::new();
        parser.set_language(&lang).unwrap();
        let tree = parser.parse(source, None).unwrap();
        let mut ex = Extractor::new("src/test.ts".to_string(), source.as_bytes(), "typescript".to_string());
        ex.walk(tree.root_node());
        ex.finish()
    }

    fn parse_tsx(source: &str) -> IndexResult {
        let lang: Language = tree_sitter_typescript::LANGUAGE_TSX.into();
        let mut parser = Parser::new();
        parser.set_language(&lang).unwrap();
        let tree = parser.parse(source, None).unwrap();
        let mut ex = Extractor::new("src/test.tsx".to_string(), source.as_bytes(), "tsx".to_string());
        ex.walk(tree.root_node());
        ex.finish()
    }

    // ── Improvement A: per-symbol import nodes ────────────────────────────────

    #[test]
    fn named_import_emits_per_symbol_node() {
        let r = parse_ts("import { useOpenSignIn } from '../hooks';");
        // One file node + one module-level import node + one per-symbol import node
        let sym_node = r.nodes.iter().find(|n| {
            matches!(n.node_type, NodeType::Import) && n.name == "useOpenSignIn"
        });
        assert!(sym_node.is_some(), "per-symbol import node missing for useOpenSignIn");
    }

    #[test]
    fn barrel_import_per_symbol_node_has_symbol_name_not_path() {
        let r = parse_ts("import { useOpenSignIn, useUser } from '../hooks';");
        let names: Vec<&str> = r.nodes.iter()
            .filter(|n| matches!(n.node_type, NodeType::Import) && n.metadata["symbol_import"] == true)
            .map(|n| n.name.as_str())
            .collect();
        assert!(names.contains(&"useOpenSignIn"), "expected useOpenSignIn symbol node");
        assert!(names.contains(&"useUser"), "expected useUser symbol node");
    }

    #[test]
    fn default_import_does_not_emit_per_symbol_node() {
        let r = parse_ts("import React from 'react';");
        let sym_nodes: Vec<_> = r.nodes.iter()
            .filter(|n| matches!(n.node_type, NodeType::Import) && n.metadata["symbol_import"] == true)
            .collect();
        assert!(sym_nodes.is_empty(), "default imports should not emit per-symbol nodes");
    }

    // ── Improvement C: object-method nodes ───────────────────────────────────

    #[test]
    fn object_pair_with_arrow_fn_emits_function_node() {
        let r = parse_ts("const api = { authenticate: () => { return true; } };");
        let node = r.nodes.iter().find(|n| {
            matches!(n.node_type, NodeType::Function) && n.name == "authenticate"
        });
        assert!(node.is_some(), "object arrow method 'authenticate' should be indexed");
        let node = node.unwrap();
        assert_eq!(node.metadata["object_method"], true);
    }

    #[test]
    fn object_pair_with_regular_fn_emits_function_node() {
        let r = parse_ts("const api = { login: function() { return 1; } };");
        let node = r.nodes.iter().find(|n| {
            matches!(n.node_type, NodeType::Function) && n.name == "login"
        });
        assert!(node.is_some(), "object function method 'login' should be indexed");
    }

    #[test]
    fn object_pair_with_non_fn_value_is_not_indexed() {
        let r = parse_ts("const config = { timeout: 5000, url: 'http://example.com' };");
        let has_fn = r.nodes.iter().any(|n| {
            matches!(n.node_type, NodeType::Function)
                && (n.name == "timeout" || n.name == "url")
        });
        assert!(!has_fn, "scalar object properties should not be indexed as functions");
    }

    #[test]
    fn jsx_component_render_emits_calls_edge() {
        let r = parse_tsx(
            "import HomeHeader from './HomeHeader';\n\
             const Home = () => <HomeHeader className='x' />;",
        );
        let calls = r.edges.iter().filter(|e| matches!(e.edge_type, EdgeType::Calls)).count();
        assert!(calls > 0, "JSX render of <HomeHeader /> should emit a calls edge");
    }
}

fn normalize_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}
