import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Detect VS Code's Electron version
function detectElectronVersion() {
  // 1. Explicit override
  if (process.env.ELECTRON_VERSION) return process.env.ELECTRON_VERSION;

  // 2. macOS: read CFBundleVersion from Electron Framework plist (most reliable)
  const plist = '/Applications/Visual Studio Code.app/Contents/Frameworks/Electron Framework.framework/Versions/Current/Resources/Info.plist';
  if (existsSync(plist)) {
    try {
      const out = execFileSync('plutil', ['-p', plist], { encoding: 'utf8' });
      const m = out.match(/"CFBundleVersion"\s*=>\s*"([^"]+)"/);
      if (m?.[1]) return m[1];
    } catch { /* fall through */ }
  }

  // 3. Fallback: try package.json electron / electronVersion fields
  const appPkgPath = '/Applications/Visual Studio Code.app/Contents/Resources/app/package.json';
  if (existsSync(appPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(appPkgPath, 'utf8'));
      if (pkg.electron) return pkg.electron;
      if (pkg.electronVersion) return pkg.electronVersion;
    } catch { /* fall through */ }
  }

  return null;
}

const electronVersion = detectElectronVersion();
if (!electronVersion) {
  console.error('Could not detect VS Code Electron version. Set it explicitly: ELECTRON_VERSION=x.y.z pnpm rebuild-native');
  process.exit(1);
}

console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion}...`);
execSync(
  `npx --yes @electron/rebuild@latest -v ${electronVersion} -w better-sqlite3`,
  { cwd: join(root, 'packages/extension'), stdio: 'inherit' },
);
