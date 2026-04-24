import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

export interface IndexSummary {
  nodes: number;
  edges: number;
  files?: number;
  duration_ms: number;
}

/** Path to the compiled deepgrep-indexer binary (cargo build --release). */
export function getIndexerBinary(workspaceRoot: string): string {
  return resolve(workspaceRoot, 'target', 'release', 'deepgrep-indexer');
}

export function indexerExists(workspaceRoot: string): boolean {
  return existsSync(getIndexerBinary(workspaceRoot));
}

/** Run `deepgrep-indexer index --workspace <ws> --db <db>` */
export function indexWorkspace(
  workspaceRoot: string,
  dbPath: string,
  onProgress?: (msg: string) => void,
): Promise<IndexSummary> {
  return run(
    workspaceRoot,
    ['index', '--workspace', workspaceRoot, '--db', dbPath],
    onProgress,
  );
}

/** Run `deepgrep-indexer reindex <file> --workspace <ws> --db <db>` */
export function reindexFile(
  filePath: string,
  workspaceRoot: string,
  dbPath: string,
): Promise<IndexSummary> {
  return run(workspaceRoot, ['reindex', filePath, '--workspace', workspaceRoot, '--db', dbPath]);
}

function run(
  workspaceRoot: string,
  args: string[],
  onProgress?: (msg: string) => void,
): Promise<IndexSummary> {
  return new Promise((resolve_cb, reject) => {
    const binary = getIndexerBinary(workspaceRoot);
    const proc = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      stderr += msg + '\n';
      onProgress?.(msg);
    });

    proc.on('error', (err) => reject(new Error(`Failed to spawn indexer: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Indexer exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        const summary = JSON.parse(stdout.trim()) as IndexSummary;
        resolve_cb(summary);
      } catch {
        resolve_cb({ nodes: 0, edges: 0, duration_ms: 0 });
      }
    });
  });
}
