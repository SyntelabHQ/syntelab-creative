# Dev

Tools for developers: encoders, formatters and converters of data, generators,
inspectors and network tools, in one app of Syntelab Creative.

Status: **in progress**. The tools of `PLAN.md` are built; what is still
open is in `BACKLOG.md`. No tool has a most for what it works on: the limit is the
hardware.

| File | Contents |
|---|---|
| `PLAN.md` | What the app holds and the order it is built in |
| `BACKLOG.md` | What is still open |
| `app.json` | App manifest |
| `frontend/` | React: the first page, the frame of a tool, the tools, the settings, the commands |
| `backend/` | Rust (crate `dev-backend`): one module for each tool, files, progress and Stop |
| `locales/` | App texts (`en.json` is the source) |
