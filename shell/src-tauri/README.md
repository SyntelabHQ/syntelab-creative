# shell/src-tauri — shell Rust side

Starts the program and loads installed apps (through
`crates/syntelab-apps-manager`).

| Part | Job |
|---|---|
| `src/main.rs` | Starts Tauri and registers plugins and commands |
| `src/apps.rs` | `list_apps` command: the apps found on disk |
| `src/app_host.rs` | Runs the apps' Rust side: `app_invoke` command and the `syntelab-app://` scheme for binary data |
| `capabilities/` | What the window may ask the Rust side to do |
| `icons/` | Program icon, generated from `assets/brand/icon.svg` with `node tools/generate-icons.mjs` |
| `tauri.conf.json` | Window, security policy, build settings |

While developing, apps are read from the repository's `apps/` folder. An
installed program reads them from its resources (`<install folder>/apps`): only
each app's `app.json` and its icon go there (`bundle.resources` in
`tauri.conf.json`); the apps' frontends, locales and help are built into the
interface. Add the two lines there when an app is added.
