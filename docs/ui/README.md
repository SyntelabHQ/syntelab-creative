# Interface (shared by all apps)

- **Layouts:** classic, ribbon (quick collapse), side panel (left/right).
  Chosen on first run with a preview; changeable any time.
- **Search** across all commands and settings, in the user's language and English.
- **Customization:** buttons, positions, shortcuts.
- **Themes:** light, dark, automatic.
- **RTL:** ar, fa, he, ur — the interface is mirrored.
- **Longer text:** layouts must survive translations ~40% longer than English.
- **Start screen:** apps, recent files, donation banner (always
  visible, never blocking). The changelog opens from the app bar.

All commands come from the command registry (`packages/command-registry`),
so the three layouts show the same commands.

**Icons:** Font Awesome Free (https://fontawesome.com), as SVG files in
`assets/icons/` (see the README there).
