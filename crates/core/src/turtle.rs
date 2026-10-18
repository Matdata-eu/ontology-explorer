//! The triples about one resource as readable Turtle, for the "RDF" section
//! of a page: its own triples, with the blank nodes it points at written
//! inline (`[ … ]`) and RDF lists as `( … )`. The `@prefix` lines are left
//! out: the bundle ships the prefixes once and the viewer adds the ones a
//! snippet uses.

use crate::prefixes::Prefixes;
use crate::vocab as v;
use oxrdf::{Graph, NamedNodeRef, NamedOrBlankNodeRef, TermRef};
use std::collections::HashSet;
use std::fmt::Write;

/// Snippets stop after this many bytes; the rest is summarised in a comment.
const MAX_BYTES: usize = 48 * 1024;
/// Nested blank nodes deeper than this are written as `_:label`.
const MAX_DEPTH: usize = 8;

/// Turtle for `subject`, without prefix declarations. `None` when the graph
/// says nothing about it.
pub fn describe(g: &Graph, prefixes: &Prefixes, subject: NamedNodeRef<'_>) -> Option<String> {
    let s = NamedOrBlankNodeRef::NamedNode(subject);
    g.triples_for_subject(s).next()?;
    let mut w = Writer {
        g,
        prefixes,
        out: String::new(),
        stack: HashSet::new(),
        truncated: 0,
    };
    let subject_name = w.iri(subject.as_str());
    w.out.push_str(&subject_name);
    w.properties(s, 1);
    w.out.push_str(" .\n");
    let mut text = w.out;
    if w.truncated > 0 {
        let _ = writeln!(text, "# … {} more triples not shown", w.truncated);
    }
    Some(text)
}

struct Writer<'a> {
    g: &'a Graph,
    prefixes: &'a Prefixes,
    out: String,
    /// Blank nodes being written, against cycles.
    stack: HashSet<String>,
    truncated: usize,
}

impl<'a> Writer<'a> {
    /// The predicate-object list of `s`, indented `level` steps.
    fn properties(&mut self, s: NamedOrBlankNodeRef<'a>, level: usize) {
        let g: &'a Graph = self.g;
        let mut triples: Vec<(String, TermRef<'a>)> = g
            .triples_for_subject(s)
            .map(|t| (t.predicate.as_str().to_string(), t.object))
            .collect();
        // rdf:type first, then by predicate, keeping the objects together.
        triples.sort_by(|a, b| {
            (a.0 != v::RDF_TYPE)
                .cmp(&(b.0 != v::RDF_TYPE))
                .then_with(|| self.prefixes.curie(&a.0).cmp(&self.prefixes.curie(&b.0)))
                .then_with(|| a.0.cmp(&b.0))
        });
        let pad = "    ".repeat(level);
        let mut last: Option<String> = None;
        for (p, o) in triples {
            if self.out.len() > MAX_BYTES {
                self.truncated += 1;
                continue;
            }
            if last.as_deref() == Some(p.as_str()) {
                self.out.push_str(" ,\n");
                self.out.push_str(&pad);
                self.out.push_str("    ");
            } else {
                if last.is_some() {
                    self.out.push_str(" ;");
                }
                self.out.push('\n');
                self.out.push_str(&pad);
                let name = if p == v::RDF_TYPE {
                    "a".to_string()
                } else {
                    self.iri(&p)
                };
                self.out.push_str(&name);
                self.out.push(' ');
                last = Some(p);
            }
            self.object(o, level);
        }
    }

    fn object(&mut self, o: TermRef<'a>, level: usize) {
        match o {
            TermRef::NamedNode(n) => {
                let name = self.iri(n.as_str());
                self.out.push_str(&name);
            }
            TermRef::Literal(l) => {
                let lit = literal(l.value());
                self.out.push_str(&lit);
                if let Some(lang) = l.language() {
                    self.out.push('@');
                    self.out.push_str(lang);
                } else if l.datatype().as_str() != v::XSD_STRING {
                    let dt = self.iri(l.datatype().as_str());
                    self.out.push_str("^^");
                    self.out.push_str(&dt);
                }
            }
            TermRef::BlankNode(b) => {
                let key = b.as_str().to_string();
                let node = NamedOrBlankNodeRef::BlankNode(b);
                if level > MAX_DEPTH || self.stack.contains(&key) {
                    let _ = write!(self.out, "_:{key}");
                    return;
                }
                self.stack.insert(key.clone());
                if let Some(items) = self.list(node) {
                    self.out.push('(');
                    for item in items {
                        self.out.push(' ');
                        self.object(item, level + 1);
                    }
                    self.out.push_str(" )");
                } else if self.g.triples_for_subject(node).next().is_none() {
                    self.out.push_str("[]");
                } else {
                    self.out.push('[');
                    self.properties(node, level + 1);
                    self.out.push('\n');
                    self.out.push_str(&"    ".repeat(level));
                    self.out.push(']');
                }
                self.stack.remove(&key);
            }
            #[allow(unreachable_patterns)]
            _ => self.out.push_str("[]"),
        }
    }

    /// The members of a well-formed RDF list starting at `node`.
    fn list(&self, node: NamedOrBlankNodeRef<'a>) -> Option<Vec<TermRef<'a>>> {
        let g: &'a Graph = self.g;
        let first = NamedNodeRef::new_unchecked(v::RDF_FIRST);
        let rest = NamedNodeRef::new_unchecked(v::RDF_REST);
        let mut items = Vec::new();
        let mut cur = node;
        let mut seen = HashSet::new();
        loop {
            if !seen.insert(cur) || g.triples_for_subject(cur).count() != 2 {
                return None;
            }
            items.push(g.object_for_subject_predicate(cur, first)?);
            match g.object_for_subject_predicate(cur, rest)? {
                TermRef::NamedNode(n) if n.as_str() == v::RDF_NIL => return Some(items),
                TermRef::BlankNode(b) => cur = NamedOrBlankNodeRef::BlankNode(b),
                _ => return None,
            }
        }
    }

    /// A prefixed name when one is valid Turtle, else `<iri>`.
    fn iri(&mut self, iri: &str) -> String {
        let curie = self.prefixes.curie(iri);
        if let Some((p, local)) = curie.split_once(':')
            && curie != iri
            && valid_local(local)
            && p.chars()
                .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')
        {
            return curie;
        }
        format!("<{iri}>")
    }
}

fn valid_local(local: &str) -> bool {
    !local.ends_with('.')
        && !local.starts_with(['.', '-'])
        && local
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')
}

/// A quoted string literal; long quotes when the text has line breaks.
fn literal(s: &str) -> String {
    if s.contains('\n') {
        let body = s.replace('\\', "\\\\").replace("\"\"\"", "\\\"\\\"\\\"");
        let body = if body.ends_with('"') {
            format!("{}\\\"", &body[..body.len() - 1])
        } else {
            body
        };
        return format!("\"\"\"{body}\"\"\"");
    }
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::{Format, parse};

    fn graph(ttl: &str) -> (Graph, Prefixes) {
        let mut g = Graph::default();
        let declared = parse(ttl.as_bytes(), Format::Turtle, |t| {
            g.insert(&t);
        })
        .unwrap();
        let p = Prefixes::build(&declared, &g);
        (g, p)
    }

    #[test]
    fn writes_nested_blank_nodes_and_lists() {
        let (g, p) = graph(
            r#"@prefix ex: <http://example.org/> .
               @prefix sh: <http://www.w3.org/ns/shacl#> .
               ex:S a sh:NodeShape ; sh:targetClass ex:C ;
                 sh:property [ sh:path ex:p ; sh:in ( ex:a ex:b ) ] ;
                 ex:note """line one
line two""" ."#,
        );
        let t = describe(&g, &p, NamedNodeRef::new_unchecked("http://example.org/S")).unwrap();
        assert!(t.starts_with("ex:S\n    a sh:NodeShape ;"), "{t}");
        assert!(t.contains("sh:in ( ex:a ex:b )"), "{t}");
        assert!(t.contains("sh:property [\n        sh:in"), "{t}");
        assert!(t.contains("\"\"\"line one\nline two\"\"\""), "{t}");
        // What it writes parses back to the same number of triples.
        let mut n = 0;
        let doc = format!(
            "@prefix ex: <http://example.org/> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n{t}"
        );
        parse(doc.as_bytes(), Format::Turtle, |_| n += 1).unwrap();
        assert_eq!(n, g.len());
    }

    #[test]
    fn nothing_for_unknown_subjects() {
        let (g, p) = graph("@prefix ex: <http://example.org/> . ex:a ex:b ex:c .");
        assert!(describe(&g, &p, NamedNodeRef::new_unchecked("http://example.org/c")).is_none());
    }
}
