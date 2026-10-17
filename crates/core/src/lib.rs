//! ontology-explorer-core reads OWL/RDFS ontologies, SKOS concept schemes and
//! SHACL shapes (with or without DASH annotations) and produces one indexed
//! [`Bundle`](bundle::Bundle) that the ontology-explorer viewer renders.
//!
//! The same crate runs in the command line tool and, compiled to
//! WebAssembly, in the browser.

pub mod bundle;
pub mod input;
pub mod model;
pub mod prefixes;
pub mod vocab;

pub use bundle::Bundle;
pub use input::{Format, Loaded, Source};
pub use model::Options;

use anyhow::Result;

/// Parse the sources and build a bundle in one go.
pub fn build_bundle(sources: &[Source], opts: &Options) -> Result<Bundle> {
    let loaded = input::load(sources)?;
    Ok(model::build(&loaded, opts))
}

/// Serialize a bundle as compact JSON.
pub fn to_json(bundle: &Bundle) -> Result<String> {
    Ok(serde_json::to_string(bundle)?)
}
