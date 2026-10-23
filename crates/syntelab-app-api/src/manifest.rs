//! The parts of `apps/<app-id>/app.json` the shell reads.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Text per language code, for example `{ "en": "PDF Organizer" }`.
pub type LocalizedText = BTreeMap<String, String>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppStatus {
    Active,
    ComingSoon,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppBrand {
    /// `#RRGGBB`.
    pub color: String,
    /// Path of the icon, relative to the app folder.
    pub icon: String,
}

/// An entry the app wants in the file manager's right-click menu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuEntry {
    /// Lowercase words joined by hyphens: `combine-to-pdf`. The app is told this when the entry is chosen.
    pub id: String,
    /// The key of its label in the app's translations.
    pub label_key: String,
    /// The kinds of files it shows on, each as an ending with its dot (`.pdf`).
    #[serde(default)]
    pub file_types: Vec<String>,
}

/// Something of an app the search of the Start page finds and opens: a tool, a converter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchEntry {
    /// Tells it apart from the app's other entries.
    pub id: String,
    /// The key of its name in the app's translations.
    pub label_key: String,
    /// What the tab that is opened for it is given.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub params: std::collections::BTreeMap<String, String>,
}

/// Fields of `app.json` not listed here (add-ons...) are ignored until the
/// shell needs them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppManifest {
    /// Same as the app's folder name.
    pub id: String,
    pub version: String,
    pub api_version: u32,
    pub status: AppStatus,
    pub name: LocalizedText,
    pub description: LocalizedText,
    pub brand: AppBrand,
    #[serde(default)]
    pub file_types: Vec<String>,
    /// What the app adds to the file manager's right-click menu.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context_menu: Vec<ContextMenuEntry>,
    /// The entries of `context_menu` open to the side from one named after the app ("Syntelab Dev"), instead of
    /// each standing in the menu by itself.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub context_menu_grouped: bool,
    /// What of the app the search of the Start page finds besides the app itself.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub search: Vec<SearchEntry>,
    /// `classic`, `ribbon` or `side-panel`: the layout the app starts with,
    /// until the user picks another one for it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_layout: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_manifest_and_ignores_unknown_fields() {
        let manifest: AppManifest = serde_json::from_str(
            r##"{
                "id": "convert",
                "version": "0.0.0",
                "apiVersion": 1,
                "status": "coming-soon",
                "name": { "en": "Convert" },
                "description": { "en": "Convert files between formats." },
                "brand": { "color": "#546E7A", "icon": "assets/icon.svg" },
                "locales": "locales/"
            }"##,
        )
        .expect("valid manifest");

        assert_eq!(manifest.id, "convert");
        assert_eq!(manifest.api_version, 1);
        assert_eq!(manifest.status, AppStatus::ComingSoon);
        assert!(manifest.file_types.is_empty());
    }

    #[test]
    fn writes_the_field_names_the_frontend_expects() {
        let manifest = AppManifest {
            id: "pdf-organizer".into(),
            version: "0.0.0".into(),
            api_version: 1,
            status: AppStatus::Active,
            name: LocalizedText::new(),
            description: LocalizedText::new(),
            brand: AppBrand { color: "#7A1F3D".into(), icon: "assets/icon.svg".into() },
            file_types: vec![".pdf".into()],
            context_menu: Vec::new(),
            context_menu_grouped: true,
            search: Vec::new(),
            default_layout: Some("ribbon".into()),
        };
        let json = serde_json::to_value(&manifest).expect("serializable");

        assert_eq!(json["apiVersion"], 1);
        assert_eq!(json["status"], "active");
        assert_eq!(json["fileTypes"][0], ".pdf");
        assert_eq!(json["defaultLayout"], "ribbon");
        assert_eq!(json["contextMenuGrouped"], true);
    }
}
