import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import type { GraphDatabase } from '../db/GraphDatabase';

/**
 * Registers DeepGrep's MCP server with VS Code's Language Model API
 * so Claude Code and Copilot can discover it automatically.
 *
 * Also writes .mcp.json to the workspace root so the Claude Code CLI
 * picks it up without needing VS Code.
 */
export class McpServerProvider implements vscode.Disposable {
  private serverProcess: ChildProcess | null = null;
  private registration: vscode.Disposable | null = null;
  private readonly serverScriptPath: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly db: GraphDatabase,
    private readonly workspaceRoot: string,
  ) {
    this.serverScriptPath = resolve(context.extensionPath, 'dist', 'mcp-server.js');
  }

  async start(): Promise<void> {
    this.writeMcpJson();
    this.registerWithVSCode();
  }

  private writeMcpJson(): void {
    const mcpConfig = {
      mcpServers: {
        deepgrep: {
          command: 'node',
          args: [this.serverScriptPath],
          env: {
            DEEPGREP_DB_PATH: resolve(this.workspaceRoot, '.deepgrep', 'graph.db'),
            DEEPGREP_WORKSPACE: this.workspaceRoot,
          },
        },
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
    // VS Code 1.99+ Language Model MCP registration
    // Allows Claude Code to discover the server when running inside VS Code terminal
    const provider: vscode.McpServerDefinitionProvider = {
      provideMcpServerDefinitions: () => {
        return [
          new vscode.McpStdioServerDefinition(
            'DeepGrep',
            'node',
            [this.serverScriptPath],
            {
              DEEPGREP_DB_PATH: resolve(this.workspaceRoot, '.deepgrep', 'graph.db'),
              DEEPGREP_WORKSPACE: this.workspaceRoot,
            },
          ),
        ];
      },
    };

    try {
      this.registration = vscode.lm.registerMcpServerDefinitionProvider(
        'deepgrep-mcp-provider',
        provider,
      );
    } catch {
      // API may not be available in older VS Code — degrade gracefully to .mcp.json only
    }
  }

  dispose(): void {
    this.registration?.dispose();
    this.serverProcess?.kill();
  }
}
