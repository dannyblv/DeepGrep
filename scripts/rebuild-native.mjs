import { execSync, execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Detect VS Code's Electron version from the installed app (macOS)
let electronVersion;
try {
  const vscodeAppPkg = JSON.parse(
    readFileSync('/Applications/Visual Studio Code.app/Contents/Resources/app/package.json', 'utf8'),
  );
  electronVersion = vscodeAppPkg.electron;
} catch {
  // Fall back to reading from the extension's installed vscode module
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, 'packages/extension/node_modules/vscode/package.json'), 'utf8'),
    );
    electronVersion = pkg.electronVersion;
  } catch {
    console.error('Could not detect VS Code Electron version. Pass it explicitly: ELECTRON_VERSION=x.y.z pnpm rebuild-native');
    process.exit(1);
  }
}

if (process.env.ELECTRON_VERSION) {
  electronVersion = process.env.ELECTRON_VERSION;
}

console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion}...`);
execSync(
  `npx --yes @electron/rebuild@latest -v ${electronVersion} -w better-sqlite3`,
  { cwd: join(root, 'packages/extension'), stdio: 'inherit' },
);
