//! Reading RDF files of any common syntax into one merged graph.

use anyhow::{Context, Result, bail};
use oxrdf::{Graph, NamedOrBlankNode, Triple};
use std::collections::HashMap;

/// The RDF syntaxes the explorer reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Turtle,
    NTriples,
    TriG,
    NQuads,
    RdfXml,
    JsonLd,
}

impl Format {
    /// Guess the syntax from a file name, or from a media type.
    pub fn from_name(name: &str) -> Option<Format> {
        let lower = name.to_ascii_lowercase();
        let lower = lower.strip_suffix(".gz").unwrap_or(&lower);
        let ext = lower.rsplit('.').next().unwrap_or("");
        Some(match ext {
            "ttl" | "turtle" => Format::Turtle,
            "nt" | "ntriples" => Format::NTriples,
            "trig" => Format::TriG,
            "nq" | "nquads" => Format::NQuads,
            "rdf" | "owl" | "xml" | "rdfxml" => Format::RdfXml,
            "jsonld" | "json" => Format::JsonLd,
            _ => return None,
        })
    }

    pub fn from_media_type(media: &str) -> Option<Format> {
        let m = media
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        Some(match m.as_str() {
            "text/turtle" | "application/x-turtle" => Format::Turtle,
            "application/n-triples" => Format::NTriples,
            "application/trig" => Format::TriG,
            "application/n-quads" => Format::NQuads,
            "application/rdf+xml" | "application/xml" | "text/xml" => Format::RdfXml,
            "application/ld+json" | "application/json" => Format::JsonLd,
            _ => return None,
        })
    }

    /// A last resort when neither name nor media type says anything: look at
    /// the first bytes.
    pub fn sniff(bytes: &[u8]) -> Format {
        let head: String = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]).into_owned();
        let trimmed = head.trim_start();
        if trimmed.starts_with('<') && (trimmed.starts_with("<?xml") || trimmed.contains("rdf:RDF"))
        {
            Format::RdfXml
        } else if trimmed.starts_with('{') || trimmed.starts_with('[') {
            Format::JsonLd
        } else if head.contains("GRAPH") || head.contains("{\n") && head.contains("@prefix") {
            Format::TriG
        } else {
            Format::Turtle
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Format::Turtle => "Turtle",
            Format::NTriples => "N-Triples",
            Format::TriG => "TriG",
            Format::NQuads => "N-Quads",
            Format::RdfXml => "RDF/XML",
            Format::JsonLd => "JSON-LD",
        }
    }
}

/// One input: a name for messages and provenance, its bytes, and its syntax.
pub struct Source {
    pub name: String,
    pub bytes: Vec<u8>,
    pub format: Format,
}

impl Source {
    pub fn new(name: impl Into<String>, bytes: Vec<u8>, format: Option<Format>) -> Source {
        let name = name.into();
        let format = format
            .or_else(|| Format::from_name(&name))
            .unwrap_or_else(|| Format::sniff(&bytes));
        Source {
            name,
            bytes,
            format,
        }
    }
}

/// Everything read from the inputs, merged into one graph.
pub struct Loaded {
    pub graph: Graph,
    /// Prefix declarations found in the inputs, first declaration wins.
    pub prefixes: Vec<(String, String)>,
    /// Which inputs mention each subject (indexes into `sources`).
    pub subject_sources: HashMap<NamedOrBlankNode, Vec<u16>>,
    /// Name and triple count per input, in input order.
    pub sources: Vec<(String, usize)>,
}

/// Parse every source. Blank nodes are renamed per source so files cannot
/// clash. Quad syntaxes are flattened into one graph.
pub fn load(sources: &[Source]) -> Result<Loaded> {
    let mut graph = Graph::default();
    let mut prefixes: Vec<(String, String)> = Vec::new();
    let mut subject_sources: HashMap<NamedOrBlankNode, Vec<u16>> = HashMap::new();
    let mut summary = Vec::new();
    for (i, src) in sources.iter().enumerate() {
        if i >= u16::MAX as usize {
            bail!("too many input files");
        }
        let idx = i as u16;
        let mut count = 0usize;
        let bytes = decompress_if_needed(&src.name, &src.bytes)?;
        let found = parse(&bytes, src.format, |t| {
            count += 1;
            let entry = subject_sources.entry(t.subject.clone()).or_default();
            if entry.last() != Some(&idx) {
                entry.push(idx);
            }
            graph.insert(&t);
        })
        .with_context(|| format!("{}: cannot parse as {}", src.name, src.format.name()))?;
        for (p, ns) in found {
            if !prefixes.iter().any(|(q, _)| *q == p) {
                prefixes.push((p, ns));
            }
        }
        summary.push((src.name.clone(), count));
    }
    Ok(Loaded {
        graph,
        prefixes,
        subject_sources,
        sources: summary,
    })
}

fn decompress_if_needed<'a>(name: &str, bytes: &'a [u8]) -> Result<std::borrow::Cow<'a, [u8]>> {
    let gz = name.to_ascii_lowercase().ends_with(".gz") || bytes.starts_with(&[0x1f, 0x8b]);
    if !gz {
        return Ok(std::borrow::Cow::Borrowed(bytes));
    }
    #[cfg(feature = "gzip")]
    {
        use std::io::Read;
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(bytes)
            .read_to_end(&mut out)
            .with_context(|| format!("{name}: cannot decompress"))?;
        Ok(std::borrow::Cow::Owned(out))
    }
    #[cfg(not(feature = "gzip"))]
    {
        anyhow::bail!("{name}: gzip input is not supported in this build")
    }
}

/// Parse `bytes` and hand every triple to `on_triple`. Returns the prefixes
/// declared in the source (Turtle and TriG only).
pub fn parse<F: FnMut(Triple)>(
    bytes: &[u8],
    format: Format,
    mut on_triple: F,
) -> Result<Vec<(String, String)>> {
    let mut prefixes = Vec::new();
    let reader: &[u8] = bytes;
    match format {
        Format::NTriples => {
            for t in oxttl::NTriplesParser::new().lenient().for_reader(reader) {
                on_triple(t?);
            }
        }
        Format::Turtle => {
            let mut parser = oxttl::TurtleParser::new().lenient().for_reader(reader);
            for t in parser.by_ref() {
                on_triple(t?);
            }
            prefixes.extend(
                parser
                    .prefixes()
                    .map(|(k, v)| (k.to_string(), v.to_string())),
            );
        }
        Format::TriG => {
            let mut parser = oxttl::TriGParser::new().lenient().for_reader(reader);
            for q in parser.by_ref() {
                let q = q?;
                on_triple(Triple::new(q.subject, q.predicate, q.object));
            }
            prefixes.extend(
                parser
                    .prefixes()
                    .map(|(k, v)| (k.to_string(), v.to_string())),
            );
        }
        Format::NQuads => {
            for q in oxttl::NQuadsParser::new().lenient().for_reader(reader) {
                let q = q?;
                on_triple(Triple::new(q.subject, q.predicate, q.object));
            }
        }
        Format::RdfXml => {
            for t in oxrdfxml::RdfXmlParser::new().lenient().for_reader(reader) {
                on_triple(t?);
            }
        }
        Format::JsonLd => {
            for q in oxjsonld::JsonLdParser::new().lenient().for_reader(reader) {
                let q = q?;
                on_triple(Triple::new(q.subject, q.predicate, q.object));
            }
        }
    }
    Ok(prefixes)
}
