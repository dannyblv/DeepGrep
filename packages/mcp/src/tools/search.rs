use anyhow::Result;
use serde_json::Value;

use crate::db::{queries, Db};

pub fn run(db: &Db, args: &Value) -> Result<(String, usize)> {
    let query = args["query"].as_str().ok_or_else(|| anyhow::anyhow!("query required"))?;
    let limit = args["limit"].as_u64().unwrap_or(10).clamp(1, 50) as usize;

    let nodes = queries::search_nodes(&db.conn, query, limit)?;

    let banner = queries::staleness_banner(&db.conn).unwrap_or_default();

    let nodes = if nodes.is_empty() {
        rg_fallback(query, limit)
    } else {
        nodes
    };

    if nodes.is_empty() {
        return Ok((format!(
            "{}No nodes found matching \"{}\"\n\n\
             **Coverage note**: the index tracks defined names — functions, classes, interfaces, \
             and import specifiers. It does not cover string literals, comments, JSX prop values, \
             or config keys. If you expected a match, confirm with rg before concluding the \
             symbol doesn't exist.",
            banner, query
        ), 0));
    }

    let served = nodes.len();
    let mut out = format!("{}Found {} node(s) matching \"{}\":\n\n", banner, served, query);
    for n in &nodes {
        out.push_str(&format!(
            "- **{}** `{}` ({}) {}:{}\n",
            n["name"].as_str().unwrap_or("?"),
            n["type"].as_str().unwrap_or("?"),
            n["file"].as_str().unwrap_or("?"),
            n["start_line"].as_i64().unwrap_or(0),
            n["end_line"].as_i64().unwrap_or(0),
        ));
    }
    Ok((out, served))
}

fn rg_fallback(query: &str, limit: usize) -> Vec<Value> {
    let workspace = std::env::var("DEEPGREP_WORKSPACE").unwrap_or_default();
    if workspace.is_empty() {
        return vec![];
    }

    let output = std::process::Command::new("rg")
        .args([
            "--json",
            "-n",
            "-i",
            "--max-count", "3",
            "-g", "*.{ts,tsx,js,jsx,rs,go,py}",
            "--",
            query,
            &workspace,
        ])
        .output();

    let stdout = match output {
        Ok(o) if !o.stdout.is_empty() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => return vec![],
    };

    let prefix = format!("{}/", workspace);
    let mut results = Vec::new();

    for line in stdout.lines() {
        if results.len() >= limit {
            break;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v["type"].as_str() != Some("match") {
            continue;
        }

        let data = &v["data"];
        let abs_file = data["path"]["text"].as_str().unwrap_or("?");
        let line_num = data["line_number"].as_i64().unwrap_or(0);
        let matched_line = data["lines"]["text"].as_str().unwrap_or("").trim().to_string();

        let rel_file = abs_file.strip_prefix(&prefix).unwrap_or(abs_file).to_string();
        let node_type = infer_node_type(&matched_line);
        let node_name = infer_name(&matched_line, query).unwrap_or_else(|| query.to_string());

        results.push(serde_json::json!({
            "id":         format!("{}:{}:{}:{}", rel_file, node_type, node_name, line_num),
            "name":       node_name,
            "type":       node_type,
            "file":       rel_file,
            "start_line": line_num,
            "end_line":   line_num,
            "snippet":    &matched_line[..matched_line.len().min(120)],
            "node_hash":  "",
        }));
    }

    results
}

fn infer_node_type(line: &str) -> &'static str {
    if line.contains("function ") || line.contains("=> {") || line.contains("fn ") {
        "function"
    } else if line.contains("class ") {
        "class"
    } else if line.contains("interface ") {
        "interface"
    } else if line.contains("export default") || line.contains("module.exports") {
        "export"
    } else {
        "symbol"
    }
}

fn infer_name(line: &str, query: &str) -> Option<String> {
    // function keyword: "function foo" or "async function foo"
    if let Some(pos) = line.find("function ") {
        let rest = &line[pos + 9..];
        let name: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        if !name.is_empty() {
            return Some(name);
        }
    }
    // fn keyword (Rust): "fn foo" or "pub fn foo"
    if let Some(pos) = line.find("fn ") {
        let rest = &line[pos + 3..];
        let name: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        if !name.is_empty() {
            return Some(name);
        }
    }
    // const/let/var binding containing the query
    for kw in &["const ", "let ", "var "] {
        if let Some(pos) = line.find(kw) {
            let rest = &line[pos + kw.len()..];
            let name: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            if !name.is_empty() && name.to_lowercase().contains(&query.to_lowercase()) {
                return Some(name);
            }
        }
    }
    None
}
