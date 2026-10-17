//! `serve`: the viewer in a local web server, with the bundle built from the
//! inputs given on the command line and a small API the viewer uses to load
//! more files or remote URLs.

use crate::{InputArgs, inputs};
use anyhow::{Context, Result};
use axum::{
    Router,
    body::Bytes,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use clap::Args;
use include_dir::{Dir, include_dir};
use ontology_explorer_core::{Options, Source, build_bundle};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::RwLock;

static WEB: Dir<'_> = include_dir!("$OUT_DIR/web");
const NOTICES: &str = include_str!(concat!(env!("OUT_DIR"), "/THIRD_PARTY_NOTICES.md"));

#[derive(Args)]
pub struct ServeArgs {
    /// Ontology, SKOS and SHACL files or URLs to open (none: start empty)
    #[arg(value_name = "FILE|URL")]
    pub inputs: Vec<String>,
    /// Title shown in the viewer
    #[arg(long, env = "ONTOLOGY_EXPLORER_TITLE")]
    pub title: Option<String>,
    /// Address to listen on
    #[arg(long, default_value = "127.0.0.1:7878", env = "ONTOLOGY_EXPLORER_BIND")]
    pub bind: String,
    /// Do not open the browser
    #[arg(long, env = "ONTOLOGY_EXPLORER_NO_OPEN")]
    pub no_open: bool,
    /// Allow the viewer to fetch remote files through this server (CORS relay)
    #[arg(long, env = "ONTOLOGY_EXPLORER_RELAY")]
    pub relay: bool,
    /// Largest upload accepted through the viewer, in megabytes
    #[arg(long, default_value_t = 256, env = "ONTOLOGY_EXPLORER_MAX_UPLOAD_MB")]
    pub max_upload_mb: usize,
    /// Keep at most this many instances per class
    #[arg(long, default_value_t = 200)]
    pub max_individuals: usize,
}

#[derive(Clone)]
struct AppState {
    bundle: Arc<RwLock<Option<Arc<String>>>>,
    title: Option<String>,
    relay: bool,
    max_upload: usize,
    max_individuals: usize,
}

pub fn run(args: ServeArgs) -> Result<()> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    rt.block_on(async_run(args))
}

async fn async_run(args: ServeArgs) -> Result<()> {
    let state = AppState {
        bundle: Arc::new(RwLock::new(None)),
        title: args.title.clone(),
        relay: args.relay,
        max_upload: args.max_upload_mb * 1024 * 1024,
        max_individuals: args.max_individuals,
    };
    if !args.inputs.is_empty() {
        let started = std::time::Instant::now();
        let input = InputArgs {
            inputs: args.inputs.clone(),
            title: args.title.clone(),
            max_individuals: args.max_individuals,
        };
        let sources = inputs::read_all(&input.inputs)?;
        let bundle = build_bundle(&sources, &crate::options(&input))?;
        let json = serde_json::to_string(&bundle)?;
        eprintln!(
            "loaded {} entities from {} triples in {:.1}s",
            bundle.entities.len(),
            bundle.stats.triples,
            started.elapsed().as_secs_f64()
        );
        *state.bundle.write().await = Some(Arc::new(json));
    }
    let app = Router::new()
        .route("/api/status", get(status))
        .route("/api/bundle", get(bundle))
        .route("/api/build", post(build))
        .route("/api/fetch", get(fetch))
        .route("/licenses", get(licenses))
        .fallback(get(static_file))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(&args.bind)
        .await
        .with_context(|| format!("cannot bind {}", args.bind))?;
    let addr = listener.local_addr()?;
    let url = format!("http://{addr}/");
    eprintln!("ontology-explorer listening on {url}  (Ctrl+C to stop)");
    if !args.no_open && webbrowser::open(&url).is_err() {
        eprintln!("open {url} in your browser");
    }
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

async fn status(State(s): State<AppState>) -> Response {
    let loaded = s.bundle.read().await.is_some();
    let body = serde_json::json!({
        "server": true,
        "version": env!("CARGO_PKG_VERSION"),
        "loaded": loaded,
        "title": s.title,
        "relay": s.relay,
        "maxUploadBytes": s.max_upload,
    });
    axum::Json(body).into_response()
}

async fn bundle(State(s): State<AppState>) -> Response {
    match s.bundle.read().await.clone() {
        Some(json) => json_response(json.as_bytes().to_vec()),
        None => (StatusCode::NOT_FOUND, "no bundle loaded").into_response(),
    }
}

fn json_response(bytes: Vec<u8>) -> Response {
    let mut r = bytes.into_response();
    r.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    r.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

#[derive(Deserialize)]
struct BuildQuery {
    /// File name of this part; several POSTs with the same `batch` are merged.
    name: String,
    #[serde(default)]
    title: Option<String>,
    /// "1" to keep the result as the server's bundle (so reloads keep it).
    #[serde(default)]
    keep: Option<String>,
}

/// Build a bundle from the uploaded body. The body is a multipart-free
/// concatenation: the viewer sends one request per file set as
/// `name` query parameter listing names joined by `\n` and the body as the
/// files joined by a length prefix. Kept simple: a JSON envelope.
async fn build(State(s): State<AppState>, Query(q): Query<BuildQuery>, body: Bytes) -> Response {
    if body.len() > s.max_upload {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("upload larger than {} MB", s.max_upload / 1024 / 1024),
        )
            .into_response();
    }
    // Envelope: [u32 LE name length][name bytes][u32 LE data length][data]... repeated.
    let mut sources = Vec::new();
    let mut i = 0usize;
    let data = body.as_ref();
    while i + 8 <= data.len() {
        let nl = u32::from_le_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]) as usize;
        i += 4;
        if i + nl > data.len() {
            break;
        }
        let name = String::from_utf8_lossy(&data[i..i + nl]).into_owned();
        i += nl;
        if i + 4 > data.len() {
            break;
        }
        let dl = u32::from_le_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]) as usize;
        i += 4;
        if i + dl > data.len() {
            break;
        }
        sources.push(Source::new(name, data[i..i + dl].to_vec(), None));
        i += dl;
    }
    if sources.is_empty() {
        sources.push(Source::new(q.name.clone(), data.to_vec(), None));
    }
    let opts = Options {
        title: q.title.clone().or(s.title.clone()),
        generator: format!("ontology-explorer {}", env!("CARGO_PKG_VERSION")),
        max_individuals_per_class: s.max_individuals,
    };
    let result = tokio::task::spawn_blocking(move || {
        build_bundle(&sources, &opts).and_then(|b| Ok(serde_json::to_string(&b)?))
    })
    .await;
    match result {
        Ok(Ok(json)) => {
            if q.keep.as_deref() == Some("1") {
                *s.bundle.write().await = Some(Arc::new(json.clone()));
            }
            json_response(json.into_bytes())
        }
        Ok(Err(e)) => (StatusCode::BAD_REQUEST, format!("{e:#}")).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")).into_response(),
    }
}

#[derive(Deserialize)]
struct FetchQuery {
    url: String,
}

/// Download a remote RDF file for the viewer (browsers block most RDF hosts
/// through CORS). Only when `--relay` is given.
async fn fetch(State(s): State<AppState>, Query(q): Query<FetchQuery>) -> Response {
    if !s.relay {
        return (
            StatusCode::FORBIDDEN,
            "remote fetching is off; start with --relay",
        )
            .into_response();
    }
    if !(q.url.starts_with("http://") || q.url.starts_with("https://")) {
        return (StatusCode::BAD_REQUEST, "only http(s) URLs").into_response();
    }
    let url = q.url.clone();
    match tokio::task::spawn_blocking(move || inputs::fetch(&url)).await {
        Ok(Ok(src)) => {
            let mut r = src.bytes.into_response();
            r.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/octet-stream"),
            );
            r.headers_mut().insert(
                "x-file-name",
                HeaderValue::from_str(&src.name).unwrap_or(HeaderValue::from_static("file")),
            );
            r.headers_mut().insert(
                "x-file-format",
                HeaderValue::from_str(src.format.name())
                    .unwrap_or(HeaderValue::from_static("Turtle")),
            );
            r
        }
        Ok(Err(e)) => (StatusCode::BAD_GATEWAY, format!("{e:#}")).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")).into_response(),
    }
}

async fn licenses() -> Response {
    let mut r = NOTICES.into_response();
    r.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    r
}

async fn static_file(uri: Uri, headers: HeaderMap) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    let file = WEB.get_file(path).or_else(|| {
        if path.contains('.') {
            None
        } else {
            WEB.get_file("index.html")
        }
    });
    let Some(file) = file else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    let mime = match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ if path == "index.html" => "text/html; charset=utf-8",
        _ => "application/octet-stream",
    };
    let _ = headers;
    let mut r = file.contents().into_response();
    r.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    let cache = if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    r.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    r
}
