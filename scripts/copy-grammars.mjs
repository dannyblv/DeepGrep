import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'packages/extension/node_modules/tree-sitter-wasms/out');
const dest = join(root, 'packages/extension/grammars');

mkdirSync(dest, { recursive: true });

const langs = ['typescript', 'tsx', 'javascript', 'python', 'go', 'rust'];
for (const lang of langs) {
  const file = `tree-sitter-${lang}.wasm`;
  const from = join(src, file);
  if (existsSync(from)) {
    copyFileSync(from, join(dest, file));
    console.log(`copied ${file}`);
  } else {
    console.warn(`missing: ${file}`);
  }
}
