import * as vscode from 'vscode';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const CLAUDE_MD_MARKER = 'mcp__deepgrep__search_graph';

const CLAUDE_MD_SECTION = `
## DeepGrep — Mandatory Search Protocol

The codebase is indexed in \`.deepgrep/graph.db\`. Use \`mcp__deepgrep__*\` tools
**instead of grep/find** for all code searches. Before calling any DeepGrep tool,
output \`⬡ DeepGrep — <tool>\` in your response.

| Goal | Tool |
|---|---|
| Find a function/class by name | \`mcp__deepgrep__search_graph\` |
| What calls this function? | \`mcp__deepgrep__get_context_for_symbol\` |
| Trace imports/dependencies | \`mcp__deepgrep__get_dependency_chain\` |
| What is near this file/symbol? | \`mcp__deepgrep__find_related_nodes\` |

Only fall back to \`grep\`/\`Bash\` if a graph query returns no results.
`;

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

  ensureClaudeMd(): void {
    const claudeMdPath = resolve(this.workspaceRoot, 'CLAUDE.md');

    if (!existsSync(claudeMdPath)) {
      writeFileSync(claudeMdPath, CLAUDE_MD_SECTION.trimStart(), 'utf8');
      return;
    }

    const existing = readFileSync(claudeMdPath, 'utf8');
    if (existing.includes(CLAUDE_MD_MARKER)) return;

    writeFileSync(claudeMdPath, existing.trimEnd() + '\n' + CLAUDE_MD_SECTION, 'utf8');
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
