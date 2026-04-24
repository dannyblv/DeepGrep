import * as vscode from 'vscode';
import { resolve } from 'path';
import { existsSync, watchFile, readFileSync } from 'fs';
import { GraphDatabase } from './db/GraphDatabase';
import { TreeSitterIndexer } from './indexer/TreeSitterIndexer';
import { McpServerProvider } from './mcp/McpServerProvider';
import { GraphPanel } from './webview/GraphPanel';
import { SidebarProvider } from './webview/SidebarProvider';
import { ShellIntegration } from './terminal/ShellIntegration';
import { HookManager } from './hooks/HookManager';

let db: GraphDatabase | null = null;
let graphPanel: GraphPanel | null = null;
let sidebar: SidebarProvider | null = null;
let statusBar: vscode.StatusBarItem | null = null;
let out: vscode.OutputChannel | null = null;

function log(msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  out?.appendLine(`[${ts}] ${msg}`);
}

function setStatus(text: string, tooltip?: string): void {
  if (!statusBar) return;
  statusBar.text = text;
  if (tooltip) statusBar.tooltip = tooltip;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  // ── Output channel ─────────────────────────────────────────────────────────
  out = vscode.window.createOutputChannel('DeepGrep');
  context.subscriptions.push(out);
  log('DeepGrep activating…');
  log(`Workspace: ${workspaceRoot}`);
  log(`Extension path: ${context.extensionPath}`);

  // ── Database ───────────────────────────────────────────────────────────────
  const dbPath = resolve(workspaceRoot, '.deepgrep', 'graph.db');
  log(`DB path: ${dbPath}`);
  db = new GraphDatabase(dbPath);

  // ── Status bar ─────────────────────────────────────────────────────────────
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBar.command = 'deepgrep.showLogs';
  statusBar.tooltip = 'DeepGrep — click to view logs';
  statusBar.text = '$(database) DeepGrep';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ── Claude Code hooks ──────────────────────────────────────────────────────
  const hookManager = new HookManager(workspaceRoot, context.extensionPath);
  hookManager.ensureHooks();
  hookManager.ensureClaudeMd();
  hookManager.ensureAgentMemoryDirs(['indexer', 'graph-analyst', 'ui']);

  // ── Graph panel (webview) ──────────────────────────────────────────────────
  graphPanel = new GraphPanel(context, db);
  context.subscriptions.push(graphPanel);

  // ── Sidebar panel ──────────────────────────────────────────────────────────
  sidebar = new SidebarProvider(context.extensionUri, workspaceRoot, db);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.VIEW_TYPE, sidebar),
  );

  // ── Terminal shell integration ─────────────────────────────────────────────
  const shellInt = new ShellIntegration(db, (failingNodeIds) => {
    graphPanel?.show();
    graphPanel?.highlightNodes(failingNodeIds, 'error');
    vscode.window.showWarningMessage(
      `DeepGrep: ${failingNodeIds.length} failing node(s) highlighted in graph`,
    );
  });
  shellInt.start();
  context.subscriptions.push(shellInt);

  // ── MCP server ─────────────────────────────────────────────────────────────
  const mcpProvider = new McpServerProvider(context, db, workspaceRoot);
  await mcpProvider.start();
  context.subscriptions.push(mcpProvider);

  // ── Commands ───────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('deepgrep.openGraph', () => {
      graphPanel?.show();
    }),

    vscode.commands.registerCommand('deepgrep.reindexWorkspace', async () => {
      await reindexWorkspace(context, workspaceRoot);
    }),

    vscode.commands.registerCommand('deepgrep.showStats', () => {
      graphPanel?.show();
      graphPanel?.sendStats();
    }),

    vscode.commands.registerCommand('deepgrep.showLogs', () => {
      out?.show(true);
    }),

    vscode.commands.registerCommand('deepgrep.focusSidebar', () => {
      vscode.commands.executeCommand('workbench.view.extension.deepgrep');
    }),

    vscode.commands.registerCommand('deepgrep.clearMemory', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all DeepGrep agent memory? This cannot be undone.',
        { modal: true },
        'Clear',
      );
      if (confirm === 'Clear') {
        vscode.window.showInformationMessage('Agent memory cleared.');
      }
    }),
  );

  // ── File watcher: re-index on save ─────────────────────────────────────────
  const config = vscode.workspace.getConfiguration('deepgrep');
  if (config.get<boolean>('indexOnSave', true)) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{ts,tsx,js,jsx,py,go,rs}',
    );
    watcher.onDidChange(uri => reindexFile(context, workspaceRoot, uri.fsPath));
    watcher.onDidCreate(uri => reindexFile(context, workspaceRoot, uri.fsPath));
    context.subscriptions.push(watcher);
  }

  // ── Queue watcher: picks up files queued by the PostToolUse hook ───────────
  const queuePath = resolve(workspaceRoot, '.deepgrep', 'reindex-queue.json');
  if (existsSync(queuePath)) {
    watchReindexQueue(context, workspaceRoot, queuePath);
  }
  const queueWatcher = vscode.workspace.createFileSystemWatcher(
    resolve(workspaceRoot, '.deepgrep', 'reindex-queue.json'),
  );
  queueWatcher.onDidCreate(() => watchReindexQueue(context, workspaceRoot, queuePath));
  context.subscriptions.push(queueWatcher);

  // ── Initial state ──────────────────────────────────────────────────────────
  const stats = db.getStats();
  log(`DB stats on activate: ${stats.node_count} nodes, ${stats.edge_count} edges`);
  if (stats.node_count === 0) {
    log('No index found — starting initial indexing');
    setStatus('$(loading~spin) DeepGrep: Starting…', 'DeepGrep — click to view logs');
    setImmediate(() =>
      reindexWorkspace(context, workspaceRoot).catch(err => {
        log(`Unhandled error in initial index: ${err}`);
        setStatus('$(warning) DeepGrep: failed', 'DeepGrep — click to view logs');
        sidebar?.setIndexing(false);
      }),
    );
  } else {
    setStatus(
      `$(database) DeepGrep: ${stats.node_count.toLocaleString()} nodes`,
      'DeepGrep — click to view logs',
    );
  }

  log('DeepGrep activated');
}

export function deactivate(): void {
  db?.close();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function reindexWorkspace(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): Promise<void> {
  if (!db) {
    log('reindexWorkspace: db is null, aborting');
    return;
  }

  log('─── Starting workspace re-index ───────────────────────────');

  try {
    const grammarsDir = resolve(context.extensionPath, 'grammars');
    log(`Grammars dir: ${grammarsDir}`);
    log('Initializing Tree-sitter parsers…');
    setStatus('$(loading~spin) DeepGrep: Loading parsers…');
    sidebar?.setIndexing(true, 'Loading parsers…');

    const indexer = new TreeSitterIndexer();
    await indexer.init(grammarsDir);
    log('Parsers ready');

    const config = vscode.workspace.getConfiguration('deepgrep');
    const excludePatterns = config.get<string[]>('excludePatterns', [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/.next/**',    // Next.js build output — large bundles, not source
      '**/.turbo/**',   // Turbopack cache
      '**/.vercel/**',  // Vercel build output
      '**/*.min.js',    // Minified bundles
      '**/*.min.cjs',
      '**/*.min.mjs',
    ]);
    log(`Exclude patterns: ${excludePatterns.join(', ')}`);

    log('Searching for files…');
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,h}',
      `{${excludePatterns.join(',')}}`,
    );
    log(`Found ${files.length} files to index`);

    if (files.length === 0) {
      log('WARNING: 0 files found — check excludePatterns in settings');
      setStatus('$(warning) DeepGrep: 0 files found');
      sidebar?.setIndexing(false);
      vscode.window.showWarningMessage(
        'DeepGrep: No source files found. Check your deepgrep.excludePatterns setting.',
        'Open Logs',
      ).then(v => { if (v === 'Open Logs') out?.show(true); });
      return;
    }

    const start = Date.now();
    let lastLoggedPct = -1;

    // ── Phase 1: parse all files (CPU-bound, yields to event loop between batches)
    log('Phase 1/3: parsing files…');
    const allNodes: import('./indexer/TreeSitterIndexer').IndexResult['nodes'] = [];
    const allEdges: import('./indexer/TreeSitterIndexer').IndexResult['edges'] = [];
    let skippedLarge = 0;
    let wasmDied = false;
    const BATCH = 50; // files per event-loop tick

    for (let i = 0; i < files.length; i++) {
      if (indexer.crashed) {
        if (!wasmDied) {
          log(`WARN: WASM parser crashed — skipping remaining ${files.length - i} files`);
          wasmDied = true;
        }
        break;
      }

      const filePath = files[i].fsPath;
      let result: import('./indexer/TreeSitterIndexer').IndexResult;
      try {
        result = indexer.indexFile(filePath, workspaceRoot);
      } catch (fileErr) {
        log(`WARN: skipped ${filePath.replace(workspaceRoot, '')} — ${fileErr}`);
        result = { nodes: [], edges: [] };
      }

      if (result.nodes.length === 0 && !indexer.crashed) skippedLarge++;
      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);

      // Update UI every BATCH files and yield to event loop
      if ((i + 1) % BATCH === 0 || i === files.length - 1) {
        const pct = Math.round(((i + 1) / files.length) * 50);
        const progressMsg = `Parsing ${i + 1}/${files.length} (${pct}%)`;
        setStatus(`$(loading~spin) DeepGrep: ${progressMsg}`);
        graphPanel?.sendProgress(pct, progressMsg);
        sidebar?.setIndexing(true, progressMsg);
        if (pct !== lastLoggedPct && pct % 25 === 0) {
          log(`Phase 1 progress: ${pct * 2}% (${i + 1}/${files.length})`);
          lastLoggedPct = pct;
        }
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }

    if (skippedLarge > 0) log(`WARN: skipped ${skippedLarge} oversized/empty files`);

    // ── Phase 2: atomic DB write — clear old data, insert all nodes + edges in two transactions
    log(`Phase 2/3: writing ${allNodes.length} nodes + ${allEdges.length} edges…`);
    setStatus('$(loading~spin) DeepGrep: Writing to DB…');
    sidebar?.setIndexing(true, 'Writing to DB…');
    graphPanel?.sendProgress(75, 'Writing to DB…');
    db.clearAll();
    db.upsertNodes(allNodes);
    db.upsertEdges(allEdges);
    log('DB write complete');

    // ── Phase 3: rebuild FTS search index
    log('Phase 3/3: building search index…');
    sidebar?.setIndexing(true, 'Building search index…');
    db.rebuildFts();
    log('Search index ready');

    const duration = Date.now() - start;
    db.setMeta('last_indexed', String(Date.now()));
    db.setMeta('last_index_duration_ms', String(duration));

    const nodeCount = db.getStats().node_count;
    const edgeCount = db.getStats().edge_count;
    log(`✓ Done: ${files.length} files · ${nodeCount} nodes · ${edgeCount} edges · ${duration}ms`);

    setStatus(
      `$(database) DeepGrep: ${nodeCount.toLocaleString()} nodes`,
      'DeepGrep — click to view logs',
    );
    graphPanel?.sendProgress(100, 'Index complete');
    graphPanel?.sendGraph();
    graphPanel?.sendStats();

    vscode.window.showInformationMessage(
      `DeepGrep: indexed ${files.length} files · ${nodeCount.toLocaleString()} nodes · ${duration}ms`,
      'View Logs',
    ).then(v => { if (v === 'View Logs') out?.show(true); });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack : '';
    log(`ERROR: ${message}`);
    if (stack) log(stack);
    setStatus('$(warning) DeepGrep: index failed', 'DeepGrep — click to view logs');
    vscode.window.showErrorMessage(`DeepGrep indexing failed: ${message}`, 'View Logs')
      .then(v => { if (v === 'View Logs') out?.show(true); });
  } finally {
    sidebar?.setIndexing(false);
    log('─── Re-index finished ─────────────────────────────────────');
  }
}

async function reindexFile(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  filePath: string,
): Promise<void> {
  if (!db) return;
  try {
    const grammarsDir = resolve(context.extensionPath, 'grammars');
    const indexer = new TreeSitterIndexer();
    await indexer.init(grammarsDir);
    const relPath = filePath.startsWith(workspaceRoot)
      ? filePath.slice(workspaceRoot.length + 1)
      : filePath;
    db.deleteEdgesForFile(filePath);
    db.deleteNodesForFile(filePath);
    const result = indexer.indexFile(filePath, workspaceRoot);
    db.upsertNodes(result.nodes);
    db.upsertEdges(result.edges);
    db.updateFtsForFile(relPath);
    graphPanel?.sendGraph();
    sidebar?.refresh();
    const nodeCount = db.getStats().node_count;
    setStatus(`$(database) DeepGrep: ${nodeCount.toLocaleString()} nodes`);
    log(`Re-indexed: ${relPath}`);
  } catch (err) {
    log(`reindexFile error for ${filePath}: ${err}`);
  }
}

function watchReindexQueue(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  queuePath: string,
): void {
  let debounce: NodeJS.Timeout | null = null;
  watchFile(queuePath, { interval: 500 }, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        const queue: { path: string; queuedAt: number }[] = JSON.parse(
          readFileSync(queuePath, 'utf8'),
        );
        for (const entry of queue) {
          await reindexFile(context, workspaceRoot, entry.path);
        }
        require('fs').writeFileSync(queuePath, '[]', 'utf8');
      } catch {
        // Queue file corrupted or missing — ignore
      }
    }, 300);
  });
}
