import * as vscode from 'vscode';

import { resolve } from 'path';
import type { GraphDatabase, GraphNode } from '../db/GraphDatabase';
import type { WebviewToExtMsg, ExtToWebviewMsg, CyNode, CyEdge } from './messages';

export class GraphPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private queryCount = 0;
  private tokenSavings = 0;
  private disposables: vscode.Disposable[] = [];
  private pendingOnboarding = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly db: GraphDatabase,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'deepgrep.graph',
      'DeepGrep — Dependency Graph',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(resolve(this.context.extensionPath, 'dist', 'webview')),
        ],
        retainContextWhenHidden: true,
      },
    );

    this.panel.webview.html = this.getHtml();

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((msg: WebviewToExtMsg) =>
        this.handleMessage(msg),
      ),
      this.panel.onDidDispose(() => {
        this.panel = null;
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
      }),
    );
  }

  private handleMessage(msg: WebviewToExtMsg): void {
    switch (msg.type) {
      case 'ready':
        this.sendGraph();
        this.sendStats();
        if (this.pendingOnboarding) {
          this.pendingOnboarding = false;
          this.send({ type: 'showOnboarding' });
        }
        break;
      case 'requestStats':
        this.sendStats();
        break;
      case 'nodeClick': {
        const node = this.db.getNode(msg.nodeId);
        if (!node) break;
        const callerEdges = this.db.getIncoming(node.id);
        const calleeEdges = this.db.getOutgoing(node.id);
        const callers = callerEdges
          .map(e => this.db.getNode(e.source_id))
          .filter(Boolean)
          .map(n => this.toCyNode(n!));
        const callees = calleeEdges
          .map(e => this.db.getNode(e.target_id))
          .filter(Boolean)
          .map(n => this.toCyNode(n!));
        this.send({
          type: 'nodeDetail',
          node: {
            ...this.toCyNode(node),
            snippet: node.code_snippet,
            callers,
            callees,
          },
        });
        // Open the file at the right line
        vscode.workspace
          .openTextDocument(vscode.Uri.file(this.resolveFilePath(node.file_path)))
          .then(doc =>
            vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(node.start_line, 0, node.start_line, 0),
              viewColumn: vscode.ViewColumn.One,
              preserveFocus: false,
            }),
          )
          .then(undefined, () => undefined);
        break;
      }
      case 'openFile': {
        const n = this.db.getNode(msg.nodeId);
        if (!n) break;
        vscode.workspace
          .openTextDocument(vscode.Uri.file(this.resolveFilePath(n.file_path)))
          .then(
            doc => vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(n.start_line, 0, n.start_line, 0),
              viewColumn: vscode.ViewColumn.One,
              preserveFocus: false,
            }),
            err => vscode.window.showErrorMessage(`DeepGrep: cannot open file — ${err}`),
          );
        break;
      }
      case 'requestReindex':
        vscode.commands.executeCommand('deepgrep.reindexWorkspace');
        break;
    }
  }

  sendGraph(): void {
    const rawNodes = this.db.getAllNodes();
    const rawEdges = this.db.getAllEdges();
    const nodes = rawNodes.map(n => this.toCyNode(n));
    const edges: CyEdge[] = rawEdges.map(e => ({
      id: `${e.source_id}→${e.target_id}:${e.type}`,
      source: e.source_id,
      target: e.target_id,
      type: e.type,
    }));
    this.send({ type: 'graphUpdate', nodes, edges });
  }

  highlightNodes(nodeIds: string[], color: 'ai' | 'error' | 'selected'): void {
    this.send({ type: 'highlight', nodeIds, color });
    if (color === 'ai') {
      this.queryCount++;
      // Rough token savings: assume each served node saves ~200 tokens vs. full-file read
      this.tokenSavings += nodeIds.length * 200;
    }
  }

  notifyToolQuery(toolName: string): void {
    this.send({ type: 'toolQuery', toolName });
  }

  showOnboarding(): void {
    const panelAlreadyOpen = !!this.panel;
    this.show();
    if (panelAlreadyOpen) {
      // Panel was already alive — send immediately (webview is running)
      this.send({ type: 'showOnboarding' });
    } else {
      // Freshly created panel: wait for the 'ready' ping from the webview
      this.pendingOnboarding = true;
    }
  }

  sendProgress(progress: number, message: string): void {
    this.send({ type: 'indexing', progress, message });
  }

  sendStats(): void {
    const dbStats = this.db.getStats();
    this.send({
      type: 'stats',
      data: {
        ...dbStats,
        token_savings_estimate: this.tokenSavings,
        query_count: this.queryCount,
      },
    });
  }

  private send(msg: ExtToWebviewMsg): void {
    this.panel?.webview.postMessage(msg);
  }

  // DB stores paths workspace-relative (e.g. /tests/foo.ts). Resolve to absolute.
  private resolveFilePath(filePath: string): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || filePath.startsWith(root)) return filePath;
    const rel = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    return resolve(root, rel);
  }

  private toCyNode(n: GraphNode): CyNode {
    return {
      id: n.id,
      label: n.name,
      type: n.type,
      file: n.file_path,
      line: n.start_line,
    };
  }

  private getHtml(): string {
    const webviewDir = resolve(this.context.extensionPath, 'dist', 'webview');
    const scriptUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.file(resolve(webviewDir, 'main.js')),
    );
    const styleUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.file(resolve(webviewDir, 'style.css')),
    );
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${this.panel!.webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>DeepGrep</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
