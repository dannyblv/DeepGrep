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

    if let Some(id) = try_key(phantom_file).or_else(|| try_key(&strip_ext(phantom_file))) {
        return Some(id);
    }

    // @/ alias: try both src/ prefix and without
    let alt = if phantom_file.starts_with("src/") {
        phantom_file[4..].to_string()
    } else {
        format!("src/{}", phantom_file)
    };
    if let Some(id) = try_key(&alt).or_else(|| try_key(&strip_ext(&alt))) {
        return Some(id);
    }

    // Barrel re-export map
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
