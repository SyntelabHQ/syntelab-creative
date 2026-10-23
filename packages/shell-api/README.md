# shell-api

What an app's interface gets from the shell: open tabs, register commands, settings, jobs, theme, language.

| File | Job |
|---|---|
| `src/app-frontend.ts` | `AppFrontend` (what an app exports) and `AppHost` (what each of its tabs gets: `invoke`, `resourceUrl`, `pickFiles`, `pickSavePath`, `pickFolder`, `printImages`, `shareFile`, `registerCommands`, `loadData`/`saveData`, `setImmersive`, `setUnsavedChanges`, `openTab`, `closeTab`) |
| `src/app-manifest.ts` | The app manifest types and the contract version |
| `src/data-store.ts` | `createDataStore` / `useDataStore`: data an app keeps under one key (its settings), read once and shared by all its tabs |
| `src/use-tab-commands.ts` | `useTabCommands`: registers a tab's commands while the tab is in front |
| `src/file-path.ts` | `fileName`, `folderOf`, `fileEnding`: the parts of a file's path, Windows or Unix |

Jobs (progress, cancel) and app settings screens are not written yet.
