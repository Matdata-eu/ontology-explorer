//! Reading inputs from paths or URLs.

use anyhow::{Context, Result, bail};
use ontology_explorer_core::{Format, Source};
use std::path::Path;

pub fn read_all(inputs: &[String]) -> Result<Vec<Source>> {
    inputs.iter().map(|i| read_one(i)).collect()
}

pub fn read_one(input: &str) -> Result<Source> {
    if input.starts_with("http://") || input.starts_with("https://") {
        return fetch(input);
    }
    let path = Path::new(input);
    let bytes = std::fs::read(path).with_context(|| format!("cannot read {input}"))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| input.to_string());
    Ok(Source::new(name, bytes, None))
}

/// Download a URL, asking for RDF content types. The syntax comes from the
/// response's Content-Type, then the URL's extension, then a look at the bytes.
pub fn fetch(url: &str) -> Result<Source> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(120)))
        .user_agent(concat!("ontology-explorer/", env!("CARGO_PKG_VERSION")))
        .build()
        .new_agent();
    let mut resp = agent
        .get(url)
        .header(
            "Accept",
            "text/turtle, application/rdf+xml;q=0.9, application/ld+json;q=0.9, application/n-triples;q=0.8, application/trig;q=0.8, */*;q=0.1",
        )
        .call()
        .with_context(|| format!("cannot fetch {url}"))?;
    let status = resp.status();
    if !status.is_success() {
        bail!("{url}: HTTP {status}");
    }
    let media = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = resp
        .body_mut()
        .with_config()
        .limit(512 * 1024 * 1024)
        .read_to_vec()
        .with_context(|| format!("cannot read {url}"))?;
    let name = url
        .rsplit('/')
        .next()
        .filter(|n| !n.is_empty())
        .unwrap_or(url)
        .to_string();
    let format = media
        .as_deref()
        .and_then(Format::from_media_type)
        .filter(|f| {
            !(matches!(f, Format::JsonLd)
                && !name.ends_with(".json")
                && !name.ends_with(".jsonld")
                && media.as_deref().is_some_and(|m| m.contains("json"))
                && Format::from_name(&name).is_some())
        })
        .or_else(|| Format::from_name(&name));
    Ok(Source::new(name, bytes, format))
}
