use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    File,
    Function,
    Class,
    Variable,
    Import,
    Interface,
    #[serde(rename = "type")]
    TypeAlias,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    Calls,
    Imports,
    Extends,
    Uses,
    Exports,
    #[serde(rename = "re-exports")]
    ReExports,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub name: String,
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub language: String,
    pub code_snippet: String,
    pub node_hash: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source_id: String,
    pub target_id: String,
    #[serde(rename = "type")]
    pub edge_type: EdgeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReExport {
    pub barrel_file: String,
    pub exported_name: String,
    pub source_name: String,
    pub resolved_source_base: String,
}

#[derive(Debug, Default)]
pub struct IndexResult {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub re_exports: Vec<ReExport>,
}

pub fn node_id(rel_path: &str, kind: &str, name: &str, line: usize) -> String {
    format!("{}:{}:{}:{}", rel_path, kind, name, line)
}

pub fn node_hash(snippet: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(snippet.as_bytes());
    hex::encode(&hash[..8])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_id_format() {
        assert_eq!(
            node_id("src/foo.ts", "function", "bar", 42),
            "src/foo.ts:function:bar:42",
        );
    }

    #[test]
    fn node_id_line_zero() {
        assert_eq!(node_id("a.ts", "file", "a", 0), "a.ts:file:a:0");
    }

    #[test]
    fn node_hash_is_16_hex_chars() {
        let h = node_hash("fn foo() {}");
        assert_eq!(h.len(), 16, "hash should be 8 bytes = 16 hex chars");
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()), "hash should be hex");
    }

    #[test]
    fn node_hash_is_deterministic() {
        let snippet = "function handleClick() { return 42; }";
        assert_eq!(node_hash(snippet), node_hash(snippet));
    }

    #[test]
    fn node_hash_differs_for_different_snippets() {
        assert_ne!(node_hash("fn foo() {}"), node_hash("fn bar() {}"));
    }

    #[test]
    fn node_hash_empty_string_does_not_panic() {
        let h = node_hash("");
        assert_eq!(h.len(), 16);
    }

    #[test]
    fn node_type_serialises_as_snake_case() {
        assert_eq!(
            serde_json::to_string(&NodeType::Function).unwrap(),
            "\"function\"",
        );
        assert_eq!(
            serde_json::to_string(&NodeType::TypeAlias).unwrap(),
            "\"type\"",
        );
    }

    #[test]
    fn edge_type_re_exports_serialises_with_hyphen() {
        assert_eq!(
            serde_json::to_string(&EdgeType::ReExports).unwrap(),
            "\"re-exports\"",
        );
    }
}
