mod db;
mod protocol;
mod tools;

use std::io::{self, BufRead, Write};

use anyhow::Result;
use serde_json::{json, Value};

use db::Db;
use protocol::{RpcRequest, RpcResponse, tool_list};

fn main() -> Result<()> {
    let db_path = std::env::var("DEEPGREP_DB_PATH")
        .unwrap_or_else(|_| ".deepgrep/graph.db".to_string());
    let workspace = std::env::var("DEEPGREP_WORKSPACE")
        .unwrap_or_else(|_| ".".to_string());
    let token_budget: usize = std::env::var("DEEPGREP_TOKEN_BUDGET")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(4000);

    let activity_path = format!("{}/.deepgrep/mcp-activity.json", workspace);

    let db = Db::open_read_only(&db_path)?;

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    let mut line = String::new();
    while reader.read_line(&mut line)? > 0 {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            line.clear();
            continue;
        }

        let response = match serde_json::from_str::<RpcRequest>(trimmed) {
            Err(e) => Some(RpcResponse::err(
                Value::Null,
                -32700,
                format!("Parse error: {}", e),
            )),
            Ok(req) => handle_request(&req, &db, token_budget, &activity_path),
        };

        if let Some(resp) = response {
            let json = serde_json::to_string(&resp)?;
            writeln!(writer, "{}", json)?;
            writer.flush()?;
        }

        line.clear();
    }
    Ok(())
}

fn handle_request(
    req: &RpcRequest,
    db: &Db,
    token_budget: usize,
    activity_path: &str,
) -> Option<RpcResponse> {
    let id = req.id.clone().unwrap_or(Value::Null);
    let is_notification = req.id.is_none();

    let result = match req.method.as_str() {
        "initialize" => {
            Some(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "deepgrep", "version": "0.2.0"}
            }))
        }

        "notifications/initialized" | "notifications/cancelled" => None,

        "tools/list" => {
            Some(json!({"tools": tool_list()}))
        }

        "tools/call" => {
            let tool_name = req.params["name"].as_str().unwrap_or("");
            let args = &req.params["arguments"];

            // Signal webview animator
            let _ = std::fs::write(
                activity_path,
                format!("{{\"tool\":\"{}\",\"ts\":{}}}", tool_name, now_ms()),
            );

            let text = match tools::dispatch(db, tool_name, args, token_budget) {
                Ok(t) => t,
                Err(e) => {
                    if is_notification {
                        return None;
                    }
                    return Some(RpcResponse::ok(
                        id,
                        json!({"content": [{"type": "text", "text": format!("Error: {}", e)}], "isError": true}),
                    ));
                }
            };

            Some(json!({
                "content": [{"type": "text", "text": text}],
                "isError": false
            }))
        }

        "ping" => Some(json!({})),

        _ => {
            if is_notification {
                return None;
            }
            return Some(RpcResponse::err(id, -32601, format!("Method not found: {}", req.method)));
        }
    };

    if is_notification {
        return None;
    }

    Some(match result {
        Some(r) => RpcResponse::ok(id, r),
        None => RpcResponse::err(id, -32601, "no result"),
    })
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
