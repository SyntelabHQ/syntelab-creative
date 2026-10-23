//! Finds apps on disk: one folder per app, each with an `app.json`.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use syntelab_app_api::{AppManifest, API_VERSION};

const MANIFEST_FILE: &str = "app.json";
/// Icons are small; anything larger is not an icon.
const MAX_ICON_BYTES: u64 = 256 * 1024;

/// An app as the shell lists it. Mirrors `AppEntry` in `packages/shell-api`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredApp {
    pub manifest: AppManifest,
    /// SVG source of the app icon, when the manifest points at a readable one.
    pub icon_svg: Option<String>,
}

/// Reads every `<apps_dir>/<app-id>/app.json`, sorted by app id.
///
/// A folder is skipped (with a note on stderr) when its manifest cannot be
/// read, names a different id than the folder, or was written for another
/// contract version. Only a missing or unreadable `apps_dir` is an error.
pub fn discover_apps(apps_dir: &Path) -> io::Result<Vec<DiscoveredApp>> {
    let mut apps = Vec::new();

    for entry in fs::read_dir(apps_dir)? {
        let app_dir = entry?.path();
        if !app_dir.join(MANIFEST_FILE).is_file() {
            continue;
        }
        match read_app(&app_dir) {
            Ok(app) => apps.push(app),
            Err(reason) => eprintln!("skipping app in {}: {reason}", app_dir.display()),
        }
    }

    apps.sort_by(|a, b| a.manifest.id.cmp(&b.manifest.id));
    Ok(apps)
}

fn read_app(app_dir: &Path) -> Result<DiscoveredApp, String> {
    let text = fs::read_to_string(app_dir.join(MANIFEST_FILE)).map_err(|error| error.to_string())?;
    let manifest: AppManifest = serde_json::from_str(&text).map_err(|error| error.to_string())?;

    let folder = app_dir.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    if manifest.id != folder {
        return Err(format!("manifest id \"{}\" does not match the folder name", manifest.id));
    }
    if manifest.api_version != API_VERSION {
        return Err(format!(
            "contract version {} is not supported (expected {API_VERSION})",
            manifest.api_version
        ));
    }

    let icon_svg = read_icon(app_dir, &manifest.brand.icon);
    Ok(DiscoveredApp { manifest, icon_svg })
}

/// Reads the icon when its path stays inside the app folder and it is an SVG
/// of a sensible size.
fn read_icon(app_dir: &Path, relative: &str) -> Option<String> {
    let path = inside(app_dir, relative)?;
    let is_svg = path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("svg"));
    if !is_svg || fs::metadata(&path).ok()?.len() > MAX_ICON_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// Joins `relative` to `base`, refusing absolute paths and `..`.
fn inside(base: &Path, relative: &str) -> Option<PathBuf> {
    let relative = Path::new(relative);
    let stays_inside = relative
        .components()
        .all(|component| matches!(component, Component::Normal(_) | Component::CurDir));
    stays_inside.then(|| base.join(relative))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repository_apps() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps")
    }

    #[test]
    fn finds_the_apps_in_the_repository() {
        let apps = discover_apps(&repository_apps()).expect("apps folder is readable");
        let ids: Vec<&str> = apps.iter().map(|app| app.manifest.id.as_str()).collect();

        assert!(ids.contains(&"convert") && ids.contains(&"pdf-organizer"));
        assert!(ids.is_sorted());
        assert!(apps.iter().all(|app| app.icon_svg.as_deref().is_some_and(|svg| svg.contains("<svg"))));
    }

    #[test]
    fn serializes_with_the_field_names_the_frontend_expects() {
        let apps = discover_apps(&repository_apps()).expect("apps folder is readable");
        let json = serde_json::to_value(&apps[0]).expect("serializable");

        assert!(json["iconSvg"].is_string());
        assert_eq!(json["manifest"]["id"], "convert");
    }

    #[test]
    fn keeps_icon_paths_inside_the_app_folder() {
        let base = Path::new("apps/demo");

        assert_eq!(inside(base, "assets/icon.svg"), Some(base.join("assets/icon.svg")));
        assert_eq!(inside(base, "../other/icon.svg"), None);
        assert_eq!(inside(base, "/etc/passwd"), None);
        assert_eq!(inside(base, "C:\\Windows\\icon.svg").filter(|_| cfg!(windows)), None);
    }

    #[test]
    fn a_missing_apps_folder_is_an_error() {
        assert!(discover_apps(Path::new("does/not/exist")).is_err());
    }
}
