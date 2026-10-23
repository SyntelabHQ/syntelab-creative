# syntelab-apps-manager

Reads the catalog from syntelab.com, downloads, verifies (checksum + signature), installs and enables apps and add-ons.

For now: `discover_apps` (`src/discovery.rs`), which reads every
`<apps-dir>/<app-id>/app.json` and its icon. The rest comes with PLAN.md, step 4.
