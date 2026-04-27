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
            description: "Nodes within N hops of a file or symbol. Automatically uses slim mode (no code snippets) when hops >= 2 or result count > 8 to minimise token usage. Pass slim=false to force full snippets.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "symbol":    {"type": "string"},
                    "file_path": {"type": "string"},
                    "hops":      {"type": "number", "minimum": 1, "maximum": 5, "default": 2},
                    "slim":      {"type": "boolean", "description": "Strip code snippets (auto-true when hops>=2 or results>8)"},
                    "max_nodes": {"type": "number", "minimum": 1, "maximum": 200, "default": 60},
                    "agent_id":  {"type": "string"}
                }
            }),
        },
        ToolDef {
            name: "search_text",
            description: "Search string literals and comments across all indexed files. Use for error messages, config keys in source code, JSX prop values, and TODO comments.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "number", "minimum": 1, "maximum": 50, "default": 20},
                    "kind":  {"type": "string", "enum": ["string", "comment"]}
                },
                "required": ["query"]
            }),
        },
        ToolDef {
            name: "search_rg",
            description: "Live ripgrep search over the workspace filesystem. Searches ALL file types (json, yaml, toml, env, etc.) and always reflects current disk state. Use for config keys, env vars, regex patterns, and anything not yet indexed. Prefer search_graph for symbol names and search_text for indexed literals.",
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query":  {"type": "string", "description": "Text or regex pattern to search for"},
                    "glob":   {"type": "string", "description": "File glob filter, e.g. '*.json' or '*.{ts,tsx}'"},
                    "limit":  {"type": "number", "minimum": 1, "maximum": 100, "default": 20},
                    "regex":  {"type": "boolean", "default": false, "description": "Treat query as a regex pattern"}
                },
                "required": ["query"]
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
