# App contract

Every app provides, in its folder:

| What | Where | Purpose |
|---|---|---|
| `app.json` | app root | id, names/descriptions per language, version, color, icon, default layout, add-ons, file types, right-click entries |
| Rust backend | `backend/` | implements trait `SyntelabApp` from `crates/syntelab-app-api` |
| React frontend | `frontend/` | exports tab views and the command list |
| Translations | `locales/<lang>.json` | app texts, namespace `<app-id>.*`, source in English |
| Icon and color | `assets/` | for the start screen and app bar |

## What an app gets from the shell
- Opening tabs (next to tabs from other apps).
- Command registry (ribbon / menu / panel / search / shortcuts).
- Its own settings, shown in Settings → Apps → <app>.
- Jobs: progress, cancel, notifications.
- Theme, language, text direction (LTR/RTL), translation lookup.
- Disk cache (e.g. thumbnails).

## What an app must not do
- Go online bypassing the shell.
- Depend directly on another app or its translations.
- Add heavy dependencies to the shell (those go into add-ons).
- Hard-code visible text.

## App states
`coming-soon` → `available` → `installed` → `enabled` / `disabled` → `uninstalled`.

The contract has a version (`apiVersion`). The shell refuses apps with
an incompatible contract and offers an update.

## How the two sides talk (contract version 1)

```
app interface (React)                     app Rust side (SyntelabApp)
  host.invoke(command, payload)   ──►  invoke(command, payload) -> JSON
  <img src={host.resourceUrl(…)}> ──►  resource(request, reply) -> bytes
```

- The interface exports an `AppFrontend` from `apps/<app-id>/frontend/index.ts`
  and gets an `AppHost` per tab (`packages/shell-api`).
- The Rust side implements `SyntelabApp` (`crates/syntelab-app-api`). The
  shell routes requests to it: JSON through the `app_invoke` command, binary
  data through `syntelab-app://localhost/<app-id>/<path>`.
- What an app's interface gets from the shell, per tab (`AppHost`), besides
  `invoke` and `resourceUrl`:
  - the system's windows: `pickFiles`, `pickSavePath`, `pickFolder`;
  - `registerCommands`: the app's commands, shown by the menus, the ribbon,
    the side panel, the search, and run by their keyboard shortcuts;
  - `printImages`: prints pictures, one per sheet, through the system's
    print window, on the paper and in the layout the app asks for;
  - `shareFile`: hands a file to the system's "Share" window;
  - files the program is started with are opened by the app whose manifest
    lists their kind in `fileTypes`, as a tab with `params.path`; an entry
    of the file manager's menu (`contextMenu` in the manifest, each with its
    `fileTypes`; `contextMenuGrouped: true` gathers them under one entry
    named after the app) opens a tab with `params.launch` (the entry's id) and
    `params.files` (the files, as JSON);
  - `openLink`: hands a web or mail address the user clicked to the system
    (the browser, the mail program); nothing else is opened;
  - `saveWebPage`: saves a web page the user typed the address of as a PDF
    (the only way an app reaches the network; see `crates/syntelab-net`);
  - `loadData` / `saveData`: small data kept on this computer, per app;
  - `setUnsavedChanges`: marks the tab, so closing it asks first;
  - `openTab` / `closeTab`, `immersive` / `setImmersive`;
  - `openSettings`: shows Settings at the app's own part.
  An app never reaches the system, the network or its own Rust side in any
  other way.
- An `AppFrontend` may also export `Settings`: the app's own settings, shown in
  its part of the Settings page under what the shell offers for every app
  (its layout, which overrides the general one). It gets `loadData` /
  `saveData` only; settings apply to that app and nothing else.
- A command may be `explained`: where the layout has room (a ribbon group of
  its own), what it is for is written out beside its button.
- `resource` answers through a callback, so an app can queue requests and
  drop the ones that are no longer needed (fast scrolling).
- For now the Rust side of each app is compiled into the program. Loading
  apps installed on demand is designed with the app manager (PLAN.md, step 4).

## What the search of the Start page finds

The search on the Start page finds every app that can be used, by its name
and by what it is for, and the commands of the program. An app can also
say what in it is worth finding by itself: a tool, a converter. It lists
them in its manifest, under `search`:

```json
"search": [{ "id": "base64", "labelKey": "dev.tool.base64", "params": { "tool": "base64" } }]
```

`labelKey` is the name of the thing in the app's translations; `params` is
what the tab opened for it is given (`AppHost.params`), which the app
already reads to open on that thing. The tab is named after the first of
the params (`tool:base64`), as the app names its own tab for the same
thing, so a tab that is open is come back to. Dev lists its tools so, and
Units its converters.
