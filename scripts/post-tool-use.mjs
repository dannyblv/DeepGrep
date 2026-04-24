#!/usr/bin/env node
/**
 * PostToolUse hook for Claude Code.
 * Reads {tool_name, tool_input, tool_response} from stdin.
 * Appends edited file to .deepgrep/reindex-queue.json so the extension picks it up.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const QUEUE_PATH = resolve(ROOT, '.deepgrep/reindex-queue.json');
const DEEPGREP_DIR = resolve(ROOT, '.deepgrep');

let input;
try {
  input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
} catch {
  process.exit(0);
}

const { tool_name, tool_input } = input;

if (tool_name !== 'Edit' && tool_name !== 'Write') {
  process.exit(0);
}

const filePath = tool_input?.file_path ?? tool_input?.path ?? '';
if (!filePath || filePath.includes('node_modules') || filePath.includes('.deepgrep')) {
  process.exit(0);
}

// Only queue source files that Tree-sitter can parse
const INDEXABLE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h'];
const ext = filePath.match(/\.[^.]+$/)?.[0] ?? '';
if (!INDEXABLE_EXTS.includes(ext)) {
  process.exit(0);
}

if (!existsSync(DEEPGREP_DIR)) {
  mkdirSync(DEEPGREP_DIR, { recursive: true });
}

let queue = [];
if (existsSync(QUEUE_PATH)) {
  try { queue = JSON.parse(readFileSync(QUEUE_PATH, 'utf8')); } catch { queue = []; }
}

const entry = { path: filePath, queuedAt: Date.now() };
// Deduplicate by path
queue = queue.filter(e => e.path !== filePath);
queue.push(entry);

writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
process.exit(0);
