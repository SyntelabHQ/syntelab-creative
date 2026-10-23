# App distribution and updates

- The installer contains the shell and, optionally, the selected apps.
- Other apps are downloaded from the **app catalog** on syntelab.com
  (`remote/apps-catalog.example.json`).
- Every app package has a **checksum** and a **signature**; the shell
  checks both before installing.
- An app package contains its translations for all languages (text is small).
- Disk locations (proposed):
  - Windows: `%LOCALAPPDATA%\Syntelab Creative\apps\<id>\<version>\`
  - Linux: `~/.local/share/syntelab-creative/apps/<id>/<version>/`
- Updates: the shell checks (if allowed) and **asks** before installing.
  No silent installs.
  - The check reads `https://syntelab.com/creative/check/update.json` (the file is
    `remote/creative/check/update.json`) through `crates/syntelab-net`, at start when the
    user leaves online checks on, and when "Check for updates" is pressed.
  - A newer version is announced once in a window, then stays as an icon in
    the app bar and a line under Start and in Settings.
  - "Update" installs it from inside the program (the updater of Tauri,
    `tauri-plugin-updater`): it reads the same `update.json`, downloads the
    installer named under `platforms` (on GitHub Releases, following GitHub's
    redirect to its download host; this download is the updater's own, not
    through `crates/syntelab-net`), refuses it unless it is signed with the
    update key (its public half is in `tauri.conf.json`), installs it and
    starts the program again. Only after the user presses "Update".
  - "Download" opens the download page in the browser
    (`https://syntelab.com/creative/download`): for portable copies, Linux
    packages, and when "Update" fails.
- No telemetry: requests are plain static file downloads.
