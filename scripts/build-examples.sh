#!/usr/bin/env bash
# Build the example bundles listed in examples/catalog.json into OUT/examples/
# and write OUT/examples.json for the open page. An example whose files cannot
# be fetched or read is left out with a warning, so one site being down does
# not stop the others.
#
#   scripts/build-examples.sh path/to/ontology-explorer web/dist
set -uo pipefail
OE=${1:?usage: build-examples.sh <ontology-explorer binary> <output dir>}
OUT=${2:?usage: build-examples.sh <ontology-explorer binary> <output dir>}
CATALOG=${CATALOG:-examples/catalog.json}
mkdir -p "$OUT/examples"
built='[]'
count=$(jq length "$CATALOG")
for ((i = 0; i < count; i++)); do
  entry=$(jq -c ".[$i]" "$CATALOG")
  id=$(jq -r .id <<<"$entry")
  title=$(jq -r .title <<<"$entry")
  # Local patterns are expanded by the shell; URLs pass through as they are.
  sources=()
  while IFS= read -r s; do
    if [[ $s == http://* || $s == https://* ]]; then
      sources+=("$s")
    else
      # shellcheck disable=SC2206
      matches=($s)
      sources+=("${matches[@]}")
    fi
  done < <(jq -r '.sources[]' <<<"$entry")
  # Optional files are added only when they can be downloaded.
  while IFS= read -r s; do
    if curl -fsSL -o /dev/null -H 'Accept: text/turtle, application/rdf+xml;q=0.9' "$s"; then
      sources+=("$s")
    else
      echo "::warning::$title: left out $s, it could not be downloaded"
    fi
  done < <(jq -r '.optional // [] | .[]' <<<"$entry")
  echo "::group::$title"
  if "$OE" build "${sources[@]}" --title "$title" -o "$OUT/examples/$id.json"; then
    built=$(jq -c --argjson e "$entry" --arg src "examples/$id.json" \
      '. + [$e | {title, src: $src, focus, description, publisher} | with_entries(select(.value != null))]' <<<"$built")
  else
    echo "::warning::left out the $title example: its files could not be built"
    rm -f "$OUT/examples/$id.json"
  fi
  echo "::endgroup::"
done
jq . <<<"$built" >"$OUT/examples.json"
echo "built $(jq length <<<"$built") of $count examples"
