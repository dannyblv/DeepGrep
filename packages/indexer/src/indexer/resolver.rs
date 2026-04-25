use std::collections::HashMap;

use crate::protocol::{GraphEdge, GraphNode, ReExport};

/// Resolve phantom call edges (target_id ending in `:0`) to real node IDs.
///
/// After parsing all files in parallel, callee line numbers are unknown at
/// parse time. The indexer generates phantom IDs (`path:function:name:0`).
/// This pass resolves them using a symbol lookup built from all parsed nodes.
pub fn resolve_phantoms(
    nodes: &[GraphNode],
    edges: &mut Vec<GraphEdge>,
    re_exports: &[ReExport],
) -> usize {
    let symbol_lookup = build_symbol_lookup(nodes);
    let re_export_map = build_re_export_map(re_exports, nodes);

    let mut resolved = 0;
    for edge in edges.iter_mut() {
        if !edge.target_id.ends_with(":0") {
            continue;
        }
        // Parse: filePath:type:name:0
        if let Some(real_id) = resolve_phantom(&edge.target_id, &symbol_lookup, &re_export_map) {
            edge.target_id = real_id;
            resolved += 1;
        }
    }
    resolved
}

fn resolve_phantom(
    phantom: &str,
    lookup: &HashMap<String, String>,
    re_exports: &HashMap<String, [String; 2]>,
) -> Option<String> {
    // Split from right: filePath:type:name:0
    let i3 = phantom.rfind(':')?;                   // ':0'
    let i2 = phantom[..i3].rfind(':')?;             // ':name'
    let i1 = phantom[..i2].rfind(':')?;             // ':type'
    let kind = &phantom[i1 + 1..i2];
    if kind != "function" && kind != "class" {
        return None;
    }
    let phantom_file = &phantom[..i1];
    let name = &phantom[i2 + 1..i3];

    let try_key = |fp: &str| lookup.get(&format!("{}:{}:{}", fp, kind, name)).cloned();

    // 1. Exact file path and stripped-extension path
    if let Some(id) = try_key(phantom_file).or_else(|| try_key(&strip_ext(phantom_file))) {
        return Some(id);
    }

    // 2. @/ alias: try both src/ prefix and without
    let alt = if phantom_file.starts_with("src/") {
        phantom_file[4..].to_string()
    } else {
        format!("src/{}", phantom_file)
    };
    if let Some(id) = try_key(&alt).or_else(|| try_key(&strip_ext(&alt))) {
        return Some(id);
    }

    // 3. Directory-import fallbacks: when the import path resolves to a directory
    //    rather than a file (e.g. `import HomeHeader from './HomeHeader'`), also try:
    //      dir/Name      → dir/Name.tsx  (Name.tsx file inside dir/)
    //      dir/index     → dir/index.tsx (index file inside dir/)
    //      dir/Name/Name → dir/Name/Name.tsx (common nested pattern)
    let dir_candidates = [
        format!("{}/{}", phantom_file, name),
        format!("{}/index", phantom_file),
        format!("{}/{}/{}", phantom_file, name, name),
    ];
    for candidate in &dir_candidates {
        if let Some(id) = try_key(candidate).or_else(|| try_key(&strip_ext(candidate))) {
            return Some(id);
        }
        // Also try src/ swap for each candidate
        let c_alt = if candidate.starts_with("src/") {
            candidate[4..].to_string()
        } else {
            format!("src/{}", candidate)
        };
        if let Some(id) = try_key(&c_alt).or_else(|| try_key(&strip_ext(&c_alt))) {
            return Some(id);
        }
    }

    // 4. Barrel re-export map
    let key = format!("{}:{}", strip_ext(phantom_file), name);
    if let Some([source_base, source_name]) = re_exports.get(&key) {
        if let Some(id) = lookup.get(&format!("{}:{}:{}", source_base, kind, source_name)) {
            return Some(id.clone());
        }
    }

    None
}

fn build_symbol_lookup(nodes: &[GraphNode]) -> HashMap<String, String> {
    let mut map = HashMap::with_capacity(nodes.len());
    for n in nodes {
        let type_str = match n.node_type {
            crate::protocol::NodeType::Function => "function",
            crate::protocol::NodeType::Class => "class",
            _ => continue,
        };
        // Key without extension so `src/foo.tsx` and `src/foo` both match
        let stripped = strip_ext(&n.file_path);
        let key = format!("{}:{}:{}", stripped, type_str, n.name);
        map.entry(key).or_insert_with(|| n.id.clone());
        // Also key with extension for exact matches
        let key_ext = format!("{}:{}:{}", n.file_path, type_str, n.name);
        map.entry(key_ext).or_insert_with(|| n.id.clone());
    }
    map
}

fn build_re_export_map(
    re_exports: &[ReExport],
    nodes: &[GraphNode],
) -> HashMap<String, [String; 2]> {
    let node_files: std::collections::HashSet<&str> =
        nodes.iter().map(|n| n.file_path.as_str()).collect();

    let mut map = HashMap::new();
    for re in re_exports {
        let barrel = strip_ext(&re.barrel_file);
        let entry = [
            strip_ext(&re.resolved_source_base),
            re.source_name.clone(),
        ];
        map.insert(format!("{}:{}", barrel, re.exported_name), entry.clone());
        // Also expose via parent dir if this is an index file
        if barrel.ends_with("/index") {
            let parent = &barrel[..barrel.len() - 6];
            map.insert(format!("{}:{}", parent, re.exported_name), entry.clone());
        }
        let _ = node_files; // used only to scope borrowing
    }
    map
}

fn strip_ext(path: &str) -> String {
    for ext in &[".tsx", ".ts", ".jsx", ".js", ".py", ".go", ".rs"] {
        if let Some(stripped) = path.strip_suffix(ext) {
            return stripped.to_string();
        }
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{EdgeType, GraphEdge, GraphNode, NodeType};

    fn make_fn_node(file: &str, name: &str, line: usize) -> GraphNode {
        GraphNode {
            id: format!("{}:function:{}:{}", file, name, line),
            node_type: NodeType::Function,
            name: name.to_string(),
            file_path: file.to_string(),
            start_line: line,
            end_line: line + 10,
            language: "typescript".to_string(),
            code_snippet: String::new(),
            node_hash: String::new(),
            metadata: serde_json::json!({}),
        }
    }

    fn phantom_edge(source: &str, phantom_target: &str) -> GraphEdge {
        GraphEdge {
            source_id: source.to_string(),
            target_id: phantom_target.to_string(),
            edge_type: EdgeType::Calls,
        }
    }

    // ── Improvement B: directory-import resolution ────────────────────────────

    #[test]
    fn resolves_direct_file_phantom() {
        let nodes = vec![make_fn_node("src/hooks/useAuth.ts", "useAuth", 5)];
        let mut edges = vec![phantom_edge("src/a.ts:function:fn:1", "src/hooks/useAuth:function:useAuth:0")];
        let resolved = resolve_phantoms(&nodes, &mut edges, &[]);
        assert_eq!(resolved, 1);
        assert_eq!(edges[0].target_id, "src/hooks/useAuth.ts:function:useAuth:5");
    }

    #[test]
    fn resolves_directory_import_via_dir_slash_name() {
        // import HomeHeader from './components/HomeHeader'
        // actual file: src/components/HomeHeader/HomeHeader.tsx
        let nodes = vec![make_fn_node("src/components/HomeHeader/HomeHeader.tsx", "HomeHeader", 3)];
        let mut edges = vec![phantom_edge(
            "src/Home.tsx:function:Home:0",
            "src/components/HomeHeader:function:HomeHeader:0",
        )];
        let resolved = resolve_phantoms(&nodes, &mut edges, &[]);
        assert_eq!(resolved, 1, "dir/Name fallback should resolve to dir/Name/Name.tsx");
    }

    #[test]
    fn resolves_directory_import_via_index() {
        // import Header from './components/Header'
        // actual file: src/components/Header/index.tsx
        let nodes = vec![make_fn_node("src/components/Header/index.tsx", "Header", 1)];
        let mut edges = vec![phantom_edge(
            "src/App.tsx:function:App:0",
            "src/components/Header:function:Header:0",
        )];
        let resolved = resolve_phantoms(&nodes, &mut edges, &[]);
        assert_eq!(resolved, 1, "dir/index fallback should resolve symbol in index.tsx");
    }

    #[test]
    fn unresolvable_phantom_remains_unchanged() {
        let nodes = vec![make_fn_node("src/a.ts", "knownFn", 1)];
        let original_target = "src/ghost:function:missing:0".to_string();
        let mut edges = vec![phantom_edge("src/a.ts:function:knownFn:1", &original_target)];
        let resolved = resolve_phantoms(&nodes, &mut edges, &[]);
        assert_eq!(resolved, 0);
        assert_eq!(edges[0].target_id, original_target);
    }
}
