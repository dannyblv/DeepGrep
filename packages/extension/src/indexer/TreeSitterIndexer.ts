import { Parser, Language } from 'web-tree-sitter';
import type { Node } from 'web-tree-sitter';
import { readFileSync, statSync } from 'fs';
import { extname, basename, resolve } from 'path';
import type { GraphNode, GraphEdge } from '../db/GraphDatabase';

export interface IndexResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Maps file extension → Tree-sitter language name
const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
};

// WASM heap is ~32 MB shared across all parsers; large files reliably OOM it.
const MAX_FILE_BYTES = 500_000; // 500 KB

export class TreeSitterIndexer {
  private parsers: Map<string, Parser> = new Map();
  private initialized = false;
  private wasmCrashed = false;

  get crashed(): boolean { return this.wasmCrashed; }

  async init(grammarsDir: string): Promise<void> {
    await Parser.init();
    const langs = ['typescript', 'tsx', 'javascript', 'python', 'go', 'rust'];
    for (const lang of langs) {
      const wasmPath = resolve(grammarsDir, `tree-sitter-${lang}.wasm`);
      try {
        const language = await Language.load(wasmPath);
        const parser = new Parser();
        parser.setLanguage(language);
        this.parsers.set(lang, parser);
      } catch {
        // Grammar not available — skip silently
      }
    }
    this.initialized = true;
  }

  indexFile(filePath: string, workspaceRoot: string): IndexResult {
    if (!this.initialized) throw new Error('TreeSitterIndexer not initialized');
    if (this.wasmCrashed) return { nodes: [], edges: [] };

    const ext = extname(filePath).toLowerCase();
    const lang = EXT_TO_LANG[ext];
    if (!lang || !this.parsers.has(lang)) return { nodes: [], edges: [] };

    try {
      const fileSize = statSync(filePath).size;
      if (fileSize > MAX_FILE_BYTES) return { nodes: [], edges: [] };
    } catch {
      return { nodes: [], edges: [] };
    }

    let source: string;
    try {
      source = readFileSync(filePath, 'utf8');
    } catch {
      return { nodes: [], edges: [] };
    }

    const parser = this.parsers.get(lang)!;
    let tree: ReturnType<Parser['parse']>;
    try {
      tree = parser.parse(source);
    } catch {
      // WASM heap exhausted — parser is permanently dead after abort()
      this.wasmCrashed = true;
      return { nodes: [], edges: [] };
    }
    if (!tree) return { nodes: [], edges: [] };
    const relPath = filePath.startsWith(workspaceRoot)
      ? filePath.slice(workspaceRoot.length + 1)
      : filePath;

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const importedNames = new Map<string, string>(); // local name → source module

    // Add a file-level node
    const fileNodeId = this.nodeId(relPath, 'file', basename(filePath), 0);
    nodes.push({
      id: fileNodeId,
      type: 'file',
      name: basename(filePath),
      file_path: relPath,
      start_line: 0,
      end_line: source.split('\n').length,
      language: lang,
      code_snippet: '',
      metadata: {},
    });

    this.walk(tree.rootNode, (node) => {
      switch (node.type) {
        // ── TypeScript / JavaScript ───────────────────────────────────────────
        case 'function_declaration':
        case 'method_definition':
        case 'function': {
          const nameNode = node.childForFieldName('name');
          if (!nameNode) break;
          const name = nameNode.text;
          const id = this.nodeId(relPath, 'function', name, node.startPosition.row);
          nodes.push({
            id,
            type: 'function',
            name,
            file_path: relPath,
            start_line: node.startPosition.row,
            end_line: node.endPosition.row,
            language: lang,
            code_snippet: source.slice(node.startIndex, Math.min(node.startIndex + 500, node.endIndex)),
            metadata: {},
          });
          edges.push({ source_id: fileNodeId, target_id: id, type: 'exports' });
          break;
        }

        case 'class_declaration':
        case 'class': {
          const nameNode = node.childForFieldName('name');
          if (!nameNode) break;
          const name = nameNode.text;
          const id = this.nodeId(relPath, 'class', name, node.startPosition.row);
          nodes.push({
            id,
            type: 'class',
            name,
            file_path: relPath,
            start_line: node.startPosition.row,
            end_line: node.endPosition.row,
            language: lang,
            code_snippet: source.slice(node.startIndex, Math.min(node.startIndex + 500, node.endIndex)),
            metadata: {},
          });
          edges.push({ source_id: fileNodeId, target_id: id, type: 'exports' });

          // Inheritance
          const superclassNode = node.childForFieldName('superclass');
          if (superclassNode) {
            const superName = superclassNode.text;
            const resolvedId = this.resolveImport(superName, importedNames, relPath);
            if (resolvedId) {
              edges.push({ source_id: id, target_id: resolvedId, type: 'extends' });
            }
          }
          break;
        }

        case 'interface_declaration':
        case 'type_alias_declaration': {
          const nameNode = node.childForFieldName('name');
          if (!nameNode) break;
          const name = nameNode.text;
          const type = node.type === 'interface_declaration' ? 'interface' : 'type';
          const id = this.nodeId(relPath, type as GraphNode['type'], name, node.startPosition.row);
          nodes.push({
            id,
            type: type as GraphNode['type'],
            name,
            file_path: relPath,
            start_line: node.startPosition.row,
            end_line: node.endPosition.row,
            language: lang,
            code_snippet: '',
            metadata: {},
          });
          break;
        }

        case 'import_statement': {
          const sourceNode = node.childForFieldName('source');
          if (!sourceNode) break;
          const moduleName = sourceNode.text.replace(/['"]/g, '');
          const importNodeId = this.nodeId(relPath, 'import', moduleName, node.startPosition.row);
          nodes.push({
            id: importNodeId,
            type: 'import',
            name: moduleName,
            file_path: relPath,
            start_line: node.startPosition.row,
            end_line: node.endPosition.row,
            language: lang,
            code_snippet: node.text,
            metadata: { module: moduleName },
          });
          edges.push({ source_id: fileNodeId, target_id: importNodeId, type: 'imports' });

          // Track imported names for resolving calls later
          for (const child of node.namedChildren) {
            if (!child) continue;
            if (child.type === 'import_clause' || child.type === 'named_imports') {
              for (const spec of child.namedChildren) {
                if (!spec) continue;
                if (spec.type === 'import_specifier' || spec.type === 'identifier') {
                  importedNames.set(spec.text, moduleName);
                }
              }
            }
          }
          break;
        }

        case 'call_expression': {
          const funcNode = node.childForFieldName('function');
          if (!funcNode) break;
          const calleeName = funcNode.text.split('.').pop() ?? funcNode.text;
          const callerId = this.findEnclosingFunctionId(node, relPath, source);
          if (callerId) {
            const resolvedId = this.resolveImport(calleeName, importedNames, relPath);
            const targetId = resolvedId ?? this.nodeId(relPath, 'function', calleeName, 0);
            edges.push({ source_id: callerId, target_id: targetId, type: 'calls' });
          }
          break;
        }
      }
    });

    return { nodes, edges };
  }

  private walk(node: Node, visitor: (n: Node) => void): void {
    visitor(node);
    for (const child of node.children) {
      if (child) this.walk(child, visitor);
    }
  }

  private nodeId(filePath: string, type: string, name: string, line: number): string {
    return `${filePath}:${type}:${name}:${line}`;
  }

  private findEnclosingFunctionId(
    node: Node,
    filePath: string,
    _source: string,
  ): string | null {
    let current: Node | null = node.parent;
    while (current) {
      if (
        current.type === 'function_declaration' ||
        current.type === 'method_definition' ||
        current.type === 'function'
      ) {
        const nameNode = current.childForFieldName('name');
        if (nameNode) {
          return this.nodeId(filePath, 'function', nameNode.text, current.startPosition.row);
        }
      }
      current = current.parent;
    }
    return null;
  }

  private resolveImport(
    name: string,
    importedNames: Map<string, string>,
    currentFile: string,
  ): string | null {
    const module = importedNames.get(name);
    if (!module) return null;
    // Local relative import — we can form a probable file node id
    if (module.startsWith('.')) {
      const dir = currentFile.split('/').slice(0, -1).join('/');
      const target = `${dir}/${module.replace(/^\.\//, '')}`;
      return `${target}:function:${name}:0`;
    }
    return null;
  }
}
