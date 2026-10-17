//! Browser entry point: parse RDF files handed over from JavaScript and
//! return the bundle as a JSON string.

use ontology_explorer_core::{Format, Options, Source};
use wasm_bindgen::prelude::*;

/// Build a bundle from files.
///
/// `names` and `contents` are parallel arrays: file names (used to guess the
/// syntax and for provenance) and their bytes as `Uint8Array`s. `title` is
/// optional.
#[wasm_bindgen]
pub fn build_bundle(
    names: Vec<String>,
    contents: Vec<js_sys::Uint8Array>,
    title: Option<String>,
) -> Result<String, JsValue> {
    console_error_panic_hook::set_once();
    let sources: Vec<Source> = names
        .into_iter()
        .zip(contents)
        .map(|(name, bytes)| Source::new(name, bytes.to_vec(), None))
        .collect();
    let opts = Options {
        title,
        generator: format!("ontology-explorer-wasm {}", env!("CARGO_PKG_VERSION")),
        max_individuals_per_class: 200,
    };
    let bundle = ontology_explorer_core::build_bundle(&sources, &opts)
        .map_err(|e| JsValue::from_str(&format!("{e:#}")))?;
    ontology_explorer_core::to_json(&bundle).map_err(|e| JsValue::from_str(&format!("{e:#}")))
}

/// Guess the syntax of a file from its name, for the loading UI.
#[wasm_bindgen]
pub fn format_of(name: &str) -> Option<String> {
    Format::from_name(name).map(|f| f.name().to_string())
}

/// Version of the core crate.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
