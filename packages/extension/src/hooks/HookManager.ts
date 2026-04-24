import * as vscode from 'vscode';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
  };
  [key: string]: unknown;
}

interface HookEntry {
  matcher: string;
  hooks: { type: string; command: string }[];
}

/**
 * Manages Claude Code lifecycle hooks in .claude/settings.json.
 * Ensures pre/post-tool-use scripts are registered for the workspace.
 */
export class HookManager {
  private readonly claudeDir: string;
  private readonly settingsPath: string;
  private readonly preHookScript: string;
  private readonly postHookScript: string;

  constructor(private readonly workspaceRoot: string, extensionPath: string) {
    this.claudeDir = resolve(workspaceRoot, '.claude');
    this.settingsPath = resolve(this.claudeDir, 'settings.json');
    this.preHookScript = resolve(extensionPath, '..', '..', 'scripts', 'pre-tool-use.mjs');
    this.postHookScript = resolve(extensionPath, '..', '..', 'scripts', 'post-tool-use.mjs');
  }

  ensureHooks(): void {
    if (!existsSync(this.claudeDir)) {
      mkdirSync(this.claudeDir, { recursive: true });
    }

    let settings: ClaudeSettings = {};
    if (existsSync(this.settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(this.settingsPath, 'utf8'));
      } catch {
        settings = {};
      }
    }

    settings.hooks ??= {};
    settings.hooks.PreToolUse = this.mergeHook(settings.hooks.PreToolUse ?? [], {
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: `node "${this.preHookScript}"` }],
    });
    settings.hooks.PostToolUse = this.mergeHook(settings.hooks.PostToolUse ?? [], {
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: `node "${this.postHookScript}"` }],
    });

    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  ensureAgentMemoryDirs(agentIds: string[]): void {
    for (const id of agentIds) {
      const dir = resolve(this.claudeDir, 'agent-memory', id);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  private mergeHook(existing: HookEntry[], incoming: HookEntry): HookEntry[] {
    const alreadyPresent = existing.some(
      e =>
        e.matcher === incoming.matcher &&
        e.hooks.some(h => h.command === incoming.hooks[0].command),
    );
    if (alreadyPresent) return existing;
    return [...existing, incoming];
  }
}
