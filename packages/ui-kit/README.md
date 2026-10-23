# ui-kit

Shared components (buttons, dialogs, lists), themes and RTL support (logical CSS properties only: `margin-inline-start`, not `margin-left`), so every app looks the same.

## Modules

| Folder | Job |
|---|---|
| `src/styles/` | Design tokens (light/dark) and base styles; import `@syntelab/ui-kit/styles.css` once |
| `src/theme/` | Resolve and apply light/dark/automatic |
| `src/button/` | `Button`, `IconButton` |
| `src/icon/` | `Icon` (interface icons), `SvgMaskIcon` (app icons in the current color) |
| `src/dismiss/` | `useDismiss`: close popups on Escape or outside click |
| `src/dialog/` | `Dialog`: a modal window over the program |
| `src/progress/` | `ProgressCard`: lies over what does something long, with how far it has got and a Stop button |
| `src/tooltip/` | `tooltip()`: tooltip attributes for any element; `IconButton` adds its own from its name |
