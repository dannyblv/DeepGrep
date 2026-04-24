import * as vscode from 'vscode';
import { resolve } from 'path';
import { existsSync, watchFile, readFileSync } from 'fs';
import { GraphDatabase } from './db/GraphDatabase';
import { TreeSitterIndexer } from './indexer/TreeSitterIndexer';
import { McpServerProvider } from './mcp/McpServerProvider';
import { GraphPanel } from './webview/GraphPanel';
import { ShellIntegration } from './terminal/ShellIntegration';
import { HookManager } from './hooks/HookManager';

let db: GraphDatabase | null = null;
let graphPanel: GraphPanel | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  // ── Database ───────────────────────────────────────────────────────────────
  const dbPath = resolve(workspaceRoot, '.deepgrep', 'graph.db');
  db = new GraphDatabase(dbPath);

  // ── Claude Code hooks ──────────────────────────────────────────────────────
  const hookManager = new HookManager(workspaceRoot, context.extensionPath);
  hookManager.ensureHooks();
  hookManager.ensureAgentMemoryDirs(['indexer', 'graph-analyst', 'ui']);

  // ── Graph panel (webview) ──────────────────────────────────────────────────
  graphPanel = new GraphPanel(context, db);
  context.subscriptions.push(graphPanel);

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
  // Also watch for the queue file being created for the first time
  const queueWatcher = vscode.workspace.createFileSystemWatcher(
    resolve(workspaceRoot, '.deepgrep', 'reindex-queue.json'),
  );
  queueWatcher.onDidCreate(() => watchReindexQueue(context, workspaceRoot, queuePath));
  context.subscriptions.push(queueWatcher);

  // ── Initial index ──────────────────────────────────────────────────────────
  const stats = db.getStats();
  if (stats.node_count === 0) {
    // First activation — index in background
    setImmediate(() => reindexWorkspace(context, workspaceRoot));
  }

  vscode.window.setStatusBarMessage('$(graph) DeepGrep ready', 3000);
}

export function deactivate(): void {
  db?.close();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function reindexWorkspace(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): Promise<void> {
  if (!db) return;

  const grammarsDir = resolve(context.extensionPath, 'grammars');
  const indexer = new TreeSitterIndexer();
  await indexer.init(grammarsDir);

  const config = vscode.workspace.getConfiguration('deepgrep');
  const excludePatterns = config.get<string[]>('excludePatterns', ['**/node_modules/**', '**/dist/**', '**/.git/**']);

  const files = await vscode.workspace.findFiles(
    '**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,h}',
    `{${excludePatterns.join(',')}}`,
  );

  const start = Date.now();
  graphPanel?.sendProgress(0, `Indexing ${files.length} files...`);

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i].fsPath;
    db.deleteEdgesForFile(filePath);
    db.deleteNodesForFile(filePath);
    const result = indexer.indexFile(filePath, workspaceRoot);
    db.upsertNodes(result.nodes);
    db.upsertEdges(result.edges);

    if (i % 20 === 0) {
      const progress = Math.round((i / files.length) * 100);
      graphPanel?.sendProgress(progress, `Indexing ${i}/${files.length}...`);
    }
  }

  const duration = Date.now() - start;
  db.setMeta('last_indexed', String(Date.now()));
  db.setMeta('last_index_duration_ms', String(duration));

  graphPanel?.sendProgress(100, 'Index complete');
  graphPanel?.sendGraph();
  graphPanel?.sendStats();
  vscode.window.setStatusBarMessage(`$(graph) DeepGrep: indexed ${files.length} files in ${duration}ms`, 5000);
}

async function reindexFile(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  filePath: string,
): Promise<void> {
  if (!db) return;
  const grammarsDir = resolve(context.extensionPath, 'grammars');
  const indexer = new TreeSitterIndexer();
  await indexer.init(grammarsDir);
  db.deleteEdgesForFile(filePath);
  db.deleteNodesForFile(filePath);
  const result = indexer.indexFile(filePath, workspaceRoot);
  db.upsertNodes(result.nodes);
  db.upsertEdges(result.edges);
  graphPanel?.sendGraph();
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
        // Clear the queue after processing
        require('fs').writeFileSync(queuePath, '[]', 'utf8');
      } catch {
        // Queue file corrupted or missing — ignore
      }
    }, 300);
  });
}
