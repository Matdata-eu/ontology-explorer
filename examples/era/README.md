# ERA vocabulary

The reference large example: the ontology, SKOS concept schemes and SHACL shapes
of the [European Union Agency for Railways](https://www.era.europa.eu/), from
<https://gitlab.com/era-europa-eu/public/interoperable-data-programme/era-ontology/era-ontology>.

The files are not stored here. Fetch them with:

```sh
scripts/fetch-era.sh
ontology-explorer serve examples/era/ontology.ttl examples/era/era-shacl/*.ttl examples/era/era-skos/*.ttl
```

The ERA ontology and shapes are published under the
[EUPL 1.2](https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12),
the concept schemes under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
