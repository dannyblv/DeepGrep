use anyhow::Result;
use serde_json::Value;

/// Live ripgrep search over the workspace filesystem.
///
/// Complements `search_text` (indexed FTS) and `search_graph` (symbol index):
/// - Searches ALL file types including config/yaml/toml/json/env
/// - Always reflects the current filesystem (no stale index risk)
/// - Supports regex patterns
pub fn run(args: &Value) -> Result<(String, usize)> {
    let query = args["query"].as_str().ok_or_else(|| anyhow::anyhow!("query required"))?;
    let limit = args["limit"].as_u64().unwrap_or(20).clamp(1, 100) as usize;
    let glob = args["glob"].as_str();
    let is_regex = args["regex"].as_bool().unwrap_or(false);

    let workspace = std::env::var("DEEPGREP_WORKSPACE").unwrap_or_else(|_| ".".to_string());

    let (rg_bin, use_arg0) = resolve_rg_binary();

    let mut cmd_args: Vec<String> = vec![
        "--json".into(),
        "-n".into(),
        "--max-count".into(),
        "3".into(),
    ];

    if !is_regex {
        cmd_args.push("--fixed-strings".into());
    }

    if let Some(g) = glob {
        cmd_args.push("-g".into());
        cmd_args.push(g.to_string());
    }

    cmd_args.push("--".into());
    cmd_args.push(query.to_string());
    cmd_args.push(workspace.clone());

    let output = {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let mut cmd = std::process::Command::new(&rg_bin);
            cmd.args(&cmd_args);
            if use_arg0 {
                cmd.arg0("rg");
            }
            cmd.output()
        }
        #[cfg(not(unix))]
        {
            let _ = use_arg0;
            std::process::Command::new(&rg_bin).args(&cmd_args).output()
        }
    };

    let stdout = match output {
        Ok(o) if !o.stdout.is_empty() => String::from_utf8_lossy(&o.stdout).into_owned(),
        Ok(o) if o.status.success() || o.status.code() == Some(1) => {
            return Ok((format!("No matches for \"{}\" in workspace.", query), 0));
        }
        Ok(o) => {
            let err = String::from_utf8_lossy(&o.stderr);
            return Err(anyhow::anyhow!("rg failed ({}): {}", o.status, err.trim()));
        }
        Err(e) => return Err(anyhow::anyhow!(
            "rg not found (tried: {}). Install ripgrep or set DEEPGREP_RG_PATH. Error: {}",
            rg_bin, e
        )),
    };

    let prefix = format!("{}/", workspace.trim_end_matches('/'));
    let mut results: Vec<Value> = Vec::new();

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
        let line_num = data["line_number"].as_u64().unwrap_or(0);
        let matched = data["lines"]["text"].as_str().unwrap_or("").trim().to_string();
        let rel_file = abs_file.strip_prefix(&prefix).unwrap_or(abs_file);

        results.push(serde_json::json!({
            "file":  rel_file,
            "line":  line_num,
            "match": &matched[..matched.len().min(200)],
        }));
    }

    if results.is_empty() {
        return Ok((format!("No matches for \"{}\" in workspace.", query), 0));
    }

    let mut out = format!(
        "Found {} match(es) for \"{}\" (live rg search):\n\n",
        results.len(),
        query
    );
    for r in &results {
        out.push_str(&format!(
            "- **{}:{}** — `{}`\n",
            r["file"].as_str().unwrap_or("?"),
            r["line"].as_u64().unwrap_or(0),
            r["match"].as_str().unwrap_or(""),
        ));
    }
    out.push_str("\n> Use `search_graph` for symbol definitions, `search_text` for indexed literals.");

    Ok((out, 0))
}

/// Resolves the ripgrep binary path.
/// Priority:
///   1. DEEPGREP_RG_PATH env var (explicit override)
///   2. CLAUDE_CODE_EXECPATH (Claude Code bundles rg; call with arg0="rg")
///   3. Common Homebrew / Cargo install paths
///   4. Fall back to "rg" and let PATH resolution handle it
///
/// Returns (binary_path, needs_arg0_rg).
pub fn resolve_rg_binary() -> (String, bool) {
    if let Ok(p) = std::env::var("DEEPGREP_RG_PATH") {
        if !p.is_empty() && std::path::Path::new(&p).exists() {
            return (p, false);
        }
    }

    if let Ok(p) = std::env::var("CLAUDE_CODE_EXECPATH") {
        if !p.is_empty() && std::path::Path::new(&p).exists() {
            return (p, true);
        }
    }

    let candidates = [
        "/opt/homebrew/bin/rg",
        "/usr/local/bin/rg",
        "/usr/bin/rg",
    ];
    let home = std::env::var("HOME").unwrap_or_default();
    let cargo_rg = format!("{}/.cargo/bin/rg", home);

    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return (c.to_string(), false);
        }
    }
    if std::path::Path::new(&cargo_rg).exists() {
        return (cargo_rg, false);
    }

    ("rg".to_string(), false)
}
