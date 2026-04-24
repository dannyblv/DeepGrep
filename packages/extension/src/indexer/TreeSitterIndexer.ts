import { Parser, Language } from 'web-tree-sitter';
import type { Node } from 'web-tree-sitter';
import { readFileSync, statSync } from 'fs';
import { extname, basename, resolve, posix } from 'path';
import type { GraphNode, GraphEdge } from '../db/GraphDatabase';

export interface ReExport {
  barrelFile: string;          // relPath of the re-exporting file
  exportedName: string;        // name as seen by importers (after alias)
  sourceName: string;          // original name in the source module
  resolvedSourceBase: string;  // e.g. 'src/hooks/useProfile' (no extension)
}

export interface IndexResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  reExports: ReExport[];
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
    if (this.wasmCrashed) return { nodes: [], edges: [], reExports: [] };

    const ext = extname(filePath).toLowerCase();
    const lang = EXT_TO_LANG[ext];
    if (!lang || !this.parsers.has(lang)) return { nodes: [], edges: [], reExports: [] };

    try {
      const fileSize = statSync(filePath).size;
      if (fileSize > MAX_FILE_BYTES) return { nodes: [], edges: [], reExports: [] };
    } catch {
      return { nodes: [], edges: [], reExports: [] };
    }

    let source: string;
    try {
      source = readFileSync(filePath, 'utf8');
    } catch {
      return { nodes: [], edges: [], reExports: [] };
    }

    const parser = this.parsers.get(lang)!;
    let tree: ReturnType<Parser['parse']>;
    try {
      tree = parser.parse(source);
    } catch {
      // WASM heap exhausted — parser is permanently dead after abort()
      this.wasmCrashed = true;
      return { nodes: [], edges: [], reExports: [] };
    }
    if (!tree) return { nodes: [], edges: [], reExports: [] };
    const relPath = filePath.startsWith(workspaceRoot)
      ? filePath.slice(workspaceRoot.length + 1)
      : filePath;

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const reExports: ReExport[] = [];
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

          // Track imported names for resolving calls later.
          // AST structure: import_clause → named_imports → import_specifier
          //   or           import_clause → identifier  (default import)
          //   or           import_clause → namespace_import → identifier (* as Foo)
          const importClause = node.namedChildren.find(c => c?.type === 'import_clause');
          if (importClause) {
            for (const clause of importClause.namedChildren) {
              if (!clause) continue;
              if (clause.type === 'identifier') {
                // Default import: import Foo from '...'
                importedNames.set(clause.text, moduleName);
              } else if (clause.type === 'named_imports') {
                // Named imports: import { foo, bar as baz } from '...'
                for (const spec of clause.namedChildren) {
                  if (!spec || spec.type !== 'import_specifier') continue;
                  const alias = spec.childForFieldName('alias');
                  const name = spec.childForFieldName('name');
                  const localName = alias?.text ?? name?.text ?? spec.text;
                  importedNames.set(localName, moduleName);
                }
              } else if (clause.type === 'namespace_import') {
                // Namespace import: import * as Foo from '...'
                const nsId = clause.namedChildren.find(c => c?.type === 'identifier');
                if (nsId) importedNames.set(nsId.text, moduleName);
              }
            }
          }
          break;
        }

        case 'variable_declarator': {
          const nameNode = node.childForFieldName('name');
          const valueNode = node.childForFieldName('value');
          if (!nameNode || !valueNode) break;
          const isDirectFn = valueNode.type === 'arrow_function' || valueNode.type === 'function';
          // HOC-wrapped components: const Foo = memo(...) / forwardRef(...) etc.
          // Identified by uppercase first letter (React convention) + call_expression value.
          const isWrappedComponent =
            valueNode.type === 'call_expression' && /^[A-Z]/.test(nameNode.text);
          if (!isDirectFn && !isWrappedComponent) break;
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
            code_snippet: isDirectFn
              ? source.slice(node.startIndex, Math.min(node.startIndex + 500, valueNode.endIndex))
              : '',
            metadata: { arrow: isDirectFn, wrapped: isWrappedComponent },
          });
          edges.push({ source_id: fileNodeId, target_id: id, type: 'exports' });
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

        // ── Barrel re-exports: export { X } from '...' ───────────────────────
        case 'export_statement': {
          const sourceNode = node.childForFieldName('source');
          if (!sourceNode) break; // regular export, not a re-export
          const sourceModule = sourceNode.text.replace(/['"]/g, '');
          let resolvedSourceBase: string | null = null;
          if (sourceModule.startsWith('.')) {
            resolvedSourceBase = posix.join(posix.dirname(relPath), sourceModule);
          } else if (sourceModule.startsWith('@/')) {
            resolvedSourceBase = posix.join('src', sourceModule.slice(2));
          }
          if (!resolvedSourceBase) break;
          for (const child of node.namedChildren) {
            if (!child || child.type !== 'export_clause') continue;
            for (const spec of child.namedChildren) {
              if (!spec || spec.type !== 'export_specifier') continue;
              const nameNode = spec.childForFieldName('name');
              const aliasNode = spec.childForFieldName('alias');
              if (!nameNode) continue;
              const sourceName = nameNode.text;
              const exportedName = aliasNode?.text ?? sourceName;
              reExports.push({ barrelFile: relPath, exportedName, sourceName, resolvedSourceBase });
            }
          }
          break;
        }

        // ── JSX renders ───────────────────────────────────────────────────────
        // jsx_opening_element covers <Foo> and <Foo.Bar>; jsx_self_closing_element
        // covers <Foo />.  Only track capitalised names (component convention).
        // jsx_closing_element is intentionally skipped to avoid duplicate edges.
        case 'jsx_opening_element':
        case 'jsx_self_closing_element': {
          const nameNode = node.childForFieldName('name');
          if (!nameNode) break;
          const componentName = nameNode.text.split('.')[0];
          if (!/^[A-Z]/.test(componentName)) break;
          const callerId = this.findEnclosingFunctionId(node, relPath, source);
          if (!callerId) break;
          const resolvedId = this.resolveImport(componentName, importedNames, relPath);
          const targetId = resolvedId ?? this.nodeId(relPath, 'function', componentName, 0);
          edges.push({ source_id: callerId, target_id: targetId, type: 'calls' });
          break;
        }
      }
    });

    return { nodes, edges, reExports };
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
      if (current.type === 'arrow_function') {
        // Direct: const Foo = () => {}
        // HOC-wrapped: const Foo = memo(() => {}), forwardRef((ref) => {}), etc.
        // Climb through arguments/call_expression wrappers to reach the variable_declarator.
        let ancestor: Node | null = current.parent;
        while (
          ancestor &&
          (ancestor.type === 'arguments' || ancestor.type === 'call_expression')
        ) {
          ancestor = ancestor.parent;
        }
        if (ancestor?.type === 'variable_declarator') {
          const nameNode = ancestor.childForFieldName('name');
          if (nameNode) {
            return this.nodeId(filePath, 'function', nameNode.text, ancestor.startPosition.row);
          }
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

    let targetBase: string;
    if (module.startsWith('.')) {
      // Relative import: normalize ../.. sequences via posix.join
      targetBase = posix.join(posix.dirname(currentFile), module);
    } else if (module.startsWith('@/')) {
      // TypeScript @/ path alias → src/
      targetBase = posix.join('src', module.slice(2));
    } else {
      return null; // external package — can't resolve
    }

    // Line is unknown at call-site; reindexWorkspace resolves :0 to real line post-parse
    return `${targetBase}:function:${name}:0`;
  }
}
