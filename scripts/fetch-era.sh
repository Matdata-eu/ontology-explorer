#!/usr/bin/env bash
# Downloads the ERA vocabulary (ontology, SKOS concept schemes and SHACL shapes)
# from the European Union Agency for Railways' GitLab repository into
# examples/era/. The files are not stored in this repository: the ontology and
# shapes are published under the EUPL 1.2 and the concept schemes under CC BY 4.0.
#
#   scripts/fetch-era.sh [ref]     # ref defaults to main
set -euo pipefail

REF="${1:-main}"
PROJECT=67979846 # era-europa-eu/public/interoperable-data-programme/era-ontology/era-ontology
API="https://gitlab.com/api/v4/projects/${PROJECT}/repository"
OUT="$(cd "$(dirname "$0")/.." && pwd)/examples/era"
mkdir -p "$OUT/era-skos" "$OUT/era-shacl"

urlencode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }

fetch() {
  local path="$1" dest="$2"
  curl -fsSL --retry 3 -o "$dest" "${API}/files/$(urlencode "$path")/raw?ref=${REF}"
}

list() {
  # All .ttl files in a folder of the repository (paginated).
  local dir="$1" page=1
  while :; do
    local json
    json=$(curl -fsSL --retry 3 "${API}/tree?path=$(urlencode "$dir")&ref=${REF}&per_page=100&page=${page}")
    local names
    names=$(printf '%s' "$json" | python3 -c 'import sys, json; [print(e["path"]) for e in json.load(sys.stdin) if e["type"] == "blob" and e["path"].endswith(".ttl")]')
    [ -z "$names" ] && break
    printf '%s\n' "$names"
    page=$((page + 1))
  done
}

echo "ERA vocabulary (${REF}) -> ${OUT}"
fetch ontology.ttl "$OUT/ontology.ttl"
fetch LICENSE "$OUT/LICENSE" || true
n=0
for p in $(list era-skos); do fetch "$p" "$OUT/era-skos/$(basename "$p")"; n=$((n + 1)); done
echo "  ${n} SKOS files"
n=0
for p in $(list era-shacl); do fetch "$p" "$OUT/era-shacl/$(basename "$p")"; n=$((n + 1)); done
echo "  ${n} SHACL files"
