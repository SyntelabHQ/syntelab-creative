// Regenerates the program icons (window, taskbar, installer) from the logo.
//
//   node tools/generate-icons.mjs
//
// Reads assets/brand/icon.svg (one color) and draws it in white on a rounded
// square in the brand color. Writes shell/src-tauri/icons/icon.{ico,icns,png}.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRAND_COLOR = '#007BFF';
// apps/ holds the app shortcut icons (tools/app-shortcut-icons.py); it is kept too.
const KEEP = new Set(['icon.ico', 'icon.icns', 'icon.png', 'apps']);

const root = fileURLToPath(new URL('..', import.meta.url));
const shellDir = join(root, 'shell');
const iconsDir = join(shellDir, 'src-tauri', 'icons');

const logo = readFileSync(join(root, 'assets', 'brand', 'icon.svg'), 'utf8');
// The logo is nested in the tile, centered, at 80% of its side (as in shell/src/brand/brand-logo.tsx).
const glyph = logo.replace('<svg ', '<svg x="102" y="102" width="820" height="820" fill="#FFFFFF" ');
const svg = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
  `<rect x="48" y="48" width="928" height="928" rx="208" fill="${BRAND_COLOR}"/>`,
  glyph,
  '</svg>',
].join('\n');

const workDir = mkdtempSync(join(tmpdir(), 'syntelab-icon-'));
try {
  const source = join(workDir, 'icon.svg');
  writeFileSync(source, svg);
  // Paths are quoted because the command goes through a shell (npx is a script on Windows).
  execFileSync('npx', ['tauri', 'icon', JSON.stringify(source), '-o', 'src-tauri/icons'], {
    cwd: shellDir,
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: true,
  });
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

// The Tauri CLI also writes mobile and Store sizes; only desktop icons are used.
for (const name of readdirSync(iconsDir)) {
  if (!KEEP.has(name)) rmSync(join(iconsDir, name), { recursive: true, force: true });
}
console.log(`Program icons written to ${iconsDir}`);
