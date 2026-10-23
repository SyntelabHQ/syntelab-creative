# installers — installers and packages

All built from the same code. Details: `CONCEPT.md`, section 10.

| Platform | Variants | Folder |
|---|---|---|
| Windows 10/11 | installer (.exe/.msi), portable (.zip), Microsoft Store (MSIX), winget | `windows/` |
| Linux | .deb, .rpm, AppImage, Flathub, Snap | `linux/` |
| macOS (later) | .dmg, unsigned at first | `macos/` |

The classic installer lets the user choose apps. In other variants,
apps are added in Settings → Apps and downloaded into the user's folder.

Each platform folder will have `locales/` (installer texts) and `store/`
(store listings per language).
