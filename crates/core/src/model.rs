//! Turns the merged graph into a [`Bundle`].

use crate::bundle::*;
use crate::input::Loaded;
use crate::prefixes::{Prefixes, local_name};
use crate::vocab as v;
use oxrdf::{
    Graph, LiteralRef, NamedNodeRef, NamedOrBlankNode, NamedOrBlankNodeRef, Term, TermRef,
};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

/// Settings for a build.
#[derive(Debug, Clone, Default)]
pub struct Options {
    /// Title shown in the viewer; defaults to the ontology's title or the first file name.
    pub title: Option<String>,
    /// Name and version of the program writing the bundle.
    pub generator: String,
    /// At most this many individuals (instances) are kept per class.
    pub max_individuals_per_class: usize,
    /// Keep the Turtle of every entity for its "RDF" section.
    pub rdf: bool,
}

/// Build a bundle from loaded inputs.
pub fn build(loaded: &Loaded, opts: &Options) -> Bundle {
    let prefixes = Prefixes::build(&loaded.prefixes, &loaded.graph);
    let mut b = Builder {
        g: &loaded.graph,
        loaded,
        prefixes,
        ids: HashMap::new(),
        entities: Vec::new(),
        classes: BTreeMap::new(),
        properties: BTreeMap::new(),
        schemes: BTreeMap::new(),
        concepts: BTreeMap::new(),
        collections: BTreeMap::new(),
        shapes: BTreeMap::new(),
        groups: BTreeMap::new(),
        individuals: BTreeMap::new(),
        ontologies: BTreeMap::new(),
        uses_dash: false,
        property_shape_cache: HashMap::new(),
    };
    b.classify();
    b.describe_entities();
    b.build_classes();
    b.build_properties();
    b.build_groups();
    b.build_shapes();
    b.build_class_rows();
    b.build_skos();
    b.build_individuals(opts.max_individuals_per_class.max(1));
    b.finish(opts)
}

fn nn(iri: &str) -> NamedNodeRef<'_> {
    NamedNodeRef::new_unchecked(iri)
}

struct Builder<'a> {
    g: &'a Graph,
    loaded: &'a Loaded,
    prefixes: Prefixes,
    ids: HashMap<String, Id>,
    entities: Vec<Entity>,
    classes: BTreeMap<Id, ClassInfo>,
    properties: BTreeMap<Id, PropertyInfo>,
    schemes: BTreeMap<Id, SchemeInfo>,
    concepts: BTreeMap<Id, ConceptInfo>,
    collections: BTreeMap<Id, CollectionInfo>,
    shapes: BTreeMap<Id, ShapeInfo>,
    groups: BTreeMap<Id, GroupInfo>,
    individuals: BTreeMap<Id, IndividualInfo>,
    ontologies: BTreeMap<Id, OntologyInfo>,
    uses_dash: bool,
    /// Rows for named property shapes, built once.
    property_shape_cache: HashMap<String, PropRow>,
}

/// Kinds in order of precedence when a resource has several types.
fn rank(k: Kind) -> u8 {
    match k {
        Kind::Ontology => 0,
        Kind::Class => 1,
        Kind::ObjectProperty => 2,
        Kind::DatatypeProperty => 3,
        Kind::AnnotationProperty => 4,
        Kind::ConceptScheme => 5,
        Kind::Concept => 6,
        Kind::Collection => 7,
        Kind::NodeShape => 8,
        Kind::PropertyShape => 9,
        Kind::PropertyGroup => 10,
        Kind::Datatype => 11,
        Kind::Property => 12,
        Kind::Individual => 13,
    }
}

impl<'a> Builder<'a> {
    // ----- entity interning -------------------------------------------------

    fn id_of(&self, iri: &str) -> Option<Id> {
        self.ids.get(iri).copied()
    }

    /// Get or create the entity for an IRI. A stronger kind replaces a weaker one.
    fn intern(&mut self, iri: &str, kind: Kind) -> Id {
        let kind = if is_datatype_iri(iri) {
            Kind::Datatype
        } else {
            kind
        };
        if let Some(&id) = self.ids.get(iri) {
            let e = &mut self.entities[id as usize];
            if rank(kind) < rank(e.kind) {
                e.kind = kind;
            }
            return id;
        }
        let id = self.entities.len() as Id;
        self.entities.push(Entity {
            id,
            iri: iri.to_string(),
            curie: self.prefixes.curie(iri),
            kind,
            label: BTreeMap::new(),
            comment: BTreeMap::new(),
            deprecated: false,
            status: None,
            sources: Vec::new(),
            annotations: Vec::new(),
        });
        self.ids.insert(iri.to_string(), id);
        id
    }

    fn kind(&self, id: Id) -> Kind {
        self.entities[id as usize].kind
    }

    fn iri(&self, id: Id) -> &str {
        &self.entities[id as usize].iri
    }

    /// A label for sorting: English, then any language, then the local name.
    fn sort_label(&self, id: Id) -> String {
        let e = &self.entities[id as usize];
        e.label
            .get("en")
            .or_else(|| e.label.get(""))
            .or_else(|| e.label.values().next())
            .cloned()
            .unwrap_or_else(|| local_name(&e.iri).to_string())
            .to_lowercase()
            .pipe_natural()
    }

    fn sort_ids(&self, ids: &mut Vec<Id>) {
        ids.sort_by_cached_key(|&id| (self.sort_label(id), id));
        ids.dedup();
    }

    // ----- graph helpers ----------------------------------------------------

    fn objects<'b>(
        &'b self,
        s: NamedOrBlankNodeRef<'b>,
        p: &'b str,
    ) -> impl Iterator<Item = TermRef<'b>> + 'b {
        self.g.objects_for_subject_predicate(s, nn(p))
    }

    fn object<'b>(&'b self, s: NamedOrBlankNodeRef<'b>, p: &'b str) -> Option<TermRef<'b>> {
        self.g.object_for_subject_predicate(s, nn(p))
    }

    fn named_objects(&self, s: NamedOrBlankNodeRef<'_>, p: &str) -> Vec<String> {
        self.objects(s, p)
            .filter_map(|o| match o {
                TermRef::NamedNode(n) => Some(n.as_str().to_string()),
                _ => None,
            })
            .collect()
    }

    fn has_type(&self, s: NamedOrBlankNodeRef<'_>, t: &str) -> bool {
        self.g
            .contains(oxrdf::TripleRef::new(s, nn(v::RDF_TYPE), nn(t)))
    }

    fn is_true(&self, s: NamedOrBlankNodeRef<'_>, p: &str) -> bool {
        self.objects(s, p).any(|o| match o {
            TermRef::Literal(l) => matches!(l.value(), "true" | "1"),
            _ => false,
        })
    }

    fn literal_u32(&self, s: NamedOrBlankNodeRef<'_>, p: &str) -> Option<u32> {
        self.objects(s, p).find_map(|o| match o {
            TermRef::Literal(l) => l.value().trim().parse().ok(),
            _ => None,
        })
    }

    fn literal_f64(&self, s: NamedOrBlankNodeRef<'_>, p: &str) -> Option<f64> {
        self.objects(s, p).find_map(|o| match o {
            TermRef::Literal(l) => l.value().trim().parse().ok(),
            _ => None,
        })
    }

    fn literal_string(&self, s: NamedOrBlankNodeRef<'_>, p: &str) -> Option<String> {
        self.objects(s, p).find_map(|o| match o {
            TermRef::Literal(l) => Some(l.value().to_string()),
            _ => None,
        })
    }

    fn lang_map(&self, s: NamedOrBlankNodeRef<'_>, p: &str) -> LangMap {
        let mut m = LangMap::new();
        for o in self.objects(s, p) {
            if let TermRef::Literal(l) = o {
                m.entry(l.language().unwrap_or("").to_string())
                    .or_insert_with(|| l.value().to_string());
            }
        }
        m
    }

    /// Members of an `rdf:List`, cycle-safe.
    fn list(&self, head: TermRef<'_>) -> Vec<Term> {
        let mut out = Vec::new();
        let mut cur = head.into_owned();
        let mut seen = HashSet::new();
        loop {
            let node: NamedOrBlankNode = match &cur {
                Term::NamedNode(n) if n.as_str() == v::RDF_NIL => break,
                Term::NamedNode(n) => n.clone().into(),
                Term::BlankNode(b) => b.clone().into(),
                _ => break,
            };
            if !seen.insert(node.clone()) {
                break;
            }
            let r = node.as_ref();
            if let Some(f) = self.object(r, v::RDF_FIRST) {
                out.push(f.into_owned());
            }
            match self.object(r, v::RDF_REST) {
                Some(rest) => cur = rest.into_owned(),
                None => break,
            }
        }
        out
    }

    fn term_label(&self, t: TermRef<'_>) -> String {
        match t {
            TermRef::NamedNode(n) => self.prefixes.curie(n.as_str()),
            TermRef::BlankNode(_) => "[anonymous]".to_string(),
            TermRef::Literal(l) => literal_text(l, &self.prefixes),
            #[allow(unreachable_patterns)]
            _ => t.to_string(),
        }
    }

    // ----- step 1: which IRIs are what -------------------------------------

    fn classify(&mut self) {
        let g = self.g;
        let type_p = nn(v::RDF_TYPE);
        // Declared types.
        let typed: Vec<(NamedOrBlankNode, String)> = g
            .triples_for_predicate(type_p)
            .filter_map(|t| match t.object {
                TermRef::NamedNode(o) => Some((t.subject.into_owned(), o.as_str().to_string())),
                _ => None,
            })
            .collect();
        for (s, t) in &typed {
            let NamedOrBlankNode::NamedNode(s) = s else {
                continue;
            };
            let kind = match t.as_str() {
                v::OWL_ONTOLOGY => Kind::Ontology,
                v::OWL_CLASS | v::RDFS_CLASS | v::DASH_SHAPE_CLASS => Kind::Class,
                v::OWL_OBJECT_PROPERTY => Kind::ObjectProperty,
                v::OWL_DATATYPE_PROPERTY => Kind::DatatypeProperty,
                v::OWL_ANNOTATION_PROPERTY => Kind::AnnotationProperty,
                v::RDF_PROPERTY
                | v::OWL_FUNCTIONAL
                | v::OWL_INVERSE_FUNCTIONAL
                | v::OWL_SYMMETRIC
                | v::OWL_TRANSITIVE
                | v::OWL_DEPRECATED_PROPERTY => Kind::Property,
                v::OWL_DEPRECATED_CLASS => Kind::Class,
                v::RDFS_DATATYPE => Kind::Datatype,
                v::SKOS_CONCEPT_SCHEME => Kind::ConceptScheme,
                v::SKOS_CONCEPT => Kind::Concept,
                v::SKOS_COLLECTION | v::SKOS_ORDERED_COLLECTION => Kind::Collection,
                v::SH_NODE_SHAPE => Kind::NodeShape,
                v::SH_PROPERTY_SHAPE => Kind::PropertyShape,
                v::SH_PROPERTY_GROUP => Kind::PropertyGroup,
                _ => continue,
            };
            if t == v::DASH_SHAPE_CLASS {
                self.uses_dash = true;
            }
            self.intern(s.as_str(), kind);
        }
        // Implied kinds from how IRIs are used.
        let class_objects = [
            v::RDFS_SUBCLASSOF,
            v::RDFS_DOMAIN,
            v::SH_TARGET_CLASS,
            v::SH_CLASS,
            v::OWL_ON_CLASS,
            v::DASH_APPLICABLE_TO_CLASS,
            v::OWL_EQUIVALENT_CLASS,
            v::OWL_DISJOINT_WITH,
            "https://schema.org/domainIncludes",
            "http://schema.org/domainIncludes",
        ];
        for p in class_objects {
            for t in g.triples_for_predicate(nn(p)) {
                if let TermRef::NamedNode(o) = t.object {
                    self.intern(o.as_str(), Kind::Class);
                }
                if let NamedOrBlankNodeRef::NamedNode(s) = t.subject
                    && p == v::RDFS_SUBCLASSOF
                {
                    self.intern(s.as_str(), Kind::Class);
                }
            }
        }
        // Ranges: datatypes or classes.
        for p in [
            v::RDFS_RANGE,
            "https://schema.org/rangeIncludes",
            "http://schema.org/rangeIncludes",
            v::OWL_SOME_VALUES_FROM,
            v::OWL_ALL_VALUES_FROM,
            v::OWL_ON_DATARANGE,
            v::SH_DATATYPE,
        ] {
            for t in g.triples_for_predicate(nn(p)) {
                let TermRef::NamedNode(o) = t.object else {
                    continue;
                };
                let o = o.as_str();
                if p == v::SH_DATATYPE
                    || p == v::OWL_ON_DATARANGE
                    || is_datatype_iri(o)
                    || self.has_type(t.subject, v::OWL_DATATYPE_PROPERTY)
                {
                    self.intern(o, Kind::Datatype);
                } else if o != v::RDFS_LITERAL {
                    let subject_is_datatype_prop = match t.subject {
                        NamedOrBlankNodeRef::NamedNode(s) => self
                            .id_of(s.as_str())
                            .is_some_and(|id| self.kind(id) == Kind::DatatypeProperty),
                        _ => false,
                    };
                    if !subject_is_datatype_prop {
                        self.intern(o, Kind::Class);
                    }
                }
            }
        }
        // Properties implied by use in SHACL paths, domains, ranges and restrictions.
        for p in [
            v::SH_PATH,
            v::OWL_ON_PROPERTY,
            v::SH_TARGET_SUBJECTS_OF,
            v::SH_TARGET_OBJECTS_OF,
            v::OWL_INVERSE_OF,
            v::RDFS_SUBPROPERTYOF,
            v::OWL_EQUIVALENT_PROPERTY,
        ] {
            for t in g.triples_for_predicate(nn(p)) {
                if let TermRef::NamedNode(o) = t.object {
                    self.intern(o.as_str(), Kind::Property);
                }
                if let NamedOrBlankNodeRef::NamedNode(s) = t.subject
                    && matches!(
                        p,
                        v::RDFS_SUBPROPERTYOF | v::OWL_INVERSE_OF | v::OWL_EQUIVALENT_PROPERTY
                    )
                {
                    self.intern(s.as_str(), Kind::Property);
                }
            }
        }
        for p in [v::RDFS_DOMAIN, v::RDFS_RANGE] {
            for t in g.triples_for_predicate(nn(p)) {
                if let NamedOrBlankNodeRef::NamedNode(s) = t.subject {
                    self.intern(s.as_str(), Kind::Property);
                }
            }
        }
        // Shapes implied by SHACL predicates on untyped named subjects.
        for p in [
            v::SH_PROPERTY,
            v::SH_TARGET_CLASS,
            v::SH_TARGET_NODE,
            v::SH_TARGET_SUBJECTS_OF,
            v::SH_TARGET_OBJECTS_OF,
        ] {
            for t in g.triples_for_predicate(nn(p)) {
                if let NamedOrBlankNodeRef::NamedNode(s) = t.subject
                    && !self.ids.contains_key(s.as_str())
                {
                    self.intern(s.as_str(), Kind::NodeShape);
                }
            }
        }
        for t in g.triples_for_predicate(nn(v::SH_NODE)) {
            if let TermRef::NamedNode(o) = t.object
                && !self.ids.contains_key(o.as_str())
            {
                self.intern(o.as_str(), Kind::NodeShape);
            }
        }
        for t in g.triples_for_predicate(nn(v::SH_GROUP)) {
            if let TermRef::NamedNode(o) = t.object {
                self.intern(o.as_str(), Kind::PropertyGroup);
            }
        }
        // SKOS implied.
        for p in [v::SKOS_IN_SCHEME, v::SKOS_TOP_CONCEPT_OF] {
            for t in g.triples_for_predicate(nn(p)) {
                if let TermRef::NamedNode(o) = t.object {
                    self.intern(o.as_str(), Kind::ConceptScheme);
                }
                if let NamedOrBlankNodeRef::NamedNode(s) = t.subject
                    && !self.ids.contains_key(s.as_str())
                {
                    self.intern(s.as_str(), Kind::Concept);
                }
            }
        }
        for p in [
            v::SKOS_BROADER,
            v::SKOS_NARROWER,
            v::SKOS_HAS_TOP_CONCEPT,
            v::SKOS_RELATED,
        ] {
            for t in g.triples_for_predicate(nn(p)) {
                if p == v::SKOS_HAS_TOP_CONCEPT {
                    if let NamedOrBlankNodeRef::NamedNode(s) = t.subject {
                        self.intern(s.as_str(), Kind::ConceptScheme);
                    }
                } else if let NamedOrBlankNodeRef::NamedNode(s) = t.subject
                    && !self.ids.contains_key(s.as_str())
                {
                    self.intern(s.as_str(), Kind::Concept);
                }
                if let TermRef::NamedNode(o) = t.object
                    && !self.ids.contains_key(o.as_str())
                {
                    self.intern(o.as_str(), Kind::Concept);
                }
            }
        }
        // Individuals: named subjects typed with a class we know, not yet classified.
        for (s, t) in &typed {
            let NamedOrBlankNode::NamedNode(s) = s else {
                continue;
            };
            if self.ids.contains_key(s.as_str()) {
                continue;
            }
            if t == v::OWL_NAMED_INDIVIDUAL {
                self.intern(s.as_str(), Kind::Individual);
                continue;
            }
            if self.id_of(t).is_some_and(|id| self.kind(id) == Kind::Class) {
                self.intern(s.as_str(), Kind::Individual);
            }
        }
        if !self.uses_dash {
            self.uses_dash = g.iter().any(|t| t.predicate.as_str().starts_with(v::DASH));
        }
        // Prefer annotation predicates to be entities too, so annotations can link.
        for p in v::LABEL_PREDICATES.iter().chain(v::COMMENT_PREDICATES) {
            if g.triples_for_predicate(nn(p)).next().is_some() {
                self.intern(p, Kind::AnnotationProperty);
            }
        }
    }

    // ----- step 2: labels, comments, flags, annotations ---------------------

    fn describe_entities(&mut self) {
        let n = self.entities.len();
        for id in 0..n as Id {
            let iri = self.iri(id).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let mut label = LangMap::new();
            for p in v::LABEL_PREDICATES {
                for (lang, text) in self.lang_map(s, p) {
                    label.entry(lang).or_insert(text);
                }
            }
            let mut comment = LangMap::new();
            for p in v::COMMENT_PREDICATES {
                for (lang, text) in self.lang_map(s, p) {
                    comment.entry(lang).or_insert(text);
                }
            }
            let status = self.literal_string(s, v::VS_TERM_STATUS);
            let deprecated = self.is_true(s, v::OWL_DEPRECATED)
                || self.has_type(s, v::OWL_DEPRECATED_CLASS)
                || self.has_type(s, v::OWL_DEPRECATED_PROPERTY)
                || status
                    .as_deref()
                    .is_some_and(|x| matches!(x, "deprecated" | "archaic"))
                || self.object(s, v::SCHEMA_SUPERSEDED_BY).is_some();
            let sources = self
                .loaded
                .subject_sources
                .get(&NamedOrBlankNode::NamedNode(
                    oxrdf::NamedNode::new_unchecked(&iri),
                ))
                .cloned()
                .unwrap_or_default();
            // Other annotations.
            let mut annotations = Vec::new();
            let mut new_preds: Vec<String> = Vec::new();
            for t in self.g.triples_for_subject(s) {
                let p = t.predicate.as_str();
                if v::STRUCTURAL_PREDICATES.contains(&p)
                    || v::LABEL_PREDICATES.contains(&p)
                    || v::COMMENT_PREDICATES.contains(&p)
                    || p == v::VS_TERM_STATUS
                {
                    continue;
                }
                let (value, r, lang) = match t.object {
                    TermRef::NamedNode(o) => (o.as_str().to_string(), self.id_of(o.as_str()), None),
                    TermRef::Literal(l) => (
                        literal_text(l, &self.prefixes),
                        None,
                        l.language().map(|x| x.to_string()),
                    ),
                    _ => continue,
                };
                if annotations.len() >= 60 {
                    break;
                }
                if !self.ids.contains_key(p) && !new_preds.iter().any(|x| x == p) {
                    new_preds.push(p.to_string());
                }
                annotations.push((p.to_string(), value, r, lang));
            }
            for p in new_preds {
                self.intern(&p, Kind::AnnotationProperty);
            }
            let annotations = annotations
                .into_iter()
                .map(|(p, v, r, lang)| Annotation {
                    p: self.id_of(&p).expect("interned"),
                    v,
                    r,
                    lang,
                })
                .collect();
            let e = &mut self.entities[id as usize];
            e.label = label;
            e.comment = comment;
            e.status = status;
            e.deprecated = deprecated;
            e.sources = sources;
            e.annotations = annotations;
        }
        // Annotation predicates created above have no description yet; give
        // them labels in a second, cheap pass.
        for id in n as Id..self.entities.len() as Id {
            let iri = self.iri(id).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let mut label = LangMap::new();
            for p in v::LABEL_PREDICATES {
                for (lang, text) in self.lang_map(s, p) {
                    label.entry(lang).or_insert(text);
                }
            }
            self.entities[id as usize].label = label;
        }
    }

    // ----- step 3: classes ---------------------------------------------------

    /// The classes a class expression stands for: a named class, or the
    /// members of an `owl:unionOf`.
    fn class_expr(&mut self, t: TermRef<'_>) -> Vec<Id> {
        match t {
            TermRef::NamedNode(n) => {
                if matches!(n.as_str(), v::OWL_THING | v::RDFS_RESOURCE)
                    || is_datatype_iri(n.as_str())
                {
                    return Vec::new();
                }
                if self
                    .id_of(n.as_str())
                    .is_some_and(|id| self.kind(id) == Kind::Datatype)
                {
                    return Vec::new();
                }
                vec![self.intern(n.as_str(), Kind::Class)]
            }
            TermRef::BlankNode(b) => {
                let s = NamedOrBlankNodeRef::BlankNode(b);
                if let Some(u) = self.object(s, v::OWL_UNION_OF) {
                    let members = self.list(u);
                    return members
                        .iter()
                        .flat_map(|m| self.class_expr(m.as_ref()))
                        .collect();
                }
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    fn build_classes(&mut self) {
        let class_ids: Vec<Id> = (0..self.entities.len() as Id)
            .filter(|&id| self.kind(id) == Kind::Class)
            .collect();
        for &id in &class_ids {
            let iri = self.iri(id).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let mut info = ClassInfo::default();
            let supers: Vec<Term> = self
                .objects(s, v::RDFS_SUBCLASSOF)
                .map(|o| o.into_owned())
                .collect();
            for sup in &supers {
                if let TermRef::NamedNode(n) = sup.as_ref() {
                    if matches!(n.as_str(), v::OWL_THING | v::RDFS_RESOURCE) {
                        continue;
                    }
                    let sid = self.intern(n.as_str(), Kind::Class);
                    if sid != id {
                        info.super_classes.push(sid);
                    }
                }
            }
            for eq in self
                .objects(s, v::OWL_EQUIVALENT_CLASS)
                .map(|o| o.into_owned())
                .collect::<Vec<_>>()
            {
                match eq.as_ref() {
                    TermRef::NamedNode(n) => {
                        let eid = self.intern(n.as_str(), Kind::Class);
                        info.equivalent.push(eid);
                    }
                    TermRef::BlankNode(b) => {
                        let bs = NamedOrBlankNodeRef::BlankNode(b);
                        if let Some(u) = self.object(bs, v::OWL_UNION_OF) {
                            let members = self.list(u);
                            info.union_of = members
                                .iter()
                                .flat_map(|m| self.class_expr(m.as_ref()))
                                .collect();
                        }
                    }
                    _ => {}
                }
            }
            if let Some(u) = self.object(s, v::OWL_UNION_OF) {
                let members = self.list(u);
                info.union_of = members
                    .iter()
                    .flat_map(|m| self.class_expr(m.as_ref()))
                    .collect();
            }
            for d in self.named_objects(s, v::OWL_DISJOINT_WITH) {
                let did = self.intern(&d, Kind::Class);
                info.disjoint.push(did);
            }
            info.r#abstract = self.is_true(s, v::DASH_ABSTRACT);
            self.classes.insert(id, info);
        }
        // Classes discovered while reading (super classes of super classes) need entries too.
        let mut pending: Vec<Id> = (0..self.entities.len() as Id)
            .filter(|&id| self.kind(id) == Kind::Class && !self.classes.contains_key(&id))
            .collect();
        while let Some(id) = pending.pop() {
            let iri = self.iri(id).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let mut info = ClassInfo::default();
            for sup in self.named_objects(s, v::RDFS_SUBCLASSOF) {
                if matches!(sup.as_str(), v::OWL_THING | v::RDFS_RESOURCE) {
                    continue;
                }
                let before = self.entities.len();
                let sid = self.intern(&sup, Kind::Class);
                if self.entities.len() > before {
                    pending.push(sid);
                }
                if sid != id {
                    info.super_classes.push(sid);
                }
            }
            info.r#abstract = self.is_true(s, v::DASH_ABSTRACT);
            self.classes.insert(id, info);
        }
        // Sub classes, ancestors.
        let ids: Vec<Id> = self.classes.keys().copied().collect();
        for &id in &ids {
            let supers = self.classes[&id].super_classes.clone();
            for sup in supers {
                if let Some(si) = self.classes.get_mut(&sup) {
                    si.sub_classes.push(id);
                }
            }
        }
        for &id in &ids {
            let mut seen: Vec<Id> = Vec::new();
            let mut queue: VecDeque<Id> = self.classes[&id].super_classes.iter().copied().collect();
            while let Some(c) = queue.pop_front() {
                if c == id || seen.contains(&c) {
                    continue;
                }
                seen.push(c);
                if let Some(ci) = self.classes.get(&c) {
                    queue.extend(ci.super_classes.iter().copied());
                }
            }
            self.classes.get_mut(&id).unwrap().ancestors = seen;
        }
        for &id in &ids {
            let mut subs = std::mem::take(&mut self.classes.get_mut(&id).unwrap().sub_classes);
            self.sort_ids(&mut subs);
            self.classes.get_mut(&id).unwrap().sub_classes = subs;
        }
    }

    // ----- step 4: properties -----------------------------------------------

    fn build_properties(&mut self) {
        let ids: Vec<Id> = (0..self.entities.len() as Id)
            .filter(|&id| self.kind(id).is_property())
            .collect();
        for &id in &ids {
            let iri = self.iri(id).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let mut info = PropertyInfo::default();
            let mut domain_terms: Vec<Term> = self
                .objects(s, v::RDFS_DOMAIN)
                .map(|o| o.into_owned())
                .collect();
            for p in [v::SCHEMA_DOMAIN_INCLUDES, v::SCHEMA_DOMAIN_INCLUDES_HTTP] {
                domain_terms.extend(self.objects(s, p).map(|o| o.into_owned()));
            }
            for d in &domain_terms {
                info.domain.extend(self.class_expr(d.as_ref()));
            }
            let mut range_terms: Vec<Term> = self
                .objects(s, v::RDFS_RANGE)
                .map(|o| o.into_owned())
                .collect();
            for p in [v::SCHEMA_RANGE_INCLUDES, v::SCHEMA_RANGE_INCLUDES_HTTP] {
                range_terms.extend(self.objects(s, p).map(|o| o.into_owned()));
            }
            let kind = self.kind(id);
            for r in &range_terms {
                match r.as_ref() {
                    TermRef::NamedNode(n) => {
                        let n = n.as_str();
                        if is_datatype_iri(n)
                            || kind == Kind::DatatypeProperty
                            || self
                                .id_of(n)
                                .is_some_and(|x| self.kind(x) == Kind::Datatype)
                        {
                            let did = self.intern(n, Kind::Datatype);
                            info.range.push(did);
                        } else if self
                            .id_of(n)
                            .is_some_and(|x| self.kind(x) == Kind::ConceptScheme)
                        {
                            info.scheme = Some(self.id_of(n).unwrap());
                        } else if n != v::RDFS_LITERAL {
                            info.range.extend(self.class_expr(r.as_ref()));
                        }
                    }
                    TermRef::BlankNode(_) => info.range.extend(self.class_expr(r.as_ref())),
                    _ => {}
                }
            }
            for sup in self.named_objects(s, v::RDFS_SUBPROPERTYOF) {
                let sid = self.intern(&sup, Kind::Property);
                if sid != id {
                    info.super_properties.push(sid);
                }
            }
            for inv in self.named_objects(s, v::OWL_INVERSE_OF) {
                let iid = self.intern(&inv, Kind::ObjectProperty);
                info.inverse_of.push(iid);
            }
            for eq in self.named_objects(s, v::OWL_EQUIVALENT_PROPERTY) {
                let eid = self.intern(&eq, Kind::Property);
                info.equivalent.push(eid);
            }
            for (t, name) in [
                (v::OWL_FUNCTIONAL, "functional"),
                (v::OWL_INVERSE_FUNCTIONAL, "inverseFunctional"),
                (v::OWL_SYMMETRIC, "symmetric"),
                (v::OWL_TRANSITIVE, "transitive"),
            ] {
                if self.has_type(s, t) {
                    info.characteristics.push(name.to_string());
                }
            }
            // A value set: any annotation pointing at a concept scheme.
            if info.scheme.is_none() {
                for t in self.g.triples_for_subject(s) {
                    if t.predicate.as_str() == v::RDF_TYPE {
                        continue;
                    }
                    if let TermRef::NamedNode(o) = t.object
                        && let Some(oid) = self.id_of(o.as_str())
                        && self.kind(oid) == Kind::ConceptScheme
                    {
                        info.scheme = Some(oid);
                        break;
                    }
                }
            }
            self.properties.insert(id, info);
        }
        // Late-interned properties (super properties, inverses) get empty entries.
        for id in 0..self.entities.len() as Id {
            if self.kind(id).is_property() && !self.properties.contains_key(&id) {
                self.properties.insert(id, PropertyInfo::default());
            }
        }
        let ids: Vec<Id> = self.properties.keys().copied().collect();
        for &id in &ids {
            for sup in self.properties[&id].super_properties.clone() {
                if let Some(pi) = self.properties.get_mut(&sup) {
                    pi.sub_properties.push(id);
                }
            }
            for inv in self.properties[&id].inverse_of.clone() {
                if let Some(pi) = self.properties.get_mut(&inv)
                    && !pi.inverse_of.contains(&id)
                {
                    pi.inverse_of.push(id);
                }
            }
        }
        // Properties with an XSD range but no type are datatype properties for display.
        for &id in &ids {
            if self.kind(id) == Kind::Property {
                let info = &self.properties[&id];
                let all_dt = !info.range.is_empty()
                    && info.range.iter().all(|&r| self.kind(r) == Kind::Datatype);
                let any_class = info.range.iter().any(|&r| self.kind(r) == Kind::Class);
                if all_dt {
                    self.entities[id as usize].kind = Kind::DatatypeProperty;
                } else if any_class || info.inverse_of.iter().any(|_| true) {
                    self.entities[id as usize].kind = Kind::ObjectProperty;
                }
            }
        }
    }

    fn build_groups(&mut self) {
        for id in 0..self.entities.len() as Id {
            if self.kind(id) == Kind::PropertyGroup {
                let iri = self.iri(id).to_string();
                let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
                let order = self.literal_f64(s, v::SH_ORDER);
                self.groups.insert(id, GroupInfo { order });
            }
        }
    }

    // ----- step 5: shapes ----------------------------------------------------

    /// Readable SHACL path. Returns (text, ids used, single forward property, single inverse).
    fn path(&mut self, t: TermRef<'_>) -> (String, Vec<Id>, Option<Id>, bool) {
        match t {
            TermRef::NamedNode(n) => {
                let id = self.intern(n.as_str(), Kind::Property);
                (self.prefixes.curie(n.as_str()), vec![id], Some(id), false)
            }
            TermRef::BlankNode(b) => {
                let s = NamedOrBlankNodeRef::BlankNode(b);
                if let Some(inner) = self.object(s, v::SH_INVERSE_PATH) {
                    let inner = inner.into_owned();
                    let (txt, ids, single, _) = self.path(inner.as_ref());
                    let wrapped = if single.is_some() {
                        format!("^{txt}")
                    } else {
                        format!("^({txt})")
                    };
                    return (wrapped, ids, None, single.is_some());
                }
                if let Some(alt) = self.object(s, v::SH_ALTERNATIVE_PATH) {
                    let members = self.list(alt);
                    let mut ids = Vec::new();
                    let parts: Vec<String> = members
                        .iter()
                        .map(|m| {
                            let (txt, i, _, _) = self.path(m.as_ref());
                            ids.extend(i);
                            txt
                        })
                        .collect();
                    return (format!("({})", parts.join(" | ")), ids, None, false);
                }
                for (p, suffix) in [
                    (v::SH_ZERO_OR_MORE_PATH, "*"),
                    (v::SH_ONE_OR_MORE_PATH, "+"),
                    (v::SH_ZERO_OR_ONE_PATH, "?"),
                ] {
                    if let Some(inner) = self.object(s, p) {
                        let inner = inner.into_owned();
                        let (txt, ids, single, _) = self.path(inner.as_ref());
                        let wrapped = if single.is_some() {
                            format!("{txt}{suffix}")
                        } else {
                            format!("({txt}){suffix}")
                        };
                        return (wrapped, ids, None, false);
                    }
                }
                // A sequence (rdf:List).
                let members = self.list(t);
                if !members.is_empty() {
                    let mut ids = Vec::new();
                    let parts: Vec<String> = members
                        .iter()
                        .map(|m| {
                            let (txt, i, _, _) = self.path(m.as_ref());
                            ids.extend(i);
                            txt
                        })
                        .collect();
                    return (parts.join(" / "), ids, None, false);
                }
                ("[unreadable path]".to_string(), Vec::new(), None, false)
            }
            _ => (self.term_label(t), Vec::new(), None, false),
        }
    }

    /// Short description of a shape given inline (blank node) in sh:or, sh:node...
    fn inline_shape_text(&mut self, s: NamedOrBlankNodeRef<'_>, refs: &mut Vec<Id>) -> String {
        let mut parts = Vec::new();
        if let Some(path) = self.object(s, v::SH_PATH) {
            let path = path.into_owned();
            let (txt, ids, _, _) = self.path(path.as_ref());
            refs.extend(ids);
            parts.push(format!("path {txt}"));
        }
        for (p, name) in [
            (v::SH_CLASS, "class"),
            (v::SH_DATATYPE, "datatype"),
            (v::SH_NODE_KIND, "nodeKind"),
            (v::SH_NODE, "node"),
            (v::SH_HAS_VALUE, "hasValue"),
            (v::SH_MIN_COUNT, "minCount"),
            (v::SH_MAX_COUNT, "maxCount"),
            (v::SH_PATTERN, "pattern"),
            (v::SH_MIN_INCLUSIVE, "minInclusive"),
            (v::SH_MAX_INCLUSIVE, "maxInclusive"),
            (v::SH_MIN_LENGTH, "minLength"),
            (v::SH_MAX_LENGTH, "maxLength"),
        ] {
            for o in self
                .objects(s, p)
                .map(|o| o.into_owned())
                .collect::<Vec<_>>()
            {
                if let TermRef::NamedNode(n) = o.as_ref()
                    && let Some(id) = self.id_of(n.as_str())
                {
                    refs.push(id);
                }
                parts.push(format!("{name} {}", self.term_label(o.as_ref())));
            }
        }
        if let Some(l) = self.object(s, v::SH_IN) {
            let members = self.list(l);
            let labels: Vec<String> = members
                .iter()
                .take(12)
                .map(|m| self.term_label(m.as_ref()))
                .collect();
            let more = if members.len() > 12 {
                format!(" … ({} values)", members.len())
            } else {
                String::new()
            };
            parts.push(format!("in [{}{}]", labels.join(", "), more));
        }
        for (p, name) in [(v::SH_OR, "or"), (v::SH_AND, "and"), (v::SH_XONE, "xone")] {
            if let Some(l) = self.object(s, p) {
                let members = self.list(l);
                let texts: Vec<String> = members
                    .iter()
                    .map(|m| match m.as_ref() {
                        TermRef::NamedNode(n) => {
                            if let Some(id) = self.id_of(n.as_str()) {
                                refs.push(id);
                            }
                            self.prefixes.curie(n.as_str())
                        }
                        TermRef::BlankNode(b) => {
                            let t = self.inline_shape_text(NamedOrBlankNodeRef::BlankNode(b), refs);
                            format!("[{t}]")
                        }
                        other => self.term_label(other),
                    })
                    .collect();
                parts.push(format!("{name} ({})", texts.join(" ; ")));
            }
        }
        if let Some(n) = self.object(s, v::SH_NOT) {
            let n = n.into_owned();
            let txt = match n.as_ref() {
                TermRef::BlankNode(b) => format!(
                    "[{}]",
                    self.inline_shape_text(NamedOrBlankNodeRef::BlankNode(b), refs)
                ),
                other => self.term_label(other),
            };
            parts.push(format!("not {txt}"));
        }
        if parts.is_empty() {
            "[shape]".to_string()
        } else {
            parts.join(", ")
        }
    }

    /// Node-level and value constraints of a shape node, as readable items.
    fn constraints_of(
        &mut self,
        s: NamedOrBlankNodeRef<'_>,
        skip_property_level: bool,
    ) -> Vec<Constraint> {
        let mut out = Vec::new();
        let simple: &[(&str, &str)] = &[
            (v::SH_PATTERN, "pattern"),
            (v::SH_FLAGS, "flags"),
            (v::SH_MIN_LENGTH, "minLength"),
            (v::SH_MAX_LENGTH, "maxLength"),
            (v::SH_MIN_INCLUSIVE, "minInclusive"),
            (v::SH_MAX_INCLUSIVE, "maxInclusive"),
            (v::SH_MIN_EXCLUSIVE, "minExclusive"),
            (v::SH_MAX_EXCLUSIVE, "maxExclusive"),
            (v::SH_UNIQUE_LANG, "uniqueLang"),
            (v::SH_HAS_VALUE, "hasValue"),
            (v::SH_EQUALS, "equals"),
            (v::SH_DISJOINT, "disjoint"),
            (v::SH_LESS_THAN, "lessThan"),
            (v::SH_LESS_THAN_OR_EQUALS, "lessThanOrEquals"),
            (v::SH_DEFAULT_VALUE, "defaultValue"),
            (v::SH_QUALIFIED_MIN_COUNT, "qualifiedMinCount"),
            (v::SH_QUALIFIED_MAX_COUNT, "qualifiedMaxCount"),
        ];
        for (p, name) in simple {
            for o in self
                .objects(s, p)
                .map(|o| o.into_owned())
                .collect::<Vec<_>>()
            {
                let mut refs = Vec::new();
                if let TermRef::NamedNode(n) = o.as_ref()
                    && let Some(id) = self.id_of(n.as_str())
                {
                    refs.push(id);
                }
                out.push(Constraint {
                    kind: name.to_string(),
                    text: self.term_label(o.as_ref()),
                    refs,
                });
            }
        }
        if !skip_property_level {
            // Node-level class/datatype/nodeKind/in/node constraints are shown as constraints.
            for (p, name) in [
                (v::SH_CLASS, "class"),
                (v::SH_DATATYPE, "datatype"),
                (v::SH_NODE_KIND, "nodeKind"),
                (v::SH_NODE, "node"),
            ] {
                for o in self
                    .objects(s, p)
                    .map(|o| o.into_owned())
                    .collect::<Vec<_>>()
                {
                    let mut refs = Vec::new();
                    let text = match o.as_ref() {
                        TermRef::NamedNode(n) => {
                            if let Some(id) = self.id_of(n.as_str()) {
                                refs.push(id);
                            }
                            self.prefixes.curie(n.as_str())
                        }
                        TermRef::BlankNode(b) => {
                            let t = self
                                .inline_shape_text(NamedOrBlankNodeRef::BlankNode(b), &mut refs);
                            format!("[{t}]")
                        }
                        other => self.term_label(other),
                    };
                    out.push(Constraint {
                        kind: name.to_string(),
                        text,
                        refs,
                    });
                }
            }
        }
        if let Some(l) = self.object(s, v::SH_IN) {
            let members = self.list(l);
            let mut refs = Vec::new();
            for m in &members {
                if let TermRef::NamedNode(n) = m.as_ref()
                    && let Some(id) = self.id_of(n.as_str())
                {
                    refs.push(id);
                }
            }
            let labels: Vec<String> = members
                .iter()
                .take(40)
                .map(|m| self.term_label(m.as_ref()))
                .collect();
            let more = if members.len() > 40 {
                format!(" … ({} values in total)", members.len())
            } else {
                String::new()
            };
            out.push(Constraint {
                kind: "in".to_string(),
                text: format!("{}{}", labels.join(", "), more),
                refs,
            });
        }
        if let Some(l) = self.object(s, v::SH_LANGUAGE_IN) {
            let members = self.list(l);
            let labels: Vec<String> = members
                .iter()
                .map(|m| self.term_label(m.as_ref()))
                .collect();
            out.push(Constraint {
                kind: "languageIn".to_string(),
                text: labels.join(", "),
                refs: Vec::new(),
            });
        }
        for (p, name) in [(v::SH_OR, "or"), (v::SH_AND, "and"), (v::SH_XONE, "xone")] {
            for l in self
                .objects(s, p)
                .map(|o| o.into_owned())
                .collect::<Vec<_>>()
            {
                let members = self.list(l.as_ref());
                let mut refs = Vec::new();
                let texts: Vec<String> = members
                    .iter()
                    .map(|m| match m.as_ref() {
                        TermRef::NamedNode(n) => {
                            if let Some(id) = self.id_of(n.as_str()) {
                                refs.push(id);
                            }
                            self.prefixes.curie(n.as_str())
                        }
                        TermRef::BlankNode(b) => {
                            let t = self
                                .inline_shape_text(NamedOrBlankNodeRef::BlankNode(b), &mut refs);
                            format!("[{t}]")
                        }
                        other => self.term_label(other),
                    })
                    .collect();
                out.push(Constraint {
                    kind: name.to_string(),
                    text: texts.join(" ; "),
                    refs,
                });
            }
        }
        for o in self
            .objects(s, v::SH_NOT)
            .map(|o| o.into_owned())
            .collect::<Vec<_>>()
        {
            let mut refs = Vec::new();
            let text = match o.as_ref() {
                TermRef::NamedNode(n) => {
                    if let Some(id) = self.id_of(n.as_str()) {
                        refs.push(id);
                    }
                    self.prefixes.curie(n.as_str())
                }
                TermRef::BlankNode(b) => {
                    let t = self.inline_shape_text(NamedOrBlankNodeRef::BlankNode(b), &mut refs);
                    format!("[{t}]")
                }
                other => self.term_label(other),
            };
            out.push(Constraint {
                kind: "not".to_string(),
                text,
                refs,
            });
        }
        for o in self
            .objects(s, v::SH_QUALIFIED_VALUE_SHAPE)
            .map(|o| o.into_owned())
            .collect::<Vec<_>>()
        {
            let mut refs = Vec::new();
            let text = match o.as_ref() {
                TermRef::NamedNode(n) => {
                    if let Some(id) = self.id_of(n.as_str()) {
                        refs.push(id);
                    }
                    self.prefixes.curie(n.as_str())
                }
                TermRef::BlankNode(b) => {
                    let t = self.inline_shape_text(NamedOrBlankNodeRef::BlankNode(b), &mut refs);
                    format!("[{t}]")
                }
                other => self.term_label(other),
            };
            out.push(Constraint {
                kind: "qualifiedValueShape".to_string(),
                text,
                refs,
            });
        }
        if self.is_true(s, v::SH_CLOSED) {
            let ignored: Vec<String> = self
                .object(s, v::SH_IGNORED_PROPERTIES)
                .map(|l| {
                    self.list(l)
                        .iter()
                        .map(|m| self.term_label(m.as_ref()))
                        .collect()
                })
                .unwrap_or_default();
            let text = if ignored.is_empty() {
                "no other properties allowed".to_string()
            } else {
                format!("no other properties allowed, except {}", ignored.join(", "))
            };
            out.push(Constraint {
                kind: "closed".to_string(),
                text,
                refs: Vec::new(),
            });
        }
        for sp in self
            .objects(s, v::SH_SPARQL)
            .map(|o| o.into_owned())
            .collect::<Vec<_>>()
        {
            let node = match sp.as_ref() {
                TermRef::NamedNode(n) => NamedOrBlankNodeRef::NamedNode(n),
                TermRef::BlankNode(b) => NamedOrBlankNodeRef::BlankNode(b),
                _ => continue,
            };
            let msg = self.lang_map(node, v::SH_MESSAGE);
            let select = self.literal_string(node, v::SH_SELECT).unwrap_or_default();
            let message = msg
                .get("en")
                .or_else(|| msg.values().next())
                .cloned()
                .unwrap_or_default();
            let text = if message.is_empty() {
                select.clone()
            } else {
                format!("{message}\n{select}")
            };
            out.push(Constraint {
                kind: "sparql".to_string(),
                text,
                refs: Vec::new(),
            });
        }
        out
    }

    /// The concept scheme a node shape restricts its focus nodes to, via a property shape
    /// on `skos:inScheme` with `sh:hasValue` (or a one-element `sh:in`).
    fn scheme_via_node(&self, node: NamedOrBlankNodeRef<'_>) -> Option<Id> {
        for ps in self.objects(node, v::SH_PROPERTY) {
            let ps: NamedOrBlankNodeRef<'_> = match ps {
                TermRef::NamedNode(n) => n.into(),
                TermRef::BlankNode(b) => b.into(),
                _ => continue,
            };
            if !matches!(self.object(ps, v::SH_PATH), Some(TermRef::NamedNode(p)) if p.as_str() == v::SKOS_IN_SCHEME)
            {
                continue;
            }
            let mut candidates = self.named_objects(ps, v::SH_HAS_VALUE);
            if let Some(l) = self.object(ps, v::SH_IN) {
                let members = self.list(l);
                if members.len() == 1
                    && let Term::NamedNode(n) = &members[0]
                {
                    candidates.push(n.as_str().to_string());
                }
            }
            for c in candidates {
                if let Some(id) = self.id_of(&c)
                    && self.kind(id) == Kind::ConceptScheme
                {
                    return Some(id);
                }
            }
        }
        None
    }

    /// A property shape as a row. `s` is the property shape node.
    fn prop_row(&mut self, s: NamedOrBlankNodeRef<'_>) -> Option<PropRow> {
        let path_term = self.object(s, v::SH_PATH)?.into_owned();
        let (path, path_ids, property, inverse) = self.path(path_term.as_ref());
        let mut row = PropRow {
            property,
            path,
            path_ids,
            inverse,
            ..Default::default()
        };
        row.name = self.lang_map(s, v::SH_NAME);
        row.description = self.lang_map(s, v::SH_DESCRIPTION);
        for c in self.named_objects(s, v::SH_CLASS) {
            if let Some(id) = self.id_of(&c)
                && self.kind(id) == Kind::ConceptScheme
            {
                row.scheme = Some(id);
                continue;
            }
            if is_datatype_iri(&c)
                || self
                    .id_of(&c)
                    .is_some_and(|id| self.kind(id) == Kind::Datatype)
            {
                row.datatype.get_or_insert(self.intern(&c, Kind::Datatype));
                continue;
            }
            let id = self.intern(&c, Kind::Class);
            row.range.push(id);
        }
        if let Some(dt) = self.named_objects(s, v::SH_DATATYPE).first() {
            row.datatype = Some(self.intern(dt, Kind::Datatype));
        }
        row.node_kind = self
            .named_objects(s, v::SH_NODE_KIND)
            .first()
            .map(|k| local_name(k).to_string());
        for n in self.named_objects(s, v::SH_NODE) {
            if let Some(id) = self.id_of(&n) {
                row.node.push(id);
                if self.kind(id) == Kind::Class {
                    row.range.push(id);
                } else if let Some(si) = self.shapes.get(&id) {
                    row.range.extend(si.target_class.iter().copied());
                }
            }
        }
        row.min = self.literal_u32(s, v::SH_MIN_COUNT);
        row.max = self.literal_u32(s, v::SH_MAX_COUNT);
        if let Some(g) = self.named_objects(s, v::SH_GROUP).first() {
            let gid = self.intern(g, Kind::PropertyGroup);
            if !self.groups.contains_key(&gid) {
                let gs = NamedOrBlankNodeRef::NamedNode(nn(g));
                let order = self.literal_f64(gs, v::SH_ORDER);
                self.groups.insert(gid, GroupInfo { order });
            }
            row.group = Some(gid);
        }
        row.order = self.literal_f64(s, v::SH_ORDER);
        row.role = self
            .named_objects(s, v::DASH_PROPERTY_ROLE)
            .first()
            .map(|r| local_name(r).trim_end_matches("Role").to_string());
        row.composite = self.is_true(s, v::DASH_COMPOSITE);
        row.hidden = self.is_true(s, v::DASH_HIDDEN);
        row.read_only = self.is_true(s, v::DASH_READ_ONLY);
        row.viewer = self
            .named_objects(s, v::DASH_VIEWER)
            .first()
            .or(self.named_objects(s, v::DASH_EDITOR).first())
            .map(|x| local_name(x).to_string());
        row.severity = self
            .named_objects(s, v::SH_SEVERITY)
            .first()
            .map(|x| local_name(x).to_string());
        row.deactivated = self.is_true(s, v::SH_DEACTIVATED);
        row.constraints = self.constraints_of(s, true);
        // `sh:node` to a shape that pins `skos:inScheme` is a value set too.
        if row.scheme.is_none() {
            let nodes: Vec<NamedOrBlankNode> = self
                .objects(s, v::SH_NODE)
                .filter_map(|o| match o {
                    TermRef::NamedNode(n) => Some(n.into_owned().into()),
                    TermRef::BlankNode(b) => Some(b.into_owned().into()),
                    _ => None,
                })
                .collect();
            row.scheme = nodes.iter().find_map(|n| self.scheme_via_node(n.as_ref()));
        }
        // A value list of concepts from one scheme is a value set.
        if row.scheme.is_none()
            && let Some(l) = self.object(s, v::SH_IN)
        {
            let members = self.list(l);
            let mut schemes: Vec<Id> = Vec::new();
            let mut all_concepts = !members.is_empty();
            for m in &members {
                let TermRef::NamedNode(n) = m.as_ref() else {
                    all_concepts = false;
                    break;
                };
                let Some(id) = self.id_of(n.as_str()) else {
                    all_concepts = false;
                    break;
                };
                if self.kind(id) != Kind::Concept {
                    all_concepts = false;
                    break;
                }
                let cs = NamedOrBlankNodeRef::NamedNode(n);
                for sc in self.named_objects(cs, v::SKOS_IN_SCHEME) {
                    if let Some(sid) = self.id_of(&sc)
                        && !schemes.contains(&sid)
                    {
                        schemes.push(sid);
                    }
                }
            }
            if all_concepts && schemes.len() == 1 {
                row.scheme = Some(schemes[0]);
            }
        }
        for m in self.lang_map(s, v::SH_MESSAGE).into_values() {
            row.constraints.push(Constraint {
                kind: "message".to_string(),
                text: m,
                refs: Vec::new(),
            });
        }
        if let Some(pid) = row.property
            && let Some(pi) = self.properties.get(&pid)
            && row.scheme.is_none()
        {
            row.scheme = pi.scheme;
        }
        row.sources.push("shape".to_string());
        Some(row)
    }

    fn build_shapes(&mut self) {
        // Shape ids: node shapes, plus classes that carry shape data.
        let mut ids: Vec<Id> = Vec::new();
        for id in 0..self.entities.len() as Id {
            let k = self.kind(id);
            if k == Kind::NodeShape {
                ids.push(id);
            } else if k == Kind::Class {
                let iri = self.iri(id).to_string();
                let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
                if self.has_type(s, v::SH_NODE_SHAPE)
                    || self.has_type(s, v::DASH_SHAPE_CLASS)
                    || self.object(s, v::SH_PROPERTY).is_some()
                    || self.object(s, v::SH_TARGET_CLASS).is_some()
                {
                    ids.push(id);
                }
            }
        }
        // First pass: targets (so sh:node ranges can resolve), second pass: rows.
        for &id in &ids {
            let iri = self.iri(id).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let mut info = ShapeInfo::default();
            for c in self.named_objects(s, v::SH_TARGET_CLASS) {
                let cid = self.intern(&c, Kind::Class);
                info.target_class.push(cid);
            }
            if self.kind(id) == Kind::Class {
                info.implicit_target = true;
            }
            // dash:abstract on a shape marks the classes it targets as abstract.
            if self.is_true(s, v::DASH_ABSTRACT) {
                for c in &info.target_class {
                    if let Some(ci) = self.classes.get_mut(c) {
                        ci.r#abstract = true;
                    }
                }
            }
            info.target_node = self
                .objects(s, v::SH_TARGET_NODE)
                .map(|o| self.term_label(o))
                .collect();
            for p in self.named_objects(s, v::SH_TARGET_SUBJECTS_OF) {
                let pid = self.intern(&p, Kind::Property);
                info.target_subjects_of.push(pid);
            }
            for p in self.named_objects(s, v::SH_TARGET_OBJECTS_OF) {
                let pid = self.intern(&p, Kind::Property);
                info.target_objects_of.push(pid);
            }
            for c in self.named_objects(s, v::DASH_APPLICABLE_TO_CLASS) {
                let cid = self.intern(&c, Kind::Class);
                info.applicable_to.push(cid);
            }
            info.closed = self.is_true(s, v::SH_CLOSED);
            info.deactivated = self.is_true(s, v::SH_DEACTIVATED);
            info.severity = self
                .named_objects(s, v::SH_SEVERITY)
                .first()
                .map(|x| local_name(x).to_string());
            info.messages = self.lang_map(s, v::SH_MESSAGE).into_values().collect();
            self.shapes.insert(id, info);
        }
        // Classes that point at a shape through any annotation (e.g. era:shaclShapeValidationRule).
        let class_ids: Vec<Id> = self.classes.keys().copied().collect();
        for cid in class_ids {
            let iri = self.iri(cid).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let mut found = Vec::new();
            for t in self.g.triples_for_subject(s) {
                if t.predicate.as_str() == v::RDF_TYPE
                    || v::STRUCTURAL_PREDICATES.contains(&t.predicate.as_str())
                {
                    continue;
                }
                if let TermRef::NamedNode(o) = t.object
                    && let Some(sid) = self.id_of(o.as_str())
                    && self.shapes.contains_key(&sid)
                    && sid != cid
                {
                    found.push(sid);
                }
            }
            for sid in found {
                let si = self.shapes.get_mut(&sid).unwrap();
                if !si.applicable_to.contains(&cid) {
                    si.applicable_to.push(cid);
                }
            }
        }
        for &id in &ids {
            let iri = self.iri(id).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let mut rows = Vec::new();
            for ps in self
                .objects(s, v::SH_PROPERTY)
                .map(|o| o.into_owned())
                .collect::<Vec<_>>()
            {
                let node = match ps.as_ref() {
                    TermRef::NamedNode(n) => NamedOrBlankNodeRef::NamedNode(n),
                    TermRef::BlankNode(b) => NamedOrBlankNodeRef::BlankNode(b),
                    _ => continue,
                };
                let row = if let TermRef::NamedNode(n) = ps.as_ref() {
                    if let Some(r) = self.property_shape_cache.get(n.as_str()) {
                        Some(r.clone())
                    } else {
                        let r = self.prop_row(node);
                        if let Some(r) = &r {
                            self.property_shape_cache
                                .insert(n.as_str().to_string(), r.clone());
                        }
                        r
                    }
                } else {
                    self.prop_row(node)
                };
                if let Some(mut row) = row {
                    row.shapes = vec![id];
                    rows.push(row);
                }
            }
            rows.sort_by(|a, b| {
                a.order
                    .partial_cmp(&b.order)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.path.cmp(&b.path))
            });
            let constraints = self.constraints_of(s, false);
            let info = self.shapes.get_mut(&id).unwrap();
            info.properties = rows;
            info.constraints = constraints;
        }
        // used_by: shapes referenced from other shapes' rows or constraints.
        let shape_ids: Vec<Id> = self.shapes.keys().copied().collect();
        for &id in &shape_ids {
            let mut referenced: Vec<Id> = Vec::new();
            let info = &self.shapes[&id];
            for r in &info.properties {
                referenced.extend(r.node.iter().copied());
                for c in &r.constraints {
                    referenced.extend(c.refs.iter().copied());
                }
            }
            for c in &info.constraints {
                referenced.extend(c.refs.iter().copied());
            }
            for r in referenced {
                if r != id
                    && let Some(si) = self.shapes.get_mut(&r)
                    && !si.used_by.contains(&id)
                {
                    si.used_by.push(id);
                }
            }
        }
        // Standalone named property shapes that no node shape lists.
        for id in 0..self.entities.len() as Id {
            if self.kind(id) == Kind::PropertyShape {
                let iri = self.iri(id).to_string();
                if !self.property_shape_cache.contains_key(&iri) {
                    let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
                    if let Some(r) = self.prop_row(s) {
                        self.property_shape_cache.insert(iri, r);
                    }
                }
            }
        }
        // Shapes apply to classes.
        for &sid in &shape_ids {
            let info = self.shapes[&sid].clone();
            let mut targets: Vec<Id> = info.target_class.clone();
            targets.extend(info.applicable_to.iter().copied());
            if info.implicit_target {
                targets.push(sid);
            }
            for cid in targets {
                if let Some(ci) = self.classes.get_mut(&cid)
                    && !ci.shapes.contains(&sid)
                {
                    ci.shapes.push(sid);
                }
            }
        }
    }

    // ----- step 6: class property rows ---------------------------------------

    fn restriction_rows(&mut self, class_id: Id) -> Vec<PropRow> {
        let iri = self.iri(class_id).to_string();
        let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
        let mut nodes: Vec<Term> = self
            .objects(s, v::RDFS_SUBCLASSOF)
            .map(|o| o.into_owned())
            .collect();
        for eq in self
            .objects(s, v::OWL_EQUIVALENT_CLASS)
            .map(|o| o.into_owned())
            .collect::<Vec<_>>()
        {
            if let TermRef::BlankNode(b) = eq.as_ref() {
                let bs = NamedOrBlankNodeRef::BlankNode(b);
                if let Some(l) = self.object(bs, v::OWL_INTERSECTION_OF) {
                    nodes.extend(self.list(l));
                } else {
                    nodes.push(eq.clone());
                }
            }
        }
        let mut rows = Vec::new();
        for n in nodes {
            let TermRef::BlankNode(b) = n.as_ref() else {
                continue;
            };
            let r = NamedOrBlankNodeRef::BlankNode(b);
            if let Some(l) = self.object(r, v::OWL_INTERSECTION_OF) {
                for m in self.list(l) {
                    if let TermRef::BlankNode(mb) = m.as_ref()
                        && let Some(row) = self.restriction_row(NamedOrBlankNodeRef::BlankNode(mb))
                    {
                        rows.push(row);
                    }
                }
                continue;
            }
            if let Some(row) = self.restriction_row(r) {
                rows.push(row);
            }
        }
        rows
    }

    fn restriction_row(&mut self, r: NamedOrBlankNodeRef<'_>) -> Option<PropRow> {
        if !self.has_type(r, v::OWL_RESTRICTION) {
            return None;
        }
        let p = self
            .named_objects(r, v::OWL_ON_PROPERTY)
            .into_iter()
            .next()?;
        let pid = self.intern(&p, Kind::Property);
        let mut row = PropRow {
            property: Some(pid),
            path: self.prefixes.curie(&p),
            path_ids: vec![pid],
            ..Default::default()
        };
        for q in [
            v::OWL_SOME_VALUES_FROM,
            v::OWL_ALL_VALUES_FROM,
            v::OWL_ON_CLASS,
            v::OWL_ON_DATARANGE,
        ] {
            for o in self
                .objects(r, q)
                .map(|o| o.into_owned())
                .collect::<Vec<_>>()
            {
                match o.as_ref() {
                    TermRef::NamedNode(n)
                        if is_datatype_iri(n.as_str()) || q == v::OWL_ON_DATARANGE =>
                    {
                        row.datatype = Some(self.intern(n.as_str(), Kind::Datatype));
                    }
                    TermRef::NamedNode(n)
                        if self
                            .id_of(n.as_str())
                            .is_some_and(|x| self.kind(x) == Kind::Datatype) =>
                    {
                        row.datatype = Some(self.id_of(n.as_str()).unwrap());
                    }
                    _ => {
                        let ids = self.class_expr(o.as_ref());
                        row.range.extend(ids);
                    }
                }
                let kind = match q {
                    v::OWL_SOME_VALUES_FROM => "someValuesFrom",
                    v::OWL_ALL_VALUES_FROM => "allValuesFrom",
                    _ => "",
                };
                if !kind.is_empty() {
                    let mut refs = Vec::new();
                    if let TermRef::NamedNode(n) = o.as_ref()
                        && let Some(id) = self.id_of(n.as_str())
                    {
                        refs.push(id);
                    }
                    row.constraints.push(Constraint {
                        kind: kind.to_string(),
                        text: self.term_label(o.as_ref()),
                        refs,
                    });
                }
            }
        }
        if let Some(c) = self
            .literal_u32(r, v::OWL_CARDINALITY)
            .or(self.literal_u32(r, v::OWL_QUALIFIED_CARDINALITY))
        {
            row.min = Some(c);
            row.max = Some(c);
        }
        if let Some(c) = self
            .literal_u32(r, v::OWL_MIN_CARDINALITY)
            .or(self.literal_u32(r, v::OWL_MIN_QUALIFIED_CARDINALITY))
        {
            row.min = Some(c);
        }
        if let Some(c) = self
            .literal_u32(r, v::OWL_MAX_CARDINALITY)
            .or(self.literal_u32(r, v::OWL_MAX_QUALIFIED_CARDINALITY))
        {
            row.max = Some(c);
        }
        for o in self
            .objects(r, v::OWL_HAS_VALUE)
            .map(|o| o.into_owned())
            .collect::<Vec<_>>()
        {
            let mut refs = Vec::new();
            if let TermRef::NamedNode(n) = o.as_ref()
                && let Some(id) = self.id_of(n.as_str())
            {
                refs.push(id);
            }
            row.constraints.push(Constraint {
                kind: "hasValue".to_string(),
                text: self.term_label(o.as_ref()),
                refs,
            });
        }
        row.sources.push("restriction".to_string());
        Some(row)
    }

    fn ontology_rows(&mut self, class_id: Id) -> Vec<PropRow> {
        let mut rows = Vec::new();
        let prop_ids: Vec<Id> = self
            .properties
            .iter()
            .filter(|(_, info)| info.domain.contains(&class_id))
            .map(|(&id, _)| id)
            .collect();
        for pid in prop_ids {
            let info = self.properties[&pid].clone();
            let iri = self.iri(pid).to_string();
            let mut row = PropRow {
                property: Some(pid),
                path: self.prefixes.curie(&iri),
                path_ids: vec![pid],
                ..Default::default()
            };
            for r in &info.range {
                if self.kind(*r) == Kind::Datatype {
                    row.datatype.get_or_insert(*r);
                } else {
                    row.range.push(*r);
                }
            }
            row.scheme = info.scheme;
            if info.characteristics.iter().any(|c| c == "functional") {
                row.max = Some(1);
            }
            row.sources.push("ontology".to_string());
            rows.push(row);
        }
        rows
    }

    fn merge_into(target: &mut PropRow, src: PropRow) {
        for r in src.range {
            if !target.range.contains(&r) {
                target.range.push(r);
            }
        }
        if target.datatype.is_none() {
            target.datatype = src.datatype;
        }
        if target.node_kind.is_none() {
            target.node_kind = src.node_kind;
        }
        if target.scheme.is_none() {
            target.scheme = src.scheme;
        }
        for n in src.node {
            if !target.node.contains(&n) {
                target.node.push(n);
            }
        }
        target.min = match (target.min, src.min) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        target.max = match (target.max, src.max) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        if target.name.is_empty() {
            target.name = src.name;
        }
        if target.description.is_empty() {
            target.description = src.description;
        }
        if target.group.is_none() {
            target.group = src.group;
        }
        if target.order.is_none() {
            target.order = src.order;
        }
        if target.role.is_none() {
            target.role = src.role;
        }
        if target.viewer.is_none() {
            target.viewer = src.viewer;
        }
        if target.severity.is_none() {
            target.severity = src.severity;
        }
        target.composite |= src.composite;
        target.hidden |= src.hidden;
        target.read_only |= src.read_only;
        target.deactivated |= src.deactivated;
        for s in src.sources {
            if !target.sources.contains(&s) {
                target.sources.push(s);
            }
        }
        for s in src.shapes {
            if !target.shapes.contains(&s) {
                target.shapes.push(s);
            }
        }
        for c in src.constraints {
            if !target
                .constraints
                .iter()
                .any(|x| x.kind == c.kind && x.text == c.text)
            {
                target.constraints.push(c);
            }
        }
    }

    fn finish_row(&self, row: &mut PropRow) {
        // With a known value set, the generic skos:Concept range adds nothing.
        if row.scheme.is_some()
            && let Some(c) = self.id_of(v::SKOS_CONCEPT)
        {
            row.range.retain(|&r| r != c);
        }
        let prop_kind = row.property.map(|p| self.kind(p));
        row.literal = row.datatype.is_some()
            || row.node_kind.as_deref() == Some("Literal")
            || (row.range.is_empty()
                && row.scheme.is_none()
                && row.node.is_empty()
                && !matches!(
                    row.node_kind.as_deref(),
                    Some("IRI") | Some("BlankNode") | Some("BlankNodeOrIRI")
                )
                && prop_kind == Some(Kind::DatatypeProperty));
        if row.literal && row.datatype.is_none() && row.scheme.is_none() {
            // keep as literal without a known datatype
        }
    }

    fn build_class_rows(&mut self) {
        let class_ids: Vec<Id> = self.classes.keys().copied().collect();
        // Own rows per class.
        let mut own: HashMap<Id, Vec<PropRow>> = HashMap::new();
        for &cid in &class_ids {
            let mut merged: Vec<PropRow> = Vec::new();
            let mut index: HashMap<String, usize> = HashMap::new();
            let add =
                |row: PropRow, merged: &mut Vec<PropRow>, index: &mut HashMap<String, usize>| {
                    if let Some(&i) = index.get(&row.path) {
                        Self::merge_into(&mut merged[i], row);
                    } else {
                        index.insert(row.path.clone(), merged.len());
                        merged.push(row);
                    }
                };
            for row in self.ontology_rows(cid) {
                add(row, &mut merged, &mut index);
            }
            for row in self.restriction_rows(cid) {
                add(row, &mut merged, &mut index);
            }
            let shape_ids = self.classes[&cid].shapes.clone();
            for sid in shape_ids {
                let rows = self.shapes[&sid].properties.clone();
                for row in rows {
                    add(row, &mut merged, &mut index);
                }
            }
            for row in &mut merged {
                self.finish_row(row);
            }
            // Order: explicit sh:order, then group order, then literals before links, then label.
            let group_order = |b: &Self, g: Option<Id>| -> f64 {
                g.and_then(|g| b.groups.get(&g).and_then(|gi| gi.order))
                    .unwrap_or(f64::MAX)
            };
            merged.sort_by(|a, b| {
                group_order(self, a.group)
                    .partial_cmp(&group_order(self, b.group))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| {
                        a.order
                            .unwrap_or(f64::MAX)
                            .partial_cmp(&b.order.unwrap_or(f64::MAX))
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .then_with(|| b.literal.cmp(&a.literal))
                    .then_with(|| a.path.to_lowercase().cmp(&b.path.to_lowercase()))
            });
            own.insert(cid, merged);
        }
        // Inherited rows.
        for &cid in &class_ids {
            let mut rows = own[&cid].clone();
            let own_count = rows.len() as u32;
            let mut seen: HashSet<String> = rows.iter().map(|r| r.path.clone()).collect();
            let ancestors = self.classes[&cid].ancestors.clone();
            for a in ancestors {
                if let Some(arows) = own.get(&a) {
                    for r in arows {
                        if seen.insert(r.path.clone()) {
                            let mut r = r.clone();
                            r.inherited_from = Some(a);
                            rows.push(r);
                        }
                    }
                }
            }
            let ci = self.classes.get_mut(&cid).unwrap();
            ci.props = rows;
            ci.own_props = own_count;
        }
        // Reverse links.
        for &cid in &class_ids {
            let rows = own[&cid].clone();
            for r in rows {
                if let Some(pid) = r.property
                    && let Some(pi) = self.properties.get_mut(&pid)
                    && !pi.used_by_classes.contains(&cid)
                {
                    pi.used_by_classes.push(cid);
                }
                for target in r.range {
                    if target != cid
                        && let Some(ti) = self.classes.get_mut(&target)
                        && !ti.referenced_by.contains(&cid)
                    {
                        ti.referenced_by.push(cid);
                    }
                }
            }
        }
        let prop_ids: Vec<Id> = self.properties.keys().copied().collect();
        for pid in prop_ids {
            let range = self.properties[&pid].range.clone();
            for r in range {
                if let Some(ci) = self.classes.get_mut(&r) {
                    ci.in_range_of.push(pid);
                }
            }
        }
        let shape_ids: Vec<Id> = self.shapes.keys().copied().collect();
        for sid in shape_ids {
            let props: Vec<Id> = self.shapes[&sid]
                .properties
                .iter()
                .filter_map(|r| r.property)
                .collect();
            for pid in props {
                if let Some(pi) = self.properties.get_mut(&pid)
                    && !pi.used_by_shapes.contains(&sid)
                {
                    pi.used_by_shapes.push(sid);
                }
            }
        }
        for &cid in &class_ids {
            let mut ir = std::mem::take(&mut self.classes.get_mut(&cid).unwrap().in_range_of);
            self.sort_ids(&mut ir);
            let mut rb = std::mem::take(&mut self.classes.get_mut(&cid).unwrap().referenced_by);
            self.sort_ids(&mut rb);
            let ci = self.classes.get_mut(&cid).unwrap();
            ci.in_range_of = ir;
            ci.referenced_by = rb;
        }
    }

    // ----- step 7: SKOS -----------------------------------------------------

    fn build_skos(&mut self) {
        let scheme_ids: Vec<Id> = (0..self.entities.len() as Id)
            .filter(|&id| self.kind(id) == Kind::ConceptScheme)
            .collect();
        let concept_ids: Vec<Id> = (0..self.entities.len() as Id)
            .filter(|&id| self.kind(id) == Kind::Concept)
            .collect();
        for &sid in &scheme_ids {
            self.schemes.insert(sid, SchemeInfo::default());
        }
        for &cid in &concept_ids {
            let iri = self.iri(cid).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let mut info = ConceptInfo::default();
            for sc in self.named_objects(s, v::SKOS_IN_SCHEME) {
                if let Some(id) = self.id_of(&sc)
                    && self.schemes.contains_key(&id)
                    && !info.schemes.contains(&id)
                {
                    info.schemes.push(id);
                }
            }
            for sc in self.named_objects(s, v::SKOS_TOP_CONCEPT_OF) {
                if let Some(id) = self.id_of(&sc)
                    && self.schemes.contains_key(&id)
                {
                    if !info.schemes.contains(&id) {
                        info.schemes.push(id);
                    }
                    if !info.top_concept_of.contains(&id) {
                        info.top_concept_of.push(id);
                    }
                }
            }
            for p in [v::SKOS_BROADER, v::SKOS_BROADER_TRANSITIVE] {
                for b in self.named_objects(s, p) {
                    if let Some(id) = self.id_of(&b)
                        && self.kind(id) == Kind::Concept
                        && id != cid
                        && !info.broader.contains(&id)
                    {
                        info.broader.push(id);
                    }
                }
            }
            for p in [v::SKOS_NARROWER, v::SKOS_NARROWER_TRANSITIVE] {
                for b in self.named_objects(s, p) {
                    if let Some(id) = self.id_of(&b)
                        && self.kind(id) == Kind::Concept
                        && id != cid
                        && !info.narrower.contains(&id)
                    {
                        info.narrower.push(id);
                    }
                }
            }
            for b in self.named_objects(s, v::SKOS_RELATED) {
                if let Some(id) = self.id_of(&b)
                    && self.kind(id) == Kind::Concept
                    && !info.related.contains(&id)
                {
                    info.related.push(id);
                }
            }
            info.notation = self
                .objects(s, v::SKOS_NOTATION)
                .filter_map(|o| match o {
                    TermRef::Literal(l) => Some(l.value().to_string()),
                    _ => None,
                })
                .collect();
            for o in self.objects(s, v::SKOS_ALT_LABEL) {
                if let TermRef::Literal(l) = o {
                    info.alt_labels
                        .entry(l.language().unwrap_or("").to_string())
                        .or_default()
                        .push(l.value().to_string());
                }
            }
            for (p, name) in [
                (v::SKOS_EXACT_MATCH, "exactMatch"),
                (v::SKOS_CLOSE_MATCH, "closeMatch"),
                (v::SKOS_BROAD_MATCH, "broadMatch"),
                (v::SKOS_NARROW_MATCH, "narrowMatch"),
                (v::SKOS_RELATED_MATCH, "relatedMatch"),
            ] {
                for m in self.named_objects(s, p) {
                    info.mappings.push((name.to_string(), m));
                }
            }
            self.concepts.insert(cid, info);
        }
        // hasTopConcept from the scheme side.
        for &sid in &scheme_ids {
            let iri = self.iri(sid).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            for c in self.named_objects(s, v::SKOS_HAS_TOP_CONCEPT) {
                if let Some(cid) = self.id_of(&c)
                    && let Some(ci) = self.concepts.get_mut(&cid)
                {
                    if !ci.schemes.contains(&sid) {
                        ci.schemes.push(sid);
                    }
                    if !ci.top_concept_of.contains(&sid) {
                        ci.top_concept_of.push(sid);
                    }
                }
            }
        }
        // Symmetric broader/narrower.
        for &cid in &concept_ids {
            let broader = self.concepts[&cid].broader.clone();
            for b in broader {
                if let Some(bi) = self.concepts.get_mut(&b)
                    && !bi.narrower.contains(&cid)
                {
                    bi.narrower.push(cid);
                }
            }
            let narrower = self.concepts[&cid].narrower.clone();
            for n in narrower {
                if let Some(ni) = self.concepts.get_mut(&n)
                    && !ni.broader.contains(&cid)
                {
                    ni.broader.push(cid);
                }
            }
            let related = self.concepts[&cid].related.clone();
            for r in related {
                if let Some(ri) = self.concepts.get_mut(&r)
                    && !ri.related.contains(&cid)
                {
                    ri.related.push(cid);
                }
            }
        }
        // Concepts without a scheme inherit it from a broader concept.
        for _ in 0..8 {
            let mut changed = false;
            for &cid in &concept_ids {
                if !self.concepts[&cid].schemes.is_empty() {
                    continue;
                }
                let broader = self.concepts[&cid].broader.clone();
                let mut inherited = Vec::new();
                for b in broader {
                    inherited.extend(self.concepts[&b].schemes.iter().copied());
                }
                if !inherited.is_empty() {
                    inherited.sort();
                    inherited.dedup();
                    self.concepts.get_mut(&cid).unwrap().schemes = inherited;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        // Scheme membership and top concepts.
        for &cid in &concept_ids {
            let info = self.concepts[&cid].clone();
            for sid in &info.schemes {
                let si = self.schemes.get_mut(sid).unwrap();
                si.concepts.push(cid);
                let has_broader_in_scheme = info
                    .broader
                    .iter()
                    .any(|b| self.concepts[b].schemes.contains(sid));
                if info.top_concept_of.contains(sid) || !has_broader_in_scheme {
                    si.top_concepts.push(cid);
                }
            }
        }
        for &sid in &scheme_ids {
            let mut c = std::mem::take(&mut self.schemes.get_mut(&sid).unwrap().concepts);
            self.sort_ids(&mut c);
            let mut t = std::mem::take(&mut self.schemes.get_mut(&sid).unwrap().top_concepts);
            self.sort_ids(&mut t);
            let si = self.schemes.get_mut(&sid).unwrap();
            si.concepts = c;
            si.top_concepts = t;
        }
        for &cid in &concept_ids {
            let mut n = std::mem::take(&mut self.concepts.get_mut(&cid).unwrap().narrower);
            self.sort_ids(&mut n);
            self.concepts.get_mut(&cid).unwrap().narrower = n;
        }
        // Properties using a scheme.
        let prop_ids: Vec<Id> = self.properties.keys().copied().collect();
        for pid in prop_ids {
            if let Some(sid) = self.properties[&pid].scheme
                && let Some(si) = self.schemes.get_mut(&sid)
            {
                si.used_by.push(pid);
            }
        }
        // Rows pointing at schemes without a property annotation.
        let class_ids: Vec<Id> = self.classes.keys().copied().collect();
        for cid in class_ids {
            let pairs: Vec<(Id, Option<Id>)> = self.classes[&cid]
                .props
                .iter()
                .filter_map(|r| r.scheme.map(|s| (s, r.property)))
                .collect();
            for (sid, pid) in pairs {
                if let (Some(pid), Some(si)) = (pid, self.schemes.get_mut(&sid))
                    && !si.used_by.contains(&pid)
                {
                    si.used_by.push(pid);
                }
            }
        }
        for &sid in &scheme_ids {
            let mut u = std::mem::take(&mut self.schemes.get_mut(&sid).unwrap().used_by);
            self.sort_ids(&mut u);
            self.schemes.get_mut(&sid).unwrap().used_by = u;
        }
        // Collections.
        let coll_ids: Vec<Id> = (0..self.entities.len() as Id)
            .filter(|&id| self.kind(id) == Kind::Collection)
            .collect();
        for cid in coll_ids {
            let iri = self.iri(cid).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let mut members: Vec<Id> = self
                .named_objects(s, v::SKOS_MEMBER)
                .iter()
                .filter_map(|m| self.id_of(m))
                .collect();
            let mut ordered = false;
            if let Some(l) = self.object(s, v::SKOS_MEMBER_LIST) {
                ordered = true;
                for m in self.list(l) {
                    if let TermRef::NamedNode(n) = m.as_ref()
                        && let Some(id) = self.id_of(n.as_str())
                    {
                        members.push(id);
                    }
                }
            }
            for &m in &members {
                if let Some(ci) = self.concepts.get_mut(&m) {
                    ci.collections.push(cid);
                }
            }
            self.collections
                .insert(cid, CollectionInfo { members, ordered });
        }
    }

    // ----- step 8: individuals and ontologies ---------------------------------

    fn build_individuals(&mut self, max_per_class: usize) {
        let ids: Vec<Id> = (0..self.entities.len() as Id)
            .filter(|&id| self.kind(id) == Kind::Individual)
            .collect();
        for id in ids {
            let iri = self.iri(id).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let types: Vec<Id> = self
                .named_objects(s, v::RDF_TYPE)
                .iter()
                .filter(|t| t.as_str() != v::OWL_NAMED_INDIVIDUAL)
                .filter_map(|t| self.id_of(t))
                .filter(|&t| self.classes.contains_key(&t))
                .collect();
            for &t in &types {
                let ci = self.classes.get_mut(&t).unwrap();
                if ci.instances.len() < max_per_class {
                    ci.instances.push(id);
                }
            }
            self.individuals.insert(id, IndividualInfo { types });
        }
        let onts: Vec<Id> = (0..self.entities.len() as Id)
            .filter(|&id| self.kind(id) == Kind::Ontology)
            .collect();
        for id in onts {
            let iri = self.iri(id).to_string();
            let s = NamedOrBlankNodeRef::NamedNode(nn(&iri));
            let info = OntologyInfo {
                imports: self.named_objects(s, v::OWL_IMPORTS),
                version: self.literal_string(s, v::OWL_VERSION_INFO),
                version_iri: self.named_objects(s, v::OWL_VERSION_IRI).into_iter().next(),
            };
            self.ontologies.insert(id, info);
        }
    }

    fn finish(mut self, opts: &Options) -> Bundle {
        // Datatype entities get their local name as label when nothing else.
        for e in &mut self.entities {
            if e.kind == Kind::Datatype && e.label.is_empty() {
                e.label
                    .insert("".to_string(), local_name(&e.iri).to_string());
            }
        }
        // Languages by frequency.
        let mut lang_count: HashMap<String, usize> = HashMap::new();
        for e in &self.entities {
            for l in e.label.keys() {
                *lang_count.entry(l.clone()).or_default() += 1;
            }
        }
        let mut languages: Vec<(String, usize)> = lang_count.into_iter().collect();
        languages.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let languages: Vec<String> = languages.into_iter().map(|(l, _)| l).collect();

        let mut root_classes: Vec<Id> = self
            .classes
            .iter()
            .filter(|(_, ci)| ci.super_classes.is_empty())
            .map(|(&id, _)| id)
            .collect();
        self.sort_ids(&mut root_classes);
        let suggested = self
            .classes
            .iter()
            .max_by_key(|(id, ci)| {
                (
                    ci.own_props as usize + ci.sub_classes.len() * 2 + ci.referenced_by.len() * 2,
                    std::cmp::Reverse(**id),
                )
            })
            .map(|(&id, _)| id);
        let title = opts.title.clone().or_else(|| {
            self.ontologies.keys().next().map(|&id| {
                let e = &self.entities[id as usize];
                e.label
                    .get("en")
                    .or_else(|| e.label.values().next())
                    .cloned()
                    .unwrap_or_else(|| e.iri.clone())
            })
        });
        let rdf: BTreeMap<Id, String> = if opts.rdf {
            self.entities
                .iter()
                .filter_map(|e| {
                    crate::turtle::describe(self.g, &self.prefixes, nn(&e.iri)).map(|t| (e.id, t))
                })
                .collect()
        } else {
            BTreeMap::new()
        };
        let count = |k: Kind| self.entities.iter().filter(|e| e.kind == k).count();
        let property_shapes = self
            .shapes
            .values()
            .map(|s| s.properties.len())
            .sum::<usize>();
        let stats = Stats {
            triples: self.g.len(),
            classes: count(Kind::Class),
            object_properties: count(Kind::ObjectProperty),
            datatype_properties: count(Kind::DatatypeProperty),
            annotation_properties: count(Kind::AnnotationProperty),
            other_properties: count(Kind::Property),
            concept_schemes: count(Kind::ConceptScheme),
            concepts: count(Kind::Concept),
            node_shapes: self.shapes.len(),
            property_shapes,
            individuals: count(Kind::Individual),
            datatypes: count(Kind::Datatype),
            uses_dash: self.uses_dash,
            uses_shacl: !self.shapes.is_empty(),
            uses_skos: !self.concepts.is_empty(),
        };
        Bundle {
            format: FORMAT,
            generator: opts.generator.clone(),
            title,
            sources: self
                .loaded
                .sources
                .iter()
                .map(|(name, triples)| SourceInfo {
                    name: name.clone(),
                    triples: *triples,
                })
                .collect(),
            prefixes: self.prefixes.map.clone(),
            languages,
            stats,
            entities: self.entities,
            classes: self.classes,
            properties: self.properties,
            schemes: self.schemes,
            concepts: self.concepts,
            collections: self.collections,
            shapes: self.shapes,
            groups: self.groups,
            individuals: self.individuals,
            ontologies: self.ontologies,
            root_classes,
            rdf,
            suggested,
        }
    }
}

fn is_datatype_iri(iri: &str) -> bool {
    iri.starts_with(v::XSD)
        || iri == v::RDF_LANG_STRING
        || iri == v::RDFS_LITERAL
        || iri == "http://www.w3.org/1999/02/22-rdf-syntax-ns#HTML"
        || iri == "http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral"
        || iri == "http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON"
        || iri == "http://www.opengis.net/ont/geosparql#wktLiteral"
        || iri == "http://www.opengis.net/ont/geosparql#gmlLiteral"
}

/// A literal as people read it: the value, plus the language or a
/// non-string datatype.
fn literal_text(l: LiteralRef<'_>, prefixes: &Prefixes) -> String {
    if let Some(lang) = l.language() {
        return format!("{}@{}", l.value(), lang);
    }
    let dt = l.datatype().as_str();
    if dt == concat!("http://www.w3.org/2001/XMLSchema#", "string") {
        return l.value().to_string();
    }
    match dt {
        "http://www.w3.org/2001/XMLSchema#integer"
        | "http://www.w3.org/2001/XMLSchema#decimal"
        | "http://www.w3.org/2001/XMLSchema#boolean"
        | "http://www.w3.org/2001/XMLSchema#date"
        | "http://www.w3.org/2001/XMLSchema#dateTime"
        | "http://www.w3.org/2001/XMLSchema#anyURI" => l.value().to_string(),
        _ => format!("{}^^{}", l.value(), prefixes.curie(dt)),
    }
}

/// Sort keys that put "750" before "1000": digit runs are zero-padded.
trait NaturalKey {
    fn pipe_natural(self) -> String;
}

impl NaturalKey for String {
    fn pipe_natural(self) -> String {
        let mut out = String::with_capacity(self.len() + 8);
        let mut digits = String::new();
        let flush = |digits: &mut String, out: &mut String| {
            if !digits.is_empty() {
                let trimmed = digits.trim_start_matches('0');
                for _ in trimmed.len()..12 {
                    out.push('0');
                }
                out.push_str(trimmed);
                digits.clear();
            }
        };
        for c in self.chars() {
            if c.is_ascii_digit() {
                digits.push(c);
            } else {
                flush(&mut digits, &mut out);
                out.push(c);
            }
        }
        flush(&mut digits, &mut out);
        out
    }
}
