# integrations — OS integration

Shared code for the right-click menu and file associations. Each app
declares in `app.json` which entries it wants; they are registered here.
Entry labels come from the app's translations. Everything can be turned
on/off in settings.

| Folder | What it does |
|---|---|
| `windows-shell/` | Windows Explorer right-click menu |
| `linux-desktop/` | `.desktop` file, MIME associations, file manager actions |
