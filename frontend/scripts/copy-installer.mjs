// After `vite build --mode web`: zip the latest Windows installer (release/MyTodoEase-Setup-<version>.exe, built by
// `npm run build`) into the web site as /downloads/MyTodoEase-Setup-Windows.zip for the landing page's download
// button. Zipped because Firebase Hosting's free plan refuses .exe files. Skips quietly when no installer exists.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const releaseDir = path.join(root, 'release');
const outDir = path.join(root, 'frontend', 'dist-web', 'downloads');
const outFile = path.join(outDir, 'MyTodoEase-Setup-Windows.zip');

const installers = existsSync(releaseDir)
  ? readdirSync(releaseDir).filter((f) => /^MyTodoEase-Setup-.*\.exe$/i.test(f)).map((f) => path.join(releaseDir, f))
  : [];
if (installers.length === 0) {
  console.warn('[copy-installer] no release/MyTodoEase-Setup-*.exe found; the Windows download link will 404 until `npm run build` runs.');
  process.exit(0);
}
const latest = installers.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
mkdirSync(outDir, { recursive: true });
if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -LiteralPath '${latest}' -DestinationPath '${outFile}' -Force`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-j', outFile, latest], { stdio: 'inherit' });
}
console.log(`[copy-installer] ${path.basename(latest)} -> dist-web/downloads/MyTodoEase-Setup-Windows.zip (${(statSync(outFile).size / 1e6).toFixed(0)} MB)`);
