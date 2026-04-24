use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const INDEXABLE_EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "py", "go", "rs"];

const DEFAULT_EXCLUDES: &[&str] = &[
    "node_modules",
    "dist",
    ".git",
    ".next",
    ".turbo",
    ".vercel",
    "target",
    ".deepgrep",
];

pub fn discover_files(workspace: &Path, extra_excludes: &[String]) -> Vec<PathBuf> {
    WalkDir::new(workspace)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !is_excluded(e.path(), workspace, extra_excludes))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| is_indexable(e.path()))
        .map(|e| e.into_path())
        .collect()
}

fn is_excluded(path: &Path, workspace: &Path, extra: &[String]) -> bool {
    let rel = path.strip_prefix(workspace).unwrap_or(path);
    for component in rel.components() {
        let s = component.as_os_str().to_string_lossy();
        if DEFAULT_EXCLUDES.iter().any(|e| *e == s.as_ref()) {
            return true;
        }
        if extra.iter().any(|e| e == s.as_ref()) {
            return true;
        }
        // Skip minified bundles
        if s.ends_with(".min.js") || s.ends_with(".min.cjs") || s.ends_with(".min.mjs") {
            return true;
        }
    }
    false
}

fn is_indexable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| INDEXABLE_EXTS.contains(&e))
        .unwrap_or(false)
}
