//! IRIs of the vocabularies the explorer understands.

#![allow(dead_code)]

pub const RDF: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
pub const RDFS: &str = "http://www.w3.org/2000/01/rdf-schema#";
pub const OWL: &str = "http://www.w3.org/2002/07/owl#";
pub const XSD: &str = "http://www.w3.org/2001/XMLSchema#";
pub const XSD_STRING: &str = "http://www.w3.org/2001/XMLSchema#string";
pub const SKOS: &str = "http://www.w3.org/2004/02/skos/core#";
pub const SH: &str = "http://www.w3.org/ns/shacl#";
pub const DASH: &str = "http://datashapes.org/dash#";
pub const DCTERMS: &str = "http://purl.org/dc/terms/";
pub const DC: &str = "http://purl.org/dc/elements/1.1/";
pub const SCHEMA: &str = "https://schema.org/";
pub const SCHEMA_HTTP: &str = "http://schema.org/";
pub const FOAF: &str = "http://xmlns.com/foaf/0.1/";
pub const VANN: &str = "http://purl.org/vocab/vann/";
pub const VS: &str = "http://www.w3.org/2003/06/sw-vocab-status/ns#";

macro_rules! iri {
    ($name:ident, $ns:ident, $local:literal) => {
        pub const $name: &str = concat_ns!($ns, $local);
    };
}
macro_rules! concat_ns {
    (RDF, $l:literal) => {
        concat!("http://www.w3.org/1999/02/22-rdf-syntax-ns#", $l)
    };
    (RDFS, $l:literal) => {
        concat!("http://www.w3.org/2000/01/rdf-schema#", $l)
    };
    (OWL, $l:literal) => {
        concat!("http://www.w3.org/2002/07/owl#", $l)
    };
    (SKOS, $l:literal) => {
        concat!("http://www.w3.org/2004/02/skos/core#", $l)
    };
    (SH, $l:literal) => {
        concat!("http://www.w3.org/ns/shacl#", $l)
    };
    (DASH, $l:literal) => {
        concat!("http://datashapes.org/dash#", $l)
    };
    (DCTERMS, $l:literal) => {
        concat!("http://purl.org/dc/terms/", $l)
    };
    (VS, $l:literal) => {
        concat!("http://www.w3.org/2003/06/sw-vocab-status/ns#", $l)
    };
}

iri!(RDF_TYPE, RDF, "type");
iri!(RDF_PROPERTY, RDF, "Property");
iri!(RDF_FIRST, RDF, "first");
iri!(RDF_REST, RDF, "rest");
iri!(RDF_NIL, RDF, "nil");
iri!(RDF_LANG_STRING, RDF, "langString");

iri!(RDFS_CLASS, RDFS, "Class");
iri!(RDFS_DATATYPE, RDFS, "Datatype");
iri!(RDFS_LABEL, RDFS, "label");
iri!(RDFS_COMMENT, RDFS, "comment");
iri!(RDFS_SUBCLASSOF, RDFS, "subClassOf");
iri!(RDFS_SUBPROPERTYOF, RDFS, "subPropertyOf");
iri!(RDFS_DOMAIN, RDFS, "domain");
iri!(RDFS_RANGE, RDFS, "range");
iri!(RDFS_SEEALSO, RDFS, "seeAlso");
iri!(RDFS_ISDEFINEDBY, RDFS, "isDefinedBy");
iri!(RDFS_LITERAL, RDFS, "Literal");
iri!(RDFS_RESOURCE, RDFS, "Resource");

iri!(OWL_CLASS, OWL, "Class");
iri!(OWL_THING, OWL, "Thing");
iri!(OWL_NOTHING, OWL, "Nothing");
iri!(OWL_ONTOLOGY, OWL, "Ontology");
iri!(OWL_OBJECT_PROPERTY, OWL, "ObjectProperty");
iri!(OWL_DATATYPE_PROPERTY, OWL, "DatatypeProperty");
iri!(OWL_ANNOTATION_PROPERTY, OWL, "AnnotationProperty");
iri!(OWL_FUNCTIONAL, OWL, "FunctionalProperty");
iri!(OWL_INVERSE_FUNCTIONAL, OWL, "InverseFunctionalProperty");
iri!(OWL_SYMMETRIC, OWL, "SymmetricProperty");
iri!(OWL_TRANSITIVE, OWL, "TransitiveProperty");
iri!(OWL_NAMED_INDIVIDUAL, OWL, "NamedIndividual");
iri!(OWL_RESTRICTION, OWL, "Restriction");
iri!(OWL_ON_PROPERTY, OWL, "onProperty");
iri!(OWL_ON_CLASS, OWL, "onClass");
iri!(OWL_ON_DATARANGE, OWL, "onDataRange");
iri!(OWL_SOME_VALUES_FROM, OWL, "someValuesFrom");
iri!(OWL_ALL_VALUES_FROM, OWL, "allValuesFrom");
iri!(OWL_HAS_VALUE, OWL, "hasValue");
iri!(OWL_CARDINALITY, OWL, "cardinality");
iri!(OWL_MIN_CARDINALITY, OWL, "minCardinality");
iri!(OWL_MAX_CARDINALITY, OWL, "maxCardinality");
iri!(OWL_QUALIFIED_CARDINALITY, OWL, "qualifiedCardinality");
iri!(
    OWL_MIN_QUALIFIED_CARDINALITY,
    OWL,
    "minQualifiedCardinality"
);
iri!(
    OWL_MAX_QUALIFIED_CARDINALITY,
    OWL,
    "maxQualifiedCardinality"
);
iri!(OWL_UNION_OF, OWL, "unionOf");
iri!(OWL_INTERSECTION_OF, OWL, "intersectionOf");
iri!(OWL_ONE_OF, OWL, "oneOf");
iri!(OWL_COMPLEMENT_OF, OWL, "complementOf");
iri!(OWL_EQUIVALENT_CLASS, OWL, "equivalentClass");
iri!(OWL_EQUIVALENT_PROPERTY, OWL, "equivalentProperty");
iri!(OWL_DISJOINT_WITH, OWL, "disjointWith");
iri!(OWL_INVERSE_OF, OWL, "inverseOf");
iri!(OWL_DEPRECATED, OWL, "deprecated");
iri!(OWL_DEPRECATED_CLASS, OWL, "DeprecatedClass");
iri!(OWL_DEPRECATED_PROPERTY, OWL, "DeprecatedProperty");
iri!(OWL_IMPORTS, OWL, "imports");
iri!(OWL_VERSION_INFO, OWL, "versionInfo");
iri!(OWL_VERSION_IRI, OWL, "versionIRI");

iri!(SKOS_CONCEPT, SKOS, "Concept");
iri!(SKOS_CONCEPT_SCHEME, SKOS, "ConceptScheme");
iri!(SKOS_COLLECTION, SKOS, "Collection");
iri!(SKOS_ORDERED_COLLECTION, SKOS, "OrderedCollection");
iri!(SKOS_PREF_LABEL, SKOS, "prefLabel");
iri!(SKOS_ALT_LABEL, SKOS, "altLabel");
iri!(SKOS_HIDDEN_LABEL, SKOS, "hiddenLabel");
iri!(SKOS_DEFINITION, SKOS, "definition");
iri!(SKOS_SCOPE_NOTE, SKOS, "scopeNote");
iri!(SKOS_NOTE, SKOS, "note");
iri!(SKOS_EXAMPLE, SKOS, "example");
iri!(SKOS_NOTATION, SKOS, "notation");
iri!(SKOS_IN_SCHEME, SKOS, "inScheme");
iri!(SKOS_TOP_CONCEPT_OF, SKOS, "topConceptOf");
iri!(SKOS_HAS_TOP_CONCEPT, SKOS, "hasTopConcept");
iri!(SKOS_BROADER, SKOS, "broader");
iri!(SKOS_NARROWER, SKOS, "narrower");
iri!(SKOS_BROADER_TRANSITIVE, SKOS, "broaderTransitive");
iri!(SKOS_NARROWER_TRANSITIVE, SKOS, "narrowerTransitive");
iri!(SKOS_RELATED, SKOS, "related");
iri!(SKOS_MEMBER, SKOS, "member");
iri!(SKOS_MEMBER_LIST, SKOS, "memberList");
iri!(SKOS_EXACT_MATCH, SKOS, "exactMatch");
iri!(SKOS_CLOSE_MATCH, SKOS, "closeMatch");
iri!(SKOS_BROAD_MATCH, SKOS, "broadMatch");
iri!(SKOS_NARROW_MATCH, SKOS, "narrowMatch");
iri!(SKOS_RELATED_MATCH, SKOS, "relatedMatch");

iri!(SH_NODE_SHAPE, SH, "NodeShape");
iri!(SH_PROPERTY_SHAPE, SH, "PropertyShape");
iri!(SH_PROPERTY_GROUP, SH, "PropertyGroup");
iri!(SH_PROPERTY, SH, "property");
iri!(SH_PATH, SH, "path");
iri!(SH_NAME, SH, "name");
iri!(SH_DESCRIPTION, SH, "description");
iri!(SH_GROUP, SH, "group");
iri!(SH_ORDER, SH, "order");
iri!(SH_TARGET_CLASS, SH, "targetClass");
iri!(SH_TARGET_NODE, SH, "targetNode");
iri!(SH_TARGET_SUBJECTS_OF, SH, "targetSubjectsOf");
iri!(SH_TARGET_OBJECTS_OF, SH, "targetObjectsOf");
iri!(SH_TARGET, SH, "target");
iri!(SH_CLASS, SH, "class");
iri!(SH_DATATYPE, SH, "datatype");
iri!(SH_NODE_KIND, SH, "nodeKind");
iri!(SH_NODE, SH, "node");
iri!(SH_MIN_COUNT, SH, "minCount");
iri!(SH_MAX_COUNT, SH, "maxCount");
iri!(SH_IN, SH, "in");
iri!(SH_HAS_VALUE, SH, "hasValue");
iri!(SH_PATTERN, SH, "pattern");
iri!(SH_FLAGS, SH, "flags");
iri!(SH_MIN_LENGTH, SH, "minLength");
iri!(SH_MAX_LENGTH, SH, "maxLength");
iri!(SH_LANGUAGE_IN, SH, "languageIn");
iri!(SH_UNIQUE_LANG, SH, "uniqueLang");
iri!(SH_MIN_INCLUSIVE, SH, "minInclusive");
iri!(SH_MAX_INCLUSIVE, SH, "maxInclusive");
iri!(SH_MIN_EXCLUSIVE, SH, "minExclusive");
iri!(SH_MAX_EXCLUSIVE, SH, "maxExclusive");
iri!(SH_EQUALS, SH, "equals");
iri!(SH_DISJOINT, SH, "disjoint");
iri!(SH_LESS_THAN, SH, "lessThan");
iri!(SH_LESS_THAN_OR_EQUALS, SH, "lessThanOrEquals");
iri!(SH_AND, SH, "and");
iri!(SH_OR, SH, "or");
iri!(SH_XONE, SH, "xone");
iri!(SH_NOT, SH, "not");
iri!(SH_QUALIFIED_VALUE_SHAPE, SH, "qualifiedValueShape");
iri!(SH_QUALIFIED_MIN_COUNT, SH, "qualifiedMinCount");
iri!(SH_QUALIFIED_MAX_COUNT, SH, "qualifiedMaxCount");
iri!(SH_CLOSED, SH, "closed");
iri!(SH_IGNORED_PROPERTIES, SH, "ignoredProperties");
iri!(SH_SEVERITY, SH, "severity");
iri!(SH_MESSAGE, SH, "message");
iri!(SH_DEACTIVATED, SH, "deactivated");
iri!(SH_SPARQL, SH, "sparql");
iri!(SH_SELECT, SH, "select");
iri!(SH_INVERSE_PATH, SH, "inversePath");
iri!(SH_ALTERNATIVE_PATH, SH, "alternativePath");
iri!(SH_ZERO_OR_MORE_PATH, SH, "zeroOrMorePath");
iri!(SH_ONE_OR_MORE_PATH, SH, "oneOrMorePath");
iri!(SH_ZERO_OR_ONE_PATH, SH, "zeroOrOnePath");
iri!(SH_IRI, SH, "IRI");
iri!(SH_BLANK_NODE, SH, "BlankNode");
iri!(SH_LITERAL, SH, "Literal");
iri!(SH_VIOLATION, SH, "Violation");
iri!(SH_WARNING, SH, "Warning");
iri!(SH_INFO, SH, "Info");
iri!(SH_DEFAULT_VALUE, SH, "defaultValue");
iri!(SH_PREFIX, SH, "prefix");
iri!(SH_NAMESPACE, SH, "namespace");

iri!(DASH_ABSTRACT, DASH, "abstract");
iri!(DASH_COMPOSITE, DASH, "composite");
iri!(DASH_HIDDEN, DASH, "hidden");
iri!(DASH_READ_ONLY, DASH, "readOnly");
iri!(DASH_PROPERTY_ROLE, DASH, "propertyRole");
iri!(DASH_APPLICABLE_TO_CLASS, DASH, "applicableToClass");
iri!(DASH_SHAPE_CLASS, DASH, "ShapeClass");
iri!(DASH_VIEWER, DASH, "viewer");
iri!(DASH_EDITOR, DASH, "editor");
iri!(DASH_NEVER_MATERIALIZE, DASH, "neverMaterialize");
iri!(DASH_SINGLE_LINE, DASH, "singleLine");
iri!(DASH_LABEL_ROLE, DASH, "LabelRole");
iri!(DASH_DESCRIPTION_ROLE, DASH, "DescriptionRole");
iri!(DASH_ID_ROLE, DASH, "IDRole");
iri!(DASH_ICON_ROLE, DASH, "IconRole");
iri!(DASH_KEY_INFO_ROLE, DASH, "KeyInfoRole");

iri!(DCTERMS_TITLE, DCTERMS, "title");
iri!(DCTERMS_DESCRIPTION, DCTERMS, "description");
iri!(DCTERMS_CREATED, DCTERMS, "created");
iri!(DCTERMS_MODIFIED, DCTERMS, "modified");
iri!(VS_TERM_STATUS, VS, "term_status");

pub const SCHEMA_DOMAIN_INCLUDES: &str = "https://schema.org/domainIncludes";
pub const SCHEMA_RANGE_INCLUDES: &str = "https://schema.org/rangeIncludes";
pub const SCHEMA_DOMAIN_INCLUDES_HTTP: &str = "http://schema.org/domainIncludes";
pub const SCHEMA_RANGE_INCLUDES_HTTP: &str = "http://schema.org/rangeIncludes";
pub const SCHEMA_SUPERSEDED_BY: &str = "https://schema.org/supersededBy";
pub const FOAF_NAME: &str = "http://xmlns.com/foaf/0.1/name";
pub const DC_TITLE: &str = "http://purl.org/dc/elements/1.1/title";
pub const DC_DESCRIPTION: &str = "http://purl.org/dc/elements/1.1/description";

/// Predicates whose literal values serve as the human name of a resource,
/// in order of preference.
pub const LABEL_PREDICATES: &[&str] = &[
    SKOS_PREF_LABEL,
    RDFS_LABEL,
    SH_NAME,
    DCTERMS_TITLE,
    DC_TITLE,
    FOAF_NAME,
    "https://schema.org/name",
    "http://schema.org/name",
];

/// Predicates whose literal values describe a resource, in order of preference.
pub const COMMENT_PREDICATES: &[&str] = &[
    SKOS_DEFINITION,
    RDFS_COMMENT,
    SH_DESCRIPTION,
    DCTERMS_DESCRIPTION,
    DC_DESCRIPTION,
    SKOS_SCOPE_NOTE,
    "https://schema.org/description",
    "http://schema.org/description",
];

/// Predicates that are handled structurally and therefore left out of the
/// "other annotations" list of an entity.
pub const STRUCTURAL_PREDICATES: &[&str] = &[
    RDF_TYPE,
    RDFS_SUBCLASSOF,
    RDFS_SUBPROPERTYOF,
    RDFS_DOMAIN,
    RDFS_RANGE,
    OWL_EQUIVALENT_CLASS,
    OWL_EQUIVALENT_PROPERTY,
    OWL_DISJOINT_WITH,
    OWL_INVERSE_OF,
    OWL_UNION_OF,
    OWL_INTERSECTION_OF,
    OWL_ONE_OF,
    OWL_COMPLEMENT_OF,
    OWL_ON_PROPERTY,
    OWL_DEPRECATED,
    SKOS_IN_SCHEME,
    SKOS_TOP_CONCEPT_OF,
    SKOS_HAS_TOP_CONCEPT,
    SKOS_BROADER,
    SKOS_NARROWER,
    SKOS_BROADER_TRANSITIVE,
    SKOS_NARROWER_TRANSITIVE,
    SKOS_RELATED,
    SKOS_MEMBER,
    SKOS_MEMBER_LIST,
    SKOS_EXACT_MATCH,
    SKOS_CLOSE_MATCH,
    SKOS_BROAD_MATCH,
    SKOS_NARROW_MATCH,
    SKOS_RELATED_MATCH,
    SKOS_NOTATION,
    SKOS_ALT_LABEL,
    SKOS_HIDDEN_LABEL,
    SH_PROPERTY,
    SH_PATH,
    SH_TARGET_CLASS,
    SH_TARGET_NODE,
    SH_TARGET_SUBJECTS_OF,
    SH_TARGET_OBJECTS_OF,
    SH_TARGET,
    SH_CLASS,
    SH_DATATYPE,
    SH_NODE_KIND,
    SH_NODE,
    SH_MIN_COUNT,
    SH_MAX_COUNT,
    SH_IN,
    SH_HAS_VALUE,
    SH_PATTERN,
    SH_FLAGS,
    SH_MIN_LENGTH,
    SH_MAX_LENGTH,
    SH_LANGUAGE_IN,
    SH_UNIQUE_LANG,
    SH_MIN_INCLUSIVE,
    SH_MAX_INCLUSIVE,
    SH_MIN_EXCLUSIVE,
    SH_MAX_EXCLUSIVE,
    SH_EQUALS,
    SH_DISJOINT,
    SH_LESS_THAN,
    SH_LESS_THAN_OR_EQUALS,
    SH_AND,
    SH_OR,
    SH_XONE,
    SH_NOT,
    SH_QUALIFIED_VALUE_SHAPE,
    SH_QUALIFIED_MIN_COUNT,
    SH_QUALIFIED_MAX_COUNT,
    SH_CLOSED,
    SH_IGNORED_PROPERTIES,
    SH_SEVERITY,
    SH_MESSAGE,
    SH_DEACTIVATED,
    SH_SPARQL,
    SH_GROUP,
    SH_ORDER,
    SH_DEFAULT_VALUE,
    DASH_ABSTRACT,
    DASH_COMPOSITE,
    DASH_HIDDEN,
    DASH_READ_ONLY,
    DASH_PROPERTY_ROLE,
    DASH_APPLICABLE_TO_CLASS,
    DASH_VIEWER,
    DASH_EDITOR,
];
