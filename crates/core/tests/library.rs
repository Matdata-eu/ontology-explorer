//! End-to-end checks on the small library example (OWL + SKOS + SHACL + DASH).

use ontology_explorer_core::bundle::{Bundle, Kind, PropRow};
use ontology_explorer_core::{Options, Source, build_bundle, to_json};

fn library() -> Bundle {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/library");
    let sources: Vec<Source> = ["library.ttl", "genres.ttl", "shapes.ttl"]
        .iter()
        .map(|f| Source::new(*f, std::fs::read(format!("{dir}/{f}")).unwrap(), None))
        .collect();
    build_bundle(&sources, &Options::default()).expect("library builds")
}

const LIB: &str = "https://example.org/library#";

fn id(b: &Bundle, iri: &str) -> u32 {
    b.entities
        .iter()
        .find(|e| e.iri == iri)
        .unwrap_or_else(|| panic!("{iri} missing"))
        .id
}

fn row<'a>(b: &'a Bundle, class: &str, prop: &str) -> &'a PropRow {
    let c = id(b, &format!("{LIB}{class}"));
    let p = id(b, &format!("{LIB}{prop}"));
    b.classes[&c]
        .props
        .iter()
        .find(|r| r.property == Some(p))
        .unwrap_or_else(|| panic!("{class}.{prop} missing"))
}

#[test]
fn kinds_and_stats() {
    let b = library();
    assert_eq!(
        b.entities[id(&b, &format!("{LIB}Book")) as usize].kind,
        Kind::Class
    );
    assert_eq!(
        b.entities[id(&b, &format!("{LIB}author")) as usize].kind,
        Kind::ObjectProperty
    );
    assert_eq!(
        b.entities[id(&b, &format!("{LIB}title")) as usize].kind,
        Kind::DatatypeProperty
    );
    assert_eq!(b.stats.concept_schemes, 2);
    assert_eq!(b.stats.concepts, 12);
    assert!(b.stats.uses_dash && b.stats.uses_shacl && b.stats.uses_skos);
    assert!(b.languages.contains(&"nl".to_string()));
}

#[test]
fn hierarchy() {
    let b = library();
    let member = &b.classes[&id(&b, &format!("{LIB}Member"))];
    let names: Vec<&str> = member
        .ancestors
        .iter()
        .map(|&a| b.entities[a as usize].iri.as_str())
        .collect();
    assert_eq!(names, vec![format!("{LIB}Person"), format!("{LIB}Agent")]);
    let agent = &b.classes[&id(&b, &format!("{LIB}Agent"))];
    assert!(
        agent.r#abstract,
        "dash:abstract on the target shape marks the class abstract"
    );
    assert!(b.root_classes.contains(&id(&b, &format!("{LIB}Agent"))));
    assert!(b.entities[id(&b, &format!("{LIB}OldCatalogueEntry")) as usize].deprecated);
}

#[test]
fn ontology_restrictions_and_shapes_merge() {
    let b = library();
    let author = row(&b, "Book", "author");
    assert_eq!(author.min, Some(1));
    assert!(author.sources.iter().any(|s| s == "restriction"));
    assert!(author.sources.iter().any(|s| s == "shape"));
    assert_eq!(author.range, vec![id(&b, &format!("{LIB}Person"))]);

    let isbn = row(&b, "Book", "isbn");
    assert_eq!(isbn.role.as_deref(), Some("ID"));
    assert_eq!(isbn.max, Some(1));
    assert!(isbn.literal);
    assert!(isbn.constraints.iter().any(|c| c.kind == "pattern"));

    let chapters = row(&b, "Book", "hasChapter");
    assert!(chapters.composite);

    // Inherited from Work, grouped by DASH/SHACL property groups.
    let title = row(&b, "Book", "title");
    assert_eq!(title.inherited_from, Some(id(&b, &format!("{LIB}Work"))));
    assert!(title.group.is_some());
}

#[test]
fn value_sets() {
    let b = library();
    let genres = id(&b, "https://example.org/library/genre/Genres");
    let conditions = id(&b, "https://example.org/library/condition/Conditions");
    assert_eq!(
        row(&b, "Work", "genre").scheme,
        Some(genres),
        "sh:node with skos:inScheme hasValue"
    );
    assert!(
        row(&b, "Work", "genre").range.is_empty(),
        "skos:Concept range dropped once the scheme is known"
    );
    assert_eq!(
        row(&b, "Copy", "condition").scheme,
        Some(conditions),
        "sh:in of one scheme's concepts"
    );
    let tree = &b.schemes[&genres];
    assert_eq!(tree.top_concepts.len(), 2);
    let fiction = id(&b, "https://example.org/library/genre/fiction");
    assert_eq!(b.concepts[&fiction].narrower.len(), 3);
}

#[test]
fn dash_hidden_and_inverse_paths() {
    let b = library();
    assert!(row(&b, "Member", "birthDate").hidden);
    assert!(row(&b, "Member", "memberNumber").read_only);
    let member = &b.classes[&id(&b, &format!("{LIB}Member"))];
    assert!(
        member
            .props
            .iter()
            .any(|r| r.inverse && r.path.starts_with('^')),
        "inverse path row present"
    );
}

#[test]
fn json_roundtrip() {
    let b = library();
    let json = to_json(&b).unwrap();
    let back: Bundle = serde_json::from_str(&json).unwrap();
    assert_eq!(back.entities.len(), b.entities.len());
    assert_eq!(back.format, 1);
}

#[test]
fn works_without_shacl() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/library");
    let src = Source::new(
        "library.ttl",
        std::fs::read(format!("{dir}/library.ttl")).unwrap(),
        None,
    );
    let b = build_bundle(&[src], &Options::default()).unwrap();
    assert!(!b.stats.uses_shacl);
    let pages = row(&b, "Book", "pages");
    assert!(pages.literal);
    assert_eq!(pages.sources, vec!["ontology".to_string()]);
}
