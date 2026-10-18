//! The bundle: everything the viewer needs, pre-computed and indexed by
//! small integer ids so the browser does lookups instead of graph queries.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Bundle format version. Bump when the viewer must change to read it.
pub const FORMAT: u32 = 1;

pub type Id = u32;
pub type LangMap = BTreeMap<String, String>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Ontology,
    Class,
    ObjectProperty,
    DatatypeProperty,
    AnnotationProperty,
    /// `rdf:Property` or a predicate used without a declared type.
    Property,
    Datatype,
    Concept,
    ConceptScheme,
    Collection,
    NodeShape,
    PropertyShape,
    PropertyGroup,
    Individual,
}

impl Kind {
    pub fn is_property(self) -> bool {
        matches!(
            self,
            Kind::ObjectProperty
                | Kind::DatatypeProperty
                | Kind::AnnotationProperty
                | Kind::Property
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub id: Id,
    pub iri: String,
    /// `prefix:local` when a prefix is known, else the IRI.
    pub curie: String,
    pub kind: Kind,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub label: LangMap,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub comment: LangMap,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deprecated: bool,
    /// `vs:term_status` or similar, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Indexes into `Bundle::sources`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<u16>,
    /// Remaining annotations for the detail page: (predicate id, value).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub annotations: Vec<Annotation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    /// Predicate entity id.
    pub p: Id,
    /// Literal text or the IRI.
    pub v: String,
    /// Entity id when the value is a known resource.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}

/// One row of "what can an instance of this class have".
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PropRow {
    /// The predicate, when the path is a single forward IRI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub property: Option<Id>,
    /// Readable path (`ex:a / ^ex:b`), always set.
    pub path: String,
    /// Every IRI used in the path, for linking.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub path_ids: Vec<Id>,
    /// The path is a single inverse step (`^ex:p`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub inverse: bool,
    /// `sh:name` from the shape, when given.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub name: LangMap,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub description: LangMap,
    /// Classes the values belong to (from range, restrictions, sh:class, sh:node targets).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub range: Vec<Id>,
    /// Datatype of literal values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub datatype: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_kind: Option<String>,
    /// Concept scheme the values come from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheme: Option<Id>,
    /// Shape the values must conform to (sh:node).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub node: Vec<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<f64>,
    /// `dash:propertyRole` local name: Label, Description, ID, Icon, KeyInfo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub composite: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub read_only: bool,
    /// `dash:viewer` / `dash:editor` local names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer: Option<String>,
    /// Where the row comes from: "ontology", "restriction", "shape"; several when merged.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<String>,
    /// Shapes that contributed to the row.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shapes: Vec<Id>,
    /// Class this row is inherited from (absent for the class's own rows).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inherited_from: Option<Id>,
    /// Other constraints, in plain words.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constraints: Vec<Constraint>,
    /// Literal-valued (datatype) rather than resource-valued; decides the
    /// compartment in the diagram.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub literal: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deactivated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Constraint {
    /// Local name of the constraint component parameter: `pattern`, `in`, `sparql`...
    pub kind: String,
    /// Readable value.
    pub text: String,
    /// Entities the value refers to.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refs: Vec<Id>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClassInfo {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub super_classes: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sub_classes: Vec<Id>,
    /// Every ancestor, nearest first (transitive, cycle-safe).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ancestors: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub equivalent: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disjoint: Vec<Id>,
    /// Members when the class is defined as `owl:unionOf`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub union_of: Vec<Id>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub r#abstract: bool,
    /// Node shapes that apply to instances of this class.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shapes: Vec<Id>,
    /// Own rows first, then inherited rows (with `inherited_from`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub props: Vec<PropRow>,
    /// Properties whose range is this class (incoming associations).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub in_range_of: Vec<Id>,
    /// Classes whose rows point at this class, from any source (incoming associations).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub referenced_by: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub instances: Vec<Id>,
    /// Number of own (not inherited) rows.
    #[serde(default)]
    pub own_props: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PropertyInfo {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub domain: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub range: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub super_properties: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sub_properties: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inverse_of: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub equivalent: Vec<Id>,
    /// OWL characteristics: functional, inverseFunctional, symmetric, transitive.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub characteristics: Vec<String>,
    /// Concept scheme the values come from, when an annotation says so.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheme: Option<Id>,
    /// Classes that have a row for this property (domain, restriction or shape).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub used_by_classes: Vec<Id>,
    /// Node shapes with a property shape on this path.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub used_by_shapes: Vec<Id>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SchemeInfo {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub top_concepts: Vec<Id>,
    /// Every concept in the scheme, sorted by label.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub concepts: Vec<Id>,
    /// Properties whose values come from this scheme.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub used_by: Vec<Id>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConceptInfo {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub schemes: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub broader: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub narrower: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub top_concept_of: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notation: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub alt_labels: BTreeMap<String, Vec<String>>,
    /// (match kind local name, target IRI)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mappings: Vec<(String, String)>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collections: Vec<Id>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInfo {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<Id>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ordered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShapeInfo {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_class: Vec<Id>,
    /// Shape IRI is itself a class (implicit class target).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub implicit_target: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_node: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_subjects_of: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_objects_of: Vec<Id>,
    /// Classes named by `dash:applicableToClass` or a class → shape annotation.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub applicable_to: Vec<Id>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub closed: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deactivated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<PropRow>,
    /// Node-level constraints (sh:class, sh:or, sh:sparql ...).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub constraints: Vec<Constraint>,
    /// Shapes this one is referenced from via sh:node / sh:and ... (for navigation).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub used_by: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GroupInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IndividualInfo {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub types: Vec<Id>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OntologyInfo {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub imports: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_iri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub name: String,
    pub triples: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub triples: usize,
    pub classes: usize,
    pub object_properties: usize,
    pub datatype_properties: usize,
    pub annotation_properties: usize,
    pub other_properties: usize,
    pub concept_schemes: usize,
    pub concepts: usize,
    pub node_shapes: usize,
    pub property_shapes: usize,
    pub individuals: usize,
    pub datatypes: usize,
    pub uses_dash: bool,
    pub uses_shacl: bool,
    pub uses_skos: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub format: u32,
    pub generator: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub sources: Vec<SourceInfo>,
    pub prefixes: BTreeMap<String, String>,
    pub languages: Vec<String>,
    pub stats: Stats,
    /// Entity ids are indexes into this vector.
    pub entities: Vec<Entity>,
    pub classes: BTreeMap<Id, ClassInfo>,
    pub properties: BTreeMap<Id, PropertyInfo>,
    pub schemes: BTreeMap<Id, SchemeInfo>,
    pub concepts: BTreeMap<Id, ConceptInfo>,
    pub collections: BTreeMap<Id, CollectionInfo>,
    pub shapes: BTreeMap<Id, ShapeInfo>,
    pub groups: BTreeMap<Id, GroupInfo>,
    pub individuals: BTreeMap<Id, IndividualInfo>,
    pub ontologies: BTreeMap<Id, OntologyInfo>,
    /// Ids of the classes with no super class inside the bundle, sorted by label.
    pub root_classes: Vec<Id>,
    /// The triples about each entity as Turtle, when the bundle keeps them.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub rdf: BTreeMap<Id, String>,
    /// Suggested entry point: the class with the most connections.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested: Option<Id>,
}
