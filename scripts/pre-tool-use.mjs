#!/usr/bin/env node
/**
 * PreToolUse hook for Claude Code.
 * Reads {tool_name, tool_input} from stdin.
 * Exit 0 = allow, exit 1 = warn (message to stdout), exit 2 = block.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');

let input;
try {
  input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
} catch {
  process.exit(0); // can't parse → allow
}

const { tool_name, tool_input } = input;

if (tool_name !== 'Edit' && tool_name !== 'Write') {
  process.exit(0);
}

const filePath = tool_input?.file_path ?? tool_input?.path ?? '';
const newContent = tool_input?.new_string ?? tool_input?.content ?? '';

// Block direct edits to the DB file — must go through GraphDatabase.ts
if (filePath.includes('.deepgrep/graph.db')) {
  console.error(
    'BLOCKED: Do not edit graph.db directly. Use GraphDatabase.ts methods instead.'
  );
  process.exit(2);
}

// Block schema changes to GraphDatabase.ts without a migration file
if (
  filePath.includes('GraphDatabase.ts') &&
  /DROP\s+TABLE|ALTER\s+TABLE.*RENAME|DROP\s+COLUMN/i.test(newContent)
) {
  console.error(
    'BLOCKED: Destructive schema change detected. Create a migration in packages/extension/src/db/migrations/ first, then update GraphDatabase.ts.'
  );
  process.exit(2);
}

// Warn if editing the SQLite schema outside a migration
if (
  filePath.includes('GraphDatabase.ts') &&
  /CREATE\s+TABLE|ADD\s+COLUMN/i.test(newContent)
) {
  console.log(
    'WARNING: Schema change detected in GraphDatabase.ts. Make sure to bump the schema version in index_metadata and add a migration file.'
  );
  process.exit(1);
}

// Block raw SQL DROP/DELETE in any source file (defensive)
if (/DROP\s+TABLE|DELETE\s+FROM\s+nodes|DELETE\s+FROM\s+edges/i.test(newContent)) {
  console.error(
    'BLOCKED: Potentially destructive SQL detected. If intentional, add a migration file and bypass this check by noting the migration path in your commit.'
  );
  process.exit(2);
}

process.exit(0);
