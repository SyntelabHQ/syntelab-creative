//! Runs the Rust side of the apps and connects it to their interfaces.
//!
//! An app's interface reaches its Rust side in two ways, both through the
//! shell (docs/architecture/app-contract.md):
//! - the `app_invoke` command, for requests answered with JSON;
//! - URLs of the `syntelab-app` scheme, for binary data such as page pictures:
//!   `syntelab-app://localhost/<app-id>/<path>?<query>`.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::Arc;

use dev_backend::Dev;
use pdf_organizer_backend::PdfOrganizer;
use scribe_backend::Scribe;
use units_backend::Units;
use serde::Serialize;
use serde_json::Value;
use syntelab_app_api::{AppContext, AppError, ResourceRequest, SyntelabApp};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, State, UriSchemeContext, UriSchemeResponder};

pub const RESOURCE_SCHEME: &str = "syntelab-app";

/// The apps whose Rust side is running.
pub struct AppHost {
    apps: HashMap<&'static str, Arc<dyn SyntelabApp>>,
}

impl AppHost {
    /// Starts the apps built into this program. Each gets its own cache
    /// folder under `cache_root`. (Apps installed on demand come with the app
    /// manager, PLAN.md step 4.)
    pub fn start(cache_root: &Path) -> Self {
        let context = |app_id: &str| AppContext { cache_dir: cache_root.join("apps").join(app_id) };

        let built_in: Vec<Arc<dyn SyntelabApp>> =
            vec![Arc::new(Dev::new(&context(dev_backend::APP_ID))), Arc::new(PdfOrganizer::new(&context(pdf_organizer_backend::APP_ID))), Arc::new(Scribe::new(&context(scribe_backend::APP_ID))), Arc::new(Units::new(&context(units_backend::APP_ID)))];
        Self { apps: built_in.into_iter().map(|app| (app.id(), app)).collect() }
    }

    fn app(&self, id: &str) -> Result<&Arc<dyn SyntelabApp>, AppError> {
        self.apps.get(id).ok_or_else(|| AppError::NotFound(format!("app {id}")))
    }
}

/// An [`AppError`] as the interface receives it.
#[derive(Debug, Serialize)]
pub struct InvokeError {
    /// `not-found`, `invalid-request`, `superseded` or `failed`.
    kind: &'static str,
    /// For `failed`: a stable code the app's interface can translate.
    code: Option<&'static str>,
    /// For logs, not for the user.
    detail: String,
}

impl From<AppError> for InvokeError {
    fn from(error: AppError) -> Self {
        let detail = error.to_string();
        let (kind, code) = match error {
            AppError::NotFound(_) => ("not-found", None),
            AppError::InvalidRequest(_) => ("invalid-request", None),
            AppError::Superseded => ("superseded", None),
            AppError::Failed { code, .. } => ("failed", Some(code)),
        };
        Self { kind, code, detail }
    }
}

/// Runs a command of one app. Runs off the main thread, so a slow command
/// (opening a large file) does not freeze the window.
#[tauri::command(async)]
pub fn app_invoke(
    host: State<'_, AppHost>,
    app_id: String,
    command: String,
    payload: Option<Value>,
) -> Result<Value, InvokeError> {
    Ok(host.app(&app_id)?.invoke(&command, payload.unwrap_or(Value::Null))?)
}

/// Answers a `syntelab-app://` request. Returns at once; the app replies from
/// its own thread when the data is ready.
pub fn serve_resource<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let host = context.app_handle().state::<AppHost>();
    let uri = request.uri();
    let Some((app_id, path)) = uri.path().trim_start_matches('/').split_once('/') else {
        return responder.respond(error_response(&AppError::NotFound(uri.path().to_owned())));
    };
    let app = match host.app(app_id) {
        Ok(app) => app,
        Err(error) => return responder.respond(error_response(&error)),
    };

    let resource = ResourceRequest { path: path.to_owned(), query: parse_query(uri.query().unwrap_or_default()) };
    app.resource(
        resource,
        Box::new(move |result| {
            responder.respond(match result {
                Ok(resource) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, resource.mime)
                    // Pictures of the user's documents are not left in the web view's cache.
                    .header(header::CACHE_CONTROL, "no-store")
                    .body(resource.bytes)
                    .unwrap_or_default(),
                Err(error) => error_response(&error),
            });
        }),
    );
}

fn error_response(error: &AppError) -> Response<Vec<u8>> {
    let status = match error {
        AppError::NotFound(_) => StatusCode::NOT_FOUND,
        AppError::InvalidRequest(_) => StatusCode::BAD_REQUEST,
        AppError::Superseded => StatusCode::SERVICE_UNAVAILABLE,
        AppError::Failed { .. } => StatusCode::INTERNAL_SERVER_ERROR,
    };
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(error.to_string().into_bytes())
        .unwrap_or_default()
}

/// `a=1&b=2` → `{a: 1, b: 2}`. Values are plain numbers and names, so nothing is decoded.
fn parse_query(query: &str) -> BTreeMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_query_values() {
        let query = parse_query("scale=1.5&x=&broken");
        assert_eq!(query.get("scale").map(String::as_str), Some("1.5"));
        assert_eq!(query.get("x").map(String::as_str), Some(""));
        assert_eq!(query.len(), 2);
        assert!(parse_query("").is_empty());
    }

    #[test]
    fn maps_errors_to_what_the_interface_expects() {
        let error = InvokeError::from(AppError::Failed { code: "cannot-open", detail: "no such file".into() });
        assert_eq!((error.kind, error.code), ("failed", Some("cannot-open")));
        assert_eq!(error_response(&AppError::Superseded).status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(error_response(&AppError::NotFound("x".into())).status(), StatusCode::NOT_FOUND);
    }
}
