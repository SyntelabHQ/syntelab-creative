# 0002 — Tauri + Rust + TypeScript/React

**Context:** The app must be light and fast on Windows and Linux.

**Decision:** Tauri (uses the system web view, does not bundle a browser like Electron), Rust backend, TypeScript + React interface.

**Consequences:** Small installer. On Linux it depends on WebKitGTK. The UI is tested on WebView2 (Windows) and WebKitGTK (Linux).
