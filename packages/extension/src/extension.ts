import * as vscode from 'vscode';
import { resolve } from 'path';
import { existsSync, watchFile, readFileSync } from 'fs';
import { GraphDatabase } from './db/GraphDatabase';
import { indexerExists, indexWorkspace, reindexFile as rustReindexFile } from './indexer/RustIndexer';
import { McpServerProvider } from './mcp/McpServerProvider';
import { GraphPanel } from './webview/GraphPanel';
import { HowToUsePanel } from './webview/HowToUsePanel';
import { SidebarProvider } from './webview/SidebarProvider';
import { ShellIntegration } from './terminal/ShellIntegration';
import { HookManager } from './hooks/HookManager';

let db: GraphDatabase | null = null;
let graphPanel: GraphPanel | null = null;
let sidebar: SidebarProvider | null = null;
let statusBar: vscode.StatusBarItem | null = null;
let out: vscode.OutputChannel | null = null;
let extensionPath = '';

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
  extensionPath = context.extensionPath;
  log('DeepGrep activating…');
  log(`Workspace: ${workspaceRoot}`);
  log(`Extension path: ${extensionPath}`);

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

  // ── MCP activity watcher: animates webview ⬡ and status bar on each tool call
  const activityPath = resolve(workspaceRoot, '.deepgrep', 'mcp-activity.json');
  const activityWatcher = vscode.workspace.createFileSystemWatcher(activityPath);
  let activityTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveProgress: (() => void) | null = null;
  const handleActivity = () => {
    try {
      const payload = JSON.parse(readFileSync(activityPath, 'utf8')) as { tool?: unknown; served?: unknown };
      const { tool, served } = payload;
      if (typeof tool === 'string') {
        // Update cumulative prompt-impact stats in the DB. The Rust MCP server
        // is read-only, so this is the single writer. `served` may be missing
        // on older activity payloads — treat it as zero rather than skipping.
        const servedNum = typeof served === 'number' ? served : 0;
        try { db?.incrementQueryStats(servedNum); } catch { /* DB busy — next activity will retry */ }

        graphPanel?.notifyToolQuery(tool);
        graphPanel?.sendStats();
        sidebar?.recordQuery(servedNum);

        // Spin the status bar
        if (activityTimer) clearTimeout(activityTimer);
        setStatus(`$(loading~spin) ⬡ DeepGrep: ${tool}`, `DeepGrep — querying ${tool}`);
        activityTimer = setTimeout(() => {
          activityTimer = null;
          const nodeCount = db?.getStats().node_count ?? 0;
          setStatus(
            `$(database) DeepGrep: ${nodeCount.toLocaleString()} nodes`,
            'DeepGrep — click to view logs',
          );
        }, 2500);

        // Dismiss any in-flight toast then show a new one
        resolveProgress?.();
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: '⬡ DeepGrep', cancellable: false },
          (progress) => {
            progress.report({ message: `${tool}…` });
            return new Promise<void>(res => { resolveProgress = res; });
          },
        );
        // Auto-dismiss after 2 s
        setTimeout(() => { resolveProgress?.(); resolveProgress = null; }, 2000);
      }
    } catch { /* file missing or malformed — ignore */ }
  };
  activityWatcher.onDidChange(handleActivity);
  activityWatcher.onDidCreate(handleActivity);
  context.subscriptions.push(activityWatcher);

  // ── Commands ───────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('deepgrep.openGraph', () => {
      graphPanel?.show();
    }),

    vscode.commands.registerCommand('deepgrep.reindexWorkspace', async () => {
      await reindexWorkspace(workspaceRoot);
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

    vscode.commands.registerCommand('deepgrep.showOnboarding', () => {
      HowToUsePanel.show();
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
    watcher.onDidChange(uri => reindexFile(workspaceRoot, uri.fsPath));
    watcher.onDidCreate(uri => reindexFile(workspaceRoot, uri.fsPath));
    context.subscriptions.push(watcher);
  }

  // ── Queue watcher: picks up files queued by the PostToolUse hook ───────────
  const queuePath = resolve(workspaceRoot, '.deepgrep', 'reindex-queue.json');
  if (existsSync(queuePath)) {
    watchReindexQueue(workspaceRoot, queuePath);
  }
  const queueWatcher = vscode.workspace.createFileSystemWatcher(
    resolve(workspaceRoot, '.deepgrep', 'reindex-queue.json'),
  );
  queueWatcher.onDidCreate(() => watchReindexQueue(workspaceRoot, queuePath));
  context.subscriptions.push(queueWatcher);

  // ── Initial state ──────────────────────────────────────────────────────────
  const stats = db.getStats();
  log(`DB stats on activate: ${stats.node_count} nodes, ${stats.edge_count} edges`);
  if (stats.node_count === 0) {
    log('No index found — starting initial indexing');
    setStatus('$(loading~spin) DeepGrep: Starting…', 'DeepGrep — click to view logs');
    setImmediate(() =>
      reindexWorkspace(workspaceRoot).catch(err => {
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

async function reindexWorkspace(workspaceRoot: string): Promise<void> {
  if (!db) {
    log('reindexWorkspace: db is null, aborting');
    return;
  }

  log('─── Starting workspace re-index (Rust) ────────────────────');

  if (!indexerExists(extensionPath)) {
    const msg = 'deepgrep-indexer binary not found. Run: cargo build --release';
    log(`ERROR: ${msg}`);
    setStatus('$(warning) DeepGrep: indexer not built');
    vscode.window.showErrorMessage(`DeepGrep: ${msg}`, 'View Logs')
      .then(v => { if (v === 'View Logs') out?.show(true); });
    return;
  }

  const dbPath = resolve(workspaceRoot, '.deepgrep', 'graph.db');

  try {
    setStatus('$(loading~spin) DeepGrep: Indexing…');
    sidebar?.setIndexing(true, 'Indexing workspace…');
    graphPanel?.sendProgress(10, 'Indexing workspace…');

    const summary = await indexWorkspace(workspaceRoot, dbPath, extensionPath, (msg) => {
      log(msg);
      const match = msg.match(/(\d+)\/(\d+)/);
      if (match) {
        const pct = Math.round((Number(match[1]) / Number(match[2])) * 90);
        setStatus(`$(loading~spin) DeepGrep: ${msg}`);
        graphPanel?.sendProgress(pct, msg);
        sidebar?.setIndexing(true, msg);
      }
    });

    const nodeCount = db.getStats().node_count;
    const edgeCount = db.getStats().edge_count;
    log(`✓ Done: ${summary.files ?? '?'} files · ${nodeCount} nodes · ${edgeCount} edges · ${summary.duration_ms}ms`);

    setStatus(`$(database) DeepGrep: ${nodeCount.toLocaleString()} nodes`, 'DeepGrep — click to view logs');
    graphPanel?.sendProgress(100, 'Index complete');
    graphPanel?.sendGraph();
    graphPanel?.sendStats();

    vscode.window.showInformationMessage(
      `DeepGrep: ${nodeCount.toLocaleString()} nodes · ${edgeCount.toLocaleString()} edges · ${summary.duration_ms}ms`,
      'View Logs',
    ).then(v => { if (v === 'View Logs') out?.show(true); });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    setStatus('$(warning) DeepGrep: index failed', 'DeepGrep — click to view logs');
    vscode.window.showErrorMessage(`DeepGrep indexing failed: ${message}`, 'View Logs')
      .then(v => { if (v === 'View Logs') out?.show(true); });
  } finally {
    sidebar?.setIndexing(false);
    log('─── Re-index finished ─────────────────────────────────────');
  }
}

async function reindexFile(workspaceRoot: string, filePath: string): Promise<void> {
  if (!db) return;
  const dbPath = resolve(workspaceRoot, '.deepgrep', 'graph.db');
  const relPath = filePath.startsWith(workspaceRoot)
    ? filePath.slice(workspaceRoot.length + 1)
    : filePath;
  try {
    await rustReindexFile(filePath, workspaceRoot, dbPath, extensionPath);
    graphPanel?.sendGraph();
    sidebar?.refresh();
    const nodeCount = db.getStats().node_count;
    setStatus(`$(database) DeepGrep: ${nodeCount.toLocaleString()} nodes`);
    log(`Re-indexed: ${relPath}`);
  } catch (err) {
    log(`reindexFile error for ${relPath}: ${err}`);
  }
}

function watchReindexQueue(workspaceRoot: string, queuePath: string): void {
  let debounce: NodeJS.Timeout | null = null;
  watchFile(queuePath, { interval: 500 }, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        const queue: { path: string; queuedAt: number }[] = JSON.parse(
          readFileSync(queuePath, 'utf8'),
        );
        for (const entry of queue) {
          await reindexFile(workspaceRoot, entry.path);
        }
        require('fs').writeFileSync(queuePath, '[]', 'utf8');
      } catch {
        // Queue file corrupted or missing — ignore
      }
    }, 300);
  });
}
