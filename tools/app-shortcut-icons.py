"""Makes the shortcut of each app in the Windows Start menu: its icon (the app's own icon in white on a rounded
square of its colour, as on the cards of the Start screen), written to shell/src-tauri/icons/apps/<app id>.ico, and
the lines of the installer that make and remove the shortcuts, written to installers/windows/app-shortcuts.nsh.
Only apps that are out (status "active") get one. An app that has `assets/file-icon.svg` (the icon of the files it
opens, as Windows shows them) gets that one too, written to shell/src-tauri/icons/apps/<app id>-file.ico.

Run again when an app is added or its icon or colour changes:  python tools/app-shortcut-icons.py
Needs ImageMagick (`convert`) with SVG support.
"""
import json
import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'shell' / 'src-tauri' / 'icons' / 'apps'
HOOKS = ROOT / 'installers' / 'windows' / 'app-shortcuts.nsh'
SIZES = (16, 20, 24, 32, 40, 48, 64, 256)


def glyph(svg: str, size: float, x: float, y: float) -> str:
    """The shapes of an icon, in white, fitted in a square of `size` whose corner is at x, y."""
    box = [float(part) for part in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    inner = re.sub(r'<!--.*?-->', '', re.sub(r'</svg>\s*$', '', re.sub(r'^.*?<svg[^>]*>', '', svg, flags=re.S)), flags=re.S)
    scale = size / max(box[2], box[3])
    left = x + (size - box[2] * scale) / 2 - box[0] * scale
    top = y + (size - box[3] * scale) / 2 - box[1] * scale
    return f'<g fill="#ffffff" color="#ffffff" transform="translate({left:.2f} {top:.2f}) scale({scale:.4f})">{inner}</g>'


def square(svg: str, color: str) -> str:
    # Icons from Font Awesome's website have a margin in their 640 box; one drawn edge to edge is given a little less
    # room, so it stands as large and clear in its square as the big ones of other programs do.
    share = 0.62 if 'viewBox="0 0 640 640"' in svg else 0.7
    margin = (1 - share) / 2 * 256
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
        f'<rect x="8" y="8" width="240" height="240" rx="52" fill="{color}"/>{glyph(svg, share * 256, margin, margin)}</svg>'
    )


def write_ico(svg: str, target: pathlib.Path) -> None:
    with tempfile.TemporaryDirectory() as work:
        source = pathlib.Path(work) / 'icon.svg'
        source.write_text(svg, encoding='utf-8')
        big = pathlib.Path(work) / 'icon.png'
        subprocess.run(['convert', '-background', 'none', '-density', '192', str(source), '-resize', '256x256', str(big)], check=True)
        subprocess.run(['convert', str(big), '-define', f'icon:auto-resize={",".join(map(str, SIZES))}', str(target)], check=True)


# The folder of the Start menu the shortcuts of the apps are in. The shortcut of the program itself is made by Tauri's
# installer, outside it.
FOLDER = 'Syntelab Creative'


# On uninstall, the program is also taken out of the apps that open PDF files (see
# crates/syntelab-platform/src/default_app.rs); the user's own choice (UserChoice) is left to Windows.
DEFAULT_APP = (
    '  DeleteRegValue HKCU "Software\\RegisteredApplications" "SyntelabCreative"\n'
    '  DeleteRegKey HKCU "Software\\SyntelabCreative"\n'
    '  DeleteRegValue HKCU "Software\\Classes\\.pdf\\OpenWithProgids" "SyntelabCreative.pdf"\n'
    '  DeleteRegKey HKCU "Software\\Classes\\SyntelabCreative.pdf"\n'
)


def hooks(apps: list) -> str:
    """The installer hooks of Tauri's NSIS installer: a shortcut for each app, made on install (and on every update),
    taken away on uninstall. A shortcut is named as the app ("PDF Organizer") and kept in the folder "Syntelab
    Creative"; its comment names the program too. Versions up to 1.0.0 named them "Syntelab PDF Organizer" outside
    the folder: those are taken away as well."""
    make, remove = [], []
    folder = f'$SMPROGRAMS\\{FOLDER}'
    for app, name, about in apps:
        link = f'"{folder}\\{name}.lnk"'
        former = f'"$SMPROGRAMS\\Syntelab {name}.lnk"'
        about = f'{about} Part of {FOLDER}.'.replace('"', "'")
        make.append(f'  Delete {former}')
        make.append(f'  CreateShortCut {link} "$INSTDIR\\${{MAINBINARYNAME}}.exe" "--app {app}" "$INSTDIR\\icons\\apps\\{app}.ico" 0 SW_SHOWNORMAL "" "{about}"')
        remove.append(f'  Delete {link}')
        remove.append(f'  Delete {former}')
    return (
        '; Made by tools/app-shortcut-icons.py: do not change by hand, run the script again.\n'
        f'; A shortcut in the Start menu for each app, in the folder "{FOLDER}": it opens Syntelab Creative right in that app\n'
        '; (--app <app id>). The names of versions up to 1.0.0 ("Syntelab <app>", outside the folder) are taken away.\n\n'
        '!macro NSIS_HOOK_POSTINSTALL\n'
        f'  CreateDirectory "{folder}"\n' + '\n'.join(make) + '\n'
        # The shortcuts get the ids of the app windows before anyone can pin one (the program does it, and exits).
        '  ExecWait \'"$INSTDIR\\${MAINBINARYNAME}.exe" --tag-shortcuts\'\n'
        '!macroend\n\n'
        '!macro NSIS_HOOK_PREUNINSTALL\n' + '\n'.join(remove) + f'\n  RMDir "{folder}"\n' + DEFAULT_APP + '!macroend\n'
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for manifest_path in sorted((ROOT / 'apps').glob('*/app.json')):
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest.get('status') != 'active':
            continue
        app = manifest_path.parent.name
        icon = (manifest_path.parent / 'assets' / 'icon.svg').read_text(encoding='utf-8')
        write_ico(square(icon, manifest['brand']['color']), OUT / f'{app}.ico')
        file_icon = manifest_path.parent / 'assets' / 'file-icon.svg'
        if file_icon.is_file():
            write_ico(file_icon.read_text(encoding='utf-8'), OUT / f'{app}-file.ico')
            print(f'{app}-file.ico')
        made.append((app, manifest['name']['en'], manifest['description']['en']))
        print(f'{app}.ico')
    HOOKS.write_text(hooks(made), encoding='utf-8', newline='\r\n')
    print(HOOKS.relative_to(ROOT))


if __name__ == '__main__':
    main()
