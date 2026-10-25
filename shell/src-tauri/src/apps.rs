//! Commands that tell the interface which apps exist.

use std::path::PathBuf;

use syntelab_apps_manager::{discover_apps, DiscoveredApp};
use tauri::{AppHandle, Manager};

/// Where the app folders are: the repository's `apps/` while developing, the
/// program's resources once installed.
pub(crate) fn apps_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps"));
    }
    app.path()
        .resource_dir()
        .map(|resources| resources.join("apps"))
        .map_err(|error| error.to_string())
}

/// Every app found on disk that follows this shell's contract version.
#[tauri::command]
pub fn list_apps(app: AppHandle) -> Result<Vec<DiscoveredApp>, String> {
    discover_apps(&apps_dir(&app)?).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use syntelab_apps_manager::discover_apps;

    /// An installed program finds only the app files `tauri.conf.json` bundles.
    #[test]
    fn the_installer_bundles_every_app_manifest_and_icon() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json is JSON");
        let resources = &config["bundle"]["resources"];
        let apps = discover_apps(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps")).expect("apps folder");

        assert!(!apps.is_empty());
        for app in apps {
            let id = &app.manifest.id;
            for file in ["app.json", app.manifest.brand.icon.as_str()] {
                let target = format!("apps/{id}/{file}");
                assert_eq!(resources[format!("../../apps/{id}/{file}")], target.as_str(), "{target} is not bundled");
            }
        }
    }
}
