use std::path::{Path, PathBuf};

use ignore::WalkBuilder;

const INDEXABLE_EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "py", "go", "rs"];

// Hard excludes on top of .gitignore — belt-and-suspenders for directories
// that are sometimes not gitignored (e.g. in dotfiles repos or bare workspaces).
const HARD_EXCLUDES: &[&str] = &[
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
    WalkBuilder::new(workspace)
        // Respect .gitignore, .git/info/exclude, global gitignore
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        // Also respect any .ignore files (ripgrep convention)
        .ignore(true)
        .follow_links(false)
        .build()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
        .filter(|e| !is_hard_excluded(e.path(), workspace, extra_excludes))
        .filter(|e| is_indexable(e.path()))
        .map(|e| e.into_path())
        .collect()
}

fn is_hard_excluded(path: &Path, workspace: &Path, extra: &[String]) -> bool {
    let rel = path.strip_prefix(workspace).unwrap_or(path);
    for component in rel.components() {
        let s = component.as_os_str().to_string_lossy();
        if HARD_EXCLUDES.iter().any(|e| *e == s.as_ref()) {
            return true;
        }
        if extra.iter().any(|e| e == s.as_ref()) {
            return true;
        }
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
