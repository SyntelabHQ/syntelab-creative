import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The shell reads locales/, apps/ and assets/ from the repository root.
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

// One place holds the program's version: the Tauri configuration.
const tauriConfig = JSON.parse(
  readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(tauriConfig.version) },
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: [repositoryRoot] },
    watch: { ignored: ['**/src-tauri/**', '**/target/**'] },
  },
  build: {
    // WebView2 on Windows, WebKitGTK/WKWebView elsewhere.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
