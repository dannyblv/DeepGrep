import * as vscode from 'vscode';
import { resolve } from 'path';
import { existsSync, writeFileSync } from 'fs';
import type { GraphDatabase } from '../db/GraphDatabase';

/** Path to compiled Rust MCP server binary. */
function mcpBinaryPath(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'target', 'release', 'deepgrep-mcp');
}

/** Fallback: legacy Node.js MCP server bundled with the extension. */
function legacyScriptPath(extensionPath: string): string {
  return resolve(extensionPath, 'dist', 'mcp-server.js');
}

export class McpServerProvider implements vscode.Disposable {
  private registration: vscode.Disposable | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly db: GraphDatabase,
    private readonly workspaceRoot: string,
  ) {}

  async start(): Promise<void> {
    this.writeMcpJson();
    this.registerWithVSCode();
  }

  private serverCommand(): { command: string; args: string[] } {
    const rustBin = mcpBinaryPath(this.workspaceRoot);
    if (existsSync(rustBin)) {
      return { command: rustBin, args: [] };
    }
    // Fall back to the bundled Node.js server if Rust binary not yet built
    return { command: 'node', args: [legacyScriptPath(this.context.extensionPath)] };
  }

  private serverEnv(): Record<string, string> {
    return {
      DEEPGREP_DB_PATH: resolve(this.workspaceRoot, '.deepgrep', 'graph.db'),
      DEEPGREP_WORKSPACE: this.workspaceRoot,
      DEEPGREP_TOKEN_BUDGET: '4000',
    };
  }

  private writeMcpJson(): void {
    const { command, args } = this.serverCommand();
    const mcpConfig = {
      mcpServers: {
        deepgrep: { command, args, env: this.serverEnv() },
      },
    };
    try {
      writeFileSync(
        resolve(this.workspaceRoot, '.mcp.json'),
        JSON.stringify(mcpConfig, null, 2),
        'utf8',
      );
    } catch {
      // Non-fatal — workspace might be read-only
    }
  }

  private registerWithVSCode(): void {
    const { command, args } = this.serverCommand();
    const provider: vscode.McpServerDefinitionProvider = {
      provideMcpServerDefinitions: () => [
        new vscode.McpStdioServerDefinition('DeepGrep', command, args, this.serverEnv()),
      ],
    };
    try {
      this.registration = vscode.lm.registerMcpServerDefinitionProvider(
        'deepgrep-mcp-provider',
        provider,
      );
    } catch {
      // VS Code < 1.99 — .mcp.json fallback is sufficient
    }
  }

  dispose(): void {
    this.registration?.dispose();
  }
}
