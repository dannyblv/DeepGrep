use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── JSON-RPC 2.0 ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    #[allow(dead_code)]
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
}

impl RpcResponse {
    pub fn ok(id: Value, result: Value) -> Self {
        Self { jsonrpc: "2.0", id, result: Some(result), error: None }
    }

    pub fn err(id: Value, code: i32, message: impl Into<String>) -> Self {
        Self { jsonrpc: "2.0", id, result: None, error: Some(RpcError { code, message: message.into() }) }
    }
}

// ── MCP Tool definitions ──────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

pub fn tool_list() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "search_graph",
            description: "Fuzzy search across all indexed nodes by name.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "number", "minimum": 1, "maximum": 50, "default": 10},
                    "agent_id": {"type": "string"}
                },
                "required": ["query"]
            }),
        },
        ToolDef {
            name: "get_context_for_symbol",
            description: "Return code snippet, callers, and callees for a symbol. Call before editing.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "file_path": {"type": "string"},
                    "agent_id": {"type": "string"}
                },
                "required": ["symbol"]
            }),
        },
        ToolDef {
            name: "get_dependency_chain",
            description: "Full transitive dependency chain (callee direction) for a symbol.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "file_path": {"type": "string"},
                    "agent_id": {"type": "string"}
                },
                "required": ["symbol"]
            }),
        },
        ToolDef {
            name: "find_related_nodes",
            description: "Nodes within N hops of a file or symbol.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "file_path": {"type": "string"},
                    "hops": {"type": "number", "minimum": 1, "maximum": 5, "default": 2},
                    "agent_id": {"type": "string"}
                }
            }),
        },
        ToolDef {
            name: "get_agent_memory",
            description: "Read a key from persistent agent memory (AST-bound, stale-detected).",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "key": {"type": "string"}
                },
                "required": ["agent_id", "key"]
            }),
        },
        ToolDef {
            name: "set_agent_memory",
            description: "Write a key to persistent agent memory, optionally bound to an AST node.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "key": {"type": "string"},
                    "value": {"type": "string"},
                    "node_id": {"type": "string"}
                },
                "required": ["agent_id", "key", "value"]
            }),
        },
        ToolDef {
            name: "get_stats",
            description: "Index freshness, node/edge counts, and query efficiency metrics.",
            input_schema: serde_json::json!({"type": "object", "properties": {}}),
        },
    ]
}
