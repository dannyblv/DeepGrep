import * as vscode from 'vscode';
import type { GraphDatabase } from '../db/GraphDatabase';

export type StackTraceHandler = (failingNodeIds: string[]) => void;

/**
 * Watches VS Code terminal shell executions for stack traces produced by
 * Claude Code sub-processes (test runners, type checkers, etc.).
 * When a failing symbol is identified in the graph, fires onStackTrace.
 */
export class ShellIntegration implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private onStackTrace: StackTraceHandler;

  constructor(
    private readonly db: GraphDatabase,
    onStackTrace: StackTraceHandler,
  ) {
    this.onStackTrace = onStackTrace;
  }

  start(): void {
    // Listen for terminal shell execution events (VS Code 1.93+)
    if ('onDidStartTerminalShellExecution' in vscode.window) {
      this.disposables.push(
        (vscode.window as any).onDidStartTerminalShellExecution(
          (event: any) => this.handleExecution(event),
        ),
      );
    }
  }

  private async handleExecution(event: {
    terminal: vscode.Terminal;
    execution: { commandLine: { value: string }; read(): AsyncIterable<string> };
  }): Promise<void> {
    const cmd = event.execution.commandLine.value.toLowerCase();

    // Only intercept test runners / type checkers / build tools
    const isRelevant =
      cmd.includes('jest') ||
      cmd.includes('vitest') ||
      cmd.includes('mocha') ||
      cmd.includes('tsc') ||
      cmd.includes('pnpm test') ||
      cmd.includes('npm test') ||
      cmd.includes('cargo test') ||
      cmd.includes('go test') ||
      cmd.includes('pytest');

    if (!isRelevant) return;

    let buffer = '';
    try {
      for await (const chunk of event.execution.read()) {
        buffer += chunk;
        // Stop buffering once we have enough output
        if (buffer.length > 50_000) break;
      }
    } catch {
      return;
    }

    const failingNodeIds = this.extractFailingNodes(buffer);
    if (failingNodeIds.length > 0) {
      this.onStackTrace(failingNodeIds);
    }
  }

  private extractFailingNodes(output: string): string[] {
    const nodeIds: string[] = [];

    // Match TypeScript error: src/foo/bar.ts:42:10 — Error TS...
    const tsErrorRe = /([^\s:]+\.tsx?):(\d+):\d+/g;
    let m: RegExpExecArray | null;
    while ((m = tsErrorRe.exec(output)) !== null) {
      const filePath = m[1];
      const line = parseInt(m[2], 10);
      const nodes = this.db.getNodesForFile(filePath);
      const node = nodes.find(n => n.start_line <= line && n.end_line >= line);
      if (node) nodeIds.push(node.id);
    }

    // Match stack frame: at FunctionName (src/foo/bar.ts:42:10)
    const frameRe = /at (\w+)(?:\.\w+)* \(([^)]+):(\d+):\d+\)/g;
    while ((m = frameRe.exec(output)) !== null) {
      const funcName = m[1];
      const filePath = m[2];
      const line = parseInt(m[3], 10);
      const nodes = this.db.getNodesForFile(filePath);
      const node = nodes.find(
        n => n.name === funcName && n.start_line <= line && n.end_line >= line,
      );
      if (node) nodeIds.push(node.id);
    }

    return [...new Set(nodeIds)];
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}
