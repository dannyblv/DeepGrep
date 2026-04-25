import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { HookManager } from '../hooks/HookManager';

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_EXT = '/fake/extension';
const MARKER = 'mcp__deepgrep__search_graph';

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'dg-test-'));
}

function makeHookManager(workspaceRoot: string): HookManager {
  return new HookManager(workspaceRoot, FAKE_EXT);
}

// ── HookManager ───────────────────────────────────────────────────────────────

describe('HookManager', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeWorkspace();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  // ── ensureClaudeMd ────────────────────────────────────────────────────────

  describe('ensureClaudeMd', () => {
    it('creates CLAUDE.md when none exists', () => {
      const hm = makeHookManager(workspaceRoot);
      hm.ensureClaudeMd();

      const claudeMdPath = join(workspaceRoot, 'CLAUDE.md');
      assert.ok(existsSync(claudeMdPath), 'CLAUDE.md should be created');
      const content = readFileSync(claudeMdPath, 'utf8');
      assert.ok(content.includes(MARKER), 'should contain the DeepGrep marker');
      assert.ok(content.includes('mcp__deepgrep__get_context_for_symbol'));
      assert.ok(content.includes('mcp__deepgrep__get_dependency_chain'));
      assert.ok(content.includes('mcp__deepgrep__find_related_nodes'));
    });

    it('does not start with blank lines when creating fresh file', () => {
      const hm = makeHookManager(workspaceRoot);
      hm.ensureClaudeMd();
      const content = readFileSync(join(workspaceRoot, 'CLAUDE.md'), 'utf8');
      assert.ok(!content.startsWith('\n'), 'file should not start with leading newline');
    });

    it('appends section to existing CLAUDE.md that lacks the marker', () => {
      const claudeMdPath = join(workspaceRoot, 'CLAUDE.md');
      writeFileSync(claudeMdPath, '# My Project\n\nExisting content here.\n', 'utf8');

      const hm = makeHookManager(workspaceRoot);
      hm.ensureClaudeMd();

      const content = readFileSync(claudeMdPath, 'utf8');
      assert.ok(content.includes('# My Project'), 'should preserve existing content');
      assert.ok(content.includes('Existing content here.'), 'should preserve existing content');
      assert.ok(content.includes(MARKER), 'should append DeepGrep section');
    });

    it('is idempotent — does not duplicate section on repeated calls', () => {
      const hm = makeHookManager(workspaceRoot);
      hm.ensureClaudeMd();
      hm.ensureClaudeMd();
      hm.ensureClaudeMd();

      const content = readFileSync(join(workspaceRoot, 'CLAUDE.md'), 'utf8');
      const markerCount = (content.match(new RegExp(MARKER, 'g')) ?? []).length;
      assert.equal(markerCount, 1, 'marker should appear exactly once');
    });

    it('skips existing CLAUDE.md that already contains the marker', () => {
      const claudeMdPath = join(workspaceRoot, 'CLAUDE.md');
      const alreadyInjected = `# My Project\n\n${MARKER} is already here\n`;
      writeFileSync(claudeMdPath, alreadyInjected, 'utf8');

      const hm = makeHookManager(workspaceRoot);
      hm.ensureClaudeMd();

      const content = readFileSync(claudeMdPath, 'utf8');
      assert.equal(content, alreadyInjected, 'file should be unchanged');
    });
  });

  // ── ensureHooks ───────────────────────────────────────────────────────────

  describe('ensureHooks', () => {
    it('creates .claude/settings.json when none exists', () => {
      const hm = makeHookManager(workspaceRoot);
      hm.ensureHooks();

      const settingsPath = join(workspaceRoot, '.claude', 'settings.json');
      assert.ok(existsSync(settingsPath), 'settings.json should be created');
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      assert.ok(settings.hooks?.PreToolUse?.length > 0, 'PreToolUse hook should be registered');
      assert.ok(settings.hooks?.PostToolUse?.length > 0, 'PostToolUse hook should be registered');
    });

    it('creates .claude directory when it does not exist', () => {
      assert.ok(!existsSync(join(workspaceRoot, '.claude')));
      makeHookManager(workspaceRoot).ensureHooks();
      assert.ok(existsSync(join(workspaceRoot, '.claude')));
    });

    it('hook entries reference the correct script names', () => {
      makeHookManager(workspaceRoot).ensureHooks();
      const settings = JSON.parse(
        readFileSync(join(workspaceRoot, '.claude', 'settings.json'), 'utf8'),
      );
      const pre: string = settings.hooks.PreToolUse[0].hooks[0].command;
      const post: string = settings.hooks.PostToolUse[0].hooks[0].command;
      assert.ok(pre.includes('pre-tool-use.mjs'), `PreToolUse should reference pre-tool-use.mjs, got: ${pre}`);
      assert.ok(post.includes('post-tool-use.mjs'), `PostToolUse should reference post-tool-use.mjs, got: ${post}`);
    });

    it('hook entries use matcher "Edit|Write"', () => {
      makeHookManager(workspaceRoot).ensureHooks();
      const settings = JSON.parse(
        readFileSync(join(workspaceRoot, '.claude', 'settings.json'), 'utf8'),
      );
      assert.equal(settings.hooks.PreToolUse[0].matcher, 'Edit|Write');
      assert.equal(settings.hooks.PostToolUse[0].matcher, 'Edit|Write');
    });

    it('is idempotent — repeated calls do not duplicate hooks', () => {
      const hm = makeHookManager(workspaceRoot);
      hm.ensureHooks();
      hm.ensureHooks();
      hm.ensureHooks();

      const settings = JSON.parse(
        readFileSync(join(workspaceRoot, '.claude', 'settings.json'), 'utf8'),
      );
      assert.equal(settings.hooks.PreToolUse.length, 1, 'should not duplicate PreToolUse entry');
      assert.equal(settings.hooks.PostToolUse.length, 1, 'should not duplicate PostToolUse entry');
    });

    it('merges into existing settings.json without overwriting other keys', () => {
      const claudeDir = join(workspaceRoot, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(
        join(claudeDir, 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Bash'] }, hooks: {} }, null, 2),
        'utf8',
      );

      makeHookManager(workspaceRoot).ensureHooks();

      const settings = JSON.parse(
        readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
      );
      assert.deepEqual(settings.permissions?.allow, ['Bash'], 'existing keys must be preserved');
      assert.ok(settings.hooks?.PreToolUse?.length > 0);
    });

    it('recovers gracefully from malformed settings.json', () => {
      const claudeDir = join(workspaceRoot, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), '{ invalid json }', 'utf8');

      // Should not throw
      assert.doesNotThrow(() => makeHookManager(workspaceRoot).ensureHooks());

      const settings = JSON.parse(
        readFileSync(join(claudeDir, 'settings.json'), 'utf8'),
      );
      assert.ok(settings.hooks?.PreToolUse?.length > 0);
    });
  });

  // ── ensureAgentMemoryDirs ─────────────────────────────────────────────────

  describe('ensureAgentMemoryDirs', () => {
    it('creates agent memory directories under .claude/agent-memory/', () => {
      makeHookManager(workspaceRoot).ensureHooks(); // ensure .claude dir first
      makeHookManager(workspaceRoot).ensureAgentMemoryDirs(['indexer', 'graph-analyst']);

      assert.ok(existsSync(join(workspaceRoot, '.claude', 'agent-memory', 'indexer')));
      assert.ok(existsSync(join(workspaceRoot, '.claude', 'agent-memory', 'graph-analyst')));
    });

    it('is idempotent — does not error if directories already exist', () => {
      const hm = makeHookManager(workspaceRoot);
      hm.ensureHooks();
      assert.doesNotThrow(() => {
        hm.ensureAgentMemoryDirs(['indexer']);
        hm.ensureAgentMemoryDirs(['indexer']);
      });
    });

    it('handles empty agent list without error', () => {
      makeHookManager(workspaceRoot).ensureHooks();
      assert.doesNotThrow(() => makeHookManager(workspaceRoot).ensureAgentMemoryDirs([]));
    });
  });

  // ── Standalone workspace integration ─────────────────────────────────────

  describe('standalone workspace setup', () => {
    it('full setup: CLAUDE.md + hooks are both writable in a fresh directory', () => {
      const hm = makeHookManager(workspaceRoot);
      hm.ensureClaudeMd();
      hm.ensureHooks();
      hm.ensureAgentMemoryDirs(['indexer']);

      assert.ok(existsSync(join(workspaceRoot, 'CLAUDE.md')));
      assert.ok(existsSync(join(workspaceRoot, '.claude', 'settings.json')));
      assert.ok(existsSync(join(workspaceRoot, '.claude', 'agent-memory', 'indexer')));

      const claude = readFileSync(join(workspaceRoot, 'CLAUDE.md'), 'utf8');
      assert.ok(claude.includes(MARKER));
      const settings = JSON.parse(
        readFileSync(join(workspaceRoot, '.claude', 'settings.json'), 'utf8'),
      );
      assert.ok(settings.hooks?.PreToolUse?.length > 0);
      assert.ok(settings.hooks?.PostToolUse?.length > 0);
    });
  });
});
