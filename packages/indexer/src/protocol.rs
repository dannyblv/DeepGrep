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
