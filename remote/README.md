# remote — static files on syntelab.com

The program only **reads** these files. No cookies, no identifiers, no tracking.
It reads them through `crates/syntelab-net`, which knows their addresses
(`src/remote_file.rs`) and can contact nothing else. The updater of Tauri
reads `update.json` too, and downloads the installer it names, but only after
the user presses "Update". The installers are on GitHub Releases, not on
syntelab.com (they are larger than the 25 MB a file may have on the site): the
updater has its own downloads, outside `syntelab-net`, follows GitHub's
redirect to `release-assets.githubusercontent.com` / `objects.githubusercontent.com`
and installs nothing that is not signed with the update key.

| File | URL | Role | File here |
|---|---|---|---|
| update | `https://syntelab.com/creative/check/update.json` | the newest version, its installers and the page to download it from | `creative/check/update.json` |
| changelog | `https://syntelab.com/creative/check/changelog/<language>.json` (`en.json`, `ro.json`, `pt-BR.json`…) | what is new: program changes and announcements, one file per language | `creative/check/changelog/` |
| installers | `https://github.com/SyntelabHQ/syntelab-creative/releases/download/v<version>/syntelab-creative-setup.exe` | the installer of each version, on GitHub Releases, for "Update" (named in `update.json`) | built, not kept here |
| newest installer | `https://github.com/SyntelabHQ/syntelab-creative/releases/latest/download/syntelab-creative-setup.exe` | always the installer of the newest release: the Download button of the site links here | built, not kept here |
| app catalog | `https://syntelab.com/creative/apps/catalog.json` (proposed, not read yet) | which apps/add-ons exist, versions, links, checksums, names per language | `apps-catalog.example.json` |

**These addresses never change** (those on syntelab.com). Every installed copy has them written in it;
a file moved elsewhere is never found again by the copies already out there.
The server must answer with the file itself: no redirect to another host, no
page of the site in its place.

The site is static: the path of a file on the site is its path in the folder
that is uploaded. The `creative` folder here is laid out as on the site:
`creative/check/update.json` here is
`https://syntelab.com/creative/check/update.json`, so the whole `creative`
folder can be uploaded (or archived and deployed) as it is.

Both files that are read are checked at start, if the user leaves "Check for
updates and news when the program starts" on (Settings), and whenever the user
presses "Check for updates".

Other links the program opens in the browser:
- `https://syntelab.com/<lang>/support` — donations
- `https://syntelab.com/<lang>/feedback` — problem reports
- the `download` page named in `update.json`
  (`https://syntelab.com/creative/download`; one outside syntelab.com is
  ignored)

## The update key

Every installer that "Update" installs must be signed with the update key.
It was made once with:

```
npx tauri signer generate -w "$env:USERPROFILE\.tauri\syntelab-creative.key"
```

- `syntelab-creative.key` is the secret half. It never goes into this folder,
  to anyone, or online. Keep a copy (a USB stick, a password manager) and its
  password. If it is lost, the copies already installed can no longer update
  themselves: their users have to install the next version by hand.
- `syntelab-creative.key.pub` is the public half. Its text is `plugins.updater.pubkey`
  in `shell/src-tauri/tauri.conf.json`.

This is a different thing from signing the installer for Windows (SignPath);
both are needed.

## Publishing a new version

1. Raise the version in `shell/src-tauri/tauri.conf.json`, `Cargo.toml`
   (`[workspace.package]`) and `package.json`.
2. Build, in your own PowerShell, from the project folder, with the key given
   for this window only:

   ```
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\syntelab-creative.key" -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Read-Host "Key password"
   npm run build
   ```

   In `target\release\bundle\nsis\` you get `Syntelab Creative_<version>_x64-setup.exe`
   and, beside it, the same name with `.sig` at the end. `tools\build-release.ps1` also
   copies both to `syntelab-creative-setup.exe` (and `.sig`): the same installer under a
   name without the version, for a download link that never changes.
3. Add an item at the top of `creative/check/changelog/en.json` (a new `id`, the date, title and
   body; optionally `link` and `linkLabel`), and the same item, with the same
   `id` and date, in the file of each other language.
4. In `creative/check/update.json` set:
   - `version`: the new version, like `1.4.0`;
   - `pub_date`: when it was published, like `2026-11-01T00:00:00Z`;
   - `notes` (English) and `notes_by_language` (every language);
   - under `platforms` → `windows-x86_64`: `url`,
     `https://github.com/SyntelabHQ/syntelab-creative/releases/download/v<version>/syntelab-creative-setup.exe`,
     and `signature`, the whole text of `syntelab-creative-setup.exe.sig`.
5. On GitHub, make a release with the tag `v<version>` (like `v1.4.0`) and attach
   `syntelab-creative-setup.exe` (the copy without the version that the build
   makes). Then upload the `creative` folder to the site (with
   `check/update.json` and `check/changelog/`). The release first: a copy that
   reads the new `update.json` must find its installer there. The site's
   Download button links to
   `https://github.com/SyntelabHQ/syntelab-creative/releases/latest/download/syntelab-creative-setup.exe`,
   which GitHub always sends to the newest release.

Programs already installed see the new version at their next check.

### Linux and macOS

These are built on GitHub, not on the Windows PC: pushing the tag `v<version>`
runs `.github/workflows/release.yml`, which builds them and attaches them to a
draft release with that tag (`syntelab-creative.deb`, `.rpm`, `.AppImage`,
`.dmg`, plus `.AppImage.sig`, `.app.tar.gz` and `.app.tar.gz.sig` for the
updater). Before the first run, add two secrets on GitHub (Settings → Secrets
and variables → Actions): `TAURI_SIGNING_PRIVATE_KEY` (the text of
`syntelab-creative.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (its
password; leave it empty if there is none). They are not tested yet; the
macOS build is not signed by Apple.

To let installed copies update themselves, add under `platforms` in
`update.json`:
- `linux-x86_64`: `url` `…/releases/download/v<version>/syntelab-creative.AppImage`,
  `signature` the text of `syntelab-creative.AppImage.sig`;
- `darwin-aarch64` and `darwin-x86_64` (the same build serves both): `url`
  `…/releases/download/v<version>/syntelab-creative.app.tar.gz`, `signature`
  the text of `syntelab-creative.app.tar.gz.sig`.

## The two files

`creative/check/changelog/<language>.json` are the real files, not examples: they are bundled
with the program (shown in the Changelog window even offline) and are the
files to publish on the website. Each holds the items of one language, with
plain texts:

```json
{ "items": [ { "id": "1.0.0", "date": "2026-10-23", "title": "…", "body": "…" } ] }
```

`link` (an address) and `linkLabel` (its text) are optional. The program
downloads only the file of the language it shows; when that file is not on the
website, it downloads `en.json`. A language with no file at all shows the
English texts. The items read are added to the bundled ones; an item with the
same `id` takes its texts from the website. Since the bundled files already
hold every item up to the version installed, old items can be removed from
the website. An announcement that is not tied to a version is just another
item.

`update.json` is read by the program's own check and by the updater of Tauri:

| Field | Meaning |
|---|---|
| `version` | the newest version, like `1.4.0` |
| `pub_date` | when it was published, like `2026-11-01T00:00:00Z` |
| `notes` | what is new, in English, one text (the updater of Tauri reads only this) |
| `notes_by_language` | what is new, per language; shown in the update window |
| `download` | the page to get it from by hand |
| `platforms` | for each system, the installer's `url` and its `signature` (the text of its `.sig` file) |

Names of systems under `platforms`: `windows-x86_64`, `linux-x86_64`
(AppImage) and `darwin-aarch64`, `darwin-x86_64` (macOS). A system that is
not listed gets only the download page.
