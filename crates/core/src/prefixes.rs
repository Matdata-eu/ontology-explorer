//! Shortening IRIs with the prefixes the inputs declare, SHACL `sh:declare`
//! entries, a built-in table, and prefix.cc's popular list.

use crate::vocab;
use oxrdf::{Graph, NamedNodeRef, TermRef};
use std::collections::BTreeMap;

/// Well-known namespaces that should always have their usual prefix, even
/// when the inputs declare something else for them.
const BUILTIN: &[(&str, &str)] = &[
    ("rdf", vocab::RDF),
    ("rdfs", vocab::RDFS),
    ("owl", vocab::OWL),
    ("xsd", vocab::XSD),
    ("skos", vocab::SKOS),
    ("sh", vocab::SH),
    ("dash", vocab::DASH),
    ("dcterms", vocab::DCTERMS),
    ("dc", vocab::DC),
    ("schema", vocab::SCHEMA),
    ("foaf", vocab::FOAF),
    ("vann", vocab::VANN),
    ("vs", vocab::VS),
    ("prov", "http://www.w3.org/ns/prov#"),
    ("dcat", "http://www.w3.org/ns/dcat#"),
    ("time", "http://www.w3.org/2006/time#"),
    ("geo", "http://www.opengis.net/ont/geosparql#"),
    ("org", "http://www.w3.org/ns/org#"),
    ("adms", "http://www.w3.org/ns/adms#"),
    ("void", "http://rdfs.org/ns/void#"),
    ("qb", "http://purl.org/linked-data/cube#"),
    ("cc", "http://creativecommons.org/ns#"),
];

/// Prefix table used while building a bundle.
pub struct Prefixes {
    /// prefix → namespace, what the bundle ships.
    pub map: BTreeMap<String, String>,
    /// namespace → prefix, for lookups; longest namespace wins.
    by_ns: Vec<(String, String)>,
}

impl Prefixes {
    /// Combine the declared prefixes (highest priority after the built-ins),
    /// then prefix.cc's list for namespaces used by the graph but not declared.
    pub fn build(declared: &[(String, String)], g: &Graph) -> Prefixes {
        let mut map: BTreeMap<String, String> = BTreeMap::new();
        let mut taken_ns: std::collections::HashSet<String> = Default::default();
        let mut add = |p: &str, ns: &str, map: &mut BTreeMap<String, String>| {
            if p.is_empty() || ns.is_empty() {
                return;
            }
            if map.contains_key(p) || taken_ns.contains(ns) {
                return;
            }
            taken_ns.insert(ns.to_string());
            map.insert(p.to_string(), ns.to_string());
        };
        for (p, ns) in BUILTIN {
            add(p, ns, &mut map);
        }
        for (p, ns) in declared {
            add(p, ns, &mut map);
        }
        for (p, ns) in sh_declared(g) {
            add(&p, &ns, &mut map);
        }
        // Namespaces that occur in the graph and are still unnamed: try prefix.cc.
        let popular = popular();
        let mut seen: std::collections::HashSet<String> = Default::default();
        for t in g.iter() {
            let mut consider = |iri: &str| {
                let ns = namespace_of(iri);
                if ns.is_empty() || !seen.insert(ns.to_string()) {
                    return;
                }
                if let Some(p) = popular.get(ns) {
                    add(p, ns, &mut map);
                }
            };
            if let oxrdf::NamedOrBlankNodeRef::NamedNode(n) = t.subject {
                consider(n.as_str());
            }
            consider(t.predicate.as_str());
            if let TermRef::NamedNode(n) = t.object {
                consider(n.as_str());
            }
        }
        let mut by_ns: Vec<(String, String)> =
            map.iter().map(|(p, ns)| (ns.clone(), p.clone())).collect();
        by_ns.sort_by_key(|b| std::cmp::Reverse(b.0.len()));
        Prefixes { map, by_ns }
    }

    /// `prefix:local` when a namespace matches and the local part is usable,
    /// else the full IRI.
    pub fn curie(&self, iri: &str) -> String {
        for (ns, p) in &self.by_ns {
            if let Some(local) = iri.strip_prefix(ns.as_str())
                && !local.contains('/')
                && !local.contains('#')
            {
                return format!("{p}:{local}");
            }
        }
        iri.to_string()
    }

    /// The prefix of an IRI's namespace when known.
    pub fn prefix_of(&self, iri: &str) -> Option<&str> {
        self.by_ns
            .iter()
            .find(|(ns, _)| iri.starts_with(ns.as_str()))
            .map(|(_, p)| p.as_str())
    }
}

/// Namespace part: up to and including the last `#` or `/`.
pub fn namespace_of(iri: &str) -> &str {
    match iri.rfind(['#', '/']) {
        Some(i) => &iri[..=i],
        None => "",
    }
}

/// Local part after the last `#` or `/`.
pub fn local_name(iri: &str) -> &str {
    match iri.rfind(['#', '/']) {
        Some(i) => &iri[i + 1..],
        None => iri,
    }
}

fn sh_declared(g: &Graph) -> Vec<(String, String)> {
    let prefix = NamedNodeRef::new_unchecked(vocab::SH_PREFIX);
    let namespace = NamedNodeRef::new_unchecked(vocab::SH_NAMESPACE);
    let mut out = Vec::new();
    for t in g.triples_for_predicate(prefix) {
        let TermRef::Literal(p) = t.object else {
            continue;
        };
        let ns = match g.object_for_subject_predicate(t.subject, namespace) {
            Some(TermRef::Literal(l)) => l.value().to_string(),
            Some(TermRef::NamedNode(n)) => n.as_str().to_string(),
            _ => continue,
        };
        out.push((p.value().to_string(), ns));
    }
    out.sort();
    out
}

/// prefix.cc's popular prefixes as namespace → prefix (first listed wins).
fn popular() -> std::collections::HashMap<String, String> {
    let json = include_str!("../assets/prefixes.json");
    let mut out = std::collections::HashMap::new();
    if let Ok(serde_json::Value::Object(obj)) = serde_json::from_str::<serde_json::Value>(json) {
        for (p, ns) in obj {
            if let serde_json::Value::String(ns) = ns {
                out.entry(ns).or_insert(p);
            }
        }
    }
    out
}
