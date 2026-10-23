# syntelab-app-api

The contract between the shell and apps: trait `SyntelabApp`, contract version (`apiVersion`), shared types.

| Module | Job |
|---|---|
| `src/app.rs` | Trait `SyntelabApp` (`invoke` for JSON commands, `resource` for binary data), `AppContext`, `AppError` |
| `src/manifest.rs` | The app manifest (`app.json`) |
| `src/lib.rs` | `API_VERSION` |
