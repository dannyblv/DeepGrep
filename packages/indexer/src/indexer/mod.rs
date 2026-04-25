pub mod extractor;
pub mod resolver;
pub mod walker;

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use rayon::prelude::*;
use tree_sitter::{Language, Parser};

use crate::protocol::IndexResult;
use extractor::Extractor;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Lang {
    TypeScript,
    Tsx,
    JavaScript,
    Python,
    Go,
    Rust,
}

impl Lang {
    pub fn as_str(self) -> &'static str {
        match self {
            Lang::TypeScript => "typescript",
            Lang::Tsx => "tsx",
            Lang::JavaScript => "javascript",
            Lang::Python => "python",
            Lang::Go => "go",
            Lang::Rust => "rust",
        }
    }
}

fn detect_lang(path: &Path) -> Option<Lang> {
    match path.extension()?.to_str()? {
        "ts" => Some(Lang::TypeScript),
        "tsx" => Some(Lang::Tsx),
        "js" | "jsx" => Some(Lang::JavaScript),
        "py" => Some(Lang::Python),
        "go" => Some(Lang::Go),
        "rs" => Some(Lang::Rust),
        _ => None,
    }
}

/// Immutable grammar handles — cheap to clone, safe to share across threads.
#[derive(Clone)]
pub struct Grammars {
    pub typescript: Language,
    pub tsx: Language,
    pub javascript: Language,
    pub python: Language,
    pub go: Language,
    pub rust: Language,
}

impl Grammars {
    pub fn load() -> Self {
        Self {
            typescript: tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            tsx: tree_sitter_typescript::LANGUAGE_TSX.into(),
            javascript: tree_sitter_javascript::LANGUAGE.into(),
            python: tree_sitter_python::LANGUAGE.into(),
            go: tree_sitter_go::LANGUAGE.into(),
            rust: tree_sitter_rust::LANGUAGE.into(),
        }
    }

    fn for_lang(&self, lang: Lang) -> &Language {
        match lang {
            Lang::TypeScript => &self.typescript,
            Lang::Tsx => &self.tsx,
            Lang::JavaScript => &self.javascript,
            Lang::Python => &self.python,
            Lang::Go => &self.go,
            Lang::Rust => &self.rust,
        }
    }
}

const MAX_FILE_BYTES: u64 = 1_000_000; // 1 MB — 2× the WASM limit

pub fn parse_file(path: &Path, workspace: &Path, grammars: &Grammars) -> Option<IndexResult> {
    let lang = detect_lang(path)?;

    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }

    let source = std::fs::read(path).ok()?;
    let rel_path = path
        .strip_prefix(workspace)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    let mut parser = Parser::new();
    parser
        .set_language(grammars.for_lang(lang))
        .ok()?;

    let tree = parser.parse(&source, None)?;

    let mut extractor = Extractor::new(rel_path, &source, lang.as_str().to_string());
    extractor.walk(tree.root_node());
    Some(extractor.finish())
}

/// Parse all files in parallel and return the merged result.
pub fn index_workspace(
    files: &[std::path::PathBuf],
    workspace: &Path,
    grammars: Arc<Grammars>,
) -> Result<IndexResult> {
    let partial_results: Vec<Option<IndexResult>> = files
        .par_iter()
        .map(|path| parse_file(path, workspace, &grammars))
        .collect();

    let skipped_files = partial_results.iter().filter(|r| r.is_none()).count();
    let mut merged = IndexResult::default();
    for r in partial_results.into_iter().flatten() {
        merged.nodes.extend(r.nodes);
        merged.edges.extend(r.edges);
        merged.re_exports.extend(r.re_exports);
    }
    merged.skipped_files = skipped_files;

    let resolved = resolver::resolve_phantoms(&merged.nodes, &mut merged.edges, &merged.re_exports);
    eprintln!("phantom edges resolved: {}, skipped files: {}", resolved, skipped_files);

    Ok(merged)
}
