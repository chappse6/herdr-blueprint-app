#!/bin/sh
# Renders Blueprint once with a generated diagram of n boxes in Herdr's own
# engine (`herdr-app check`), which cuts off a render that runs about 50 ms.
# Prints how long the layouts and the render took, or "interrupted".
#   scripts/bench.sh [cold|warm|zoomed] [n ...]     default: warm 100 300 500
# Needs the Herdr app (herdr-app) and node.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
mode=warm
case "${1:-}" in cold|warm|zoomed) mode=$1; shift ;; esac
[ $# -gt 0 ] || set -- 100 300 500
out=$(mktemp -d "${TMPDIR:-/tmp}/blueprint-bench.XXXXXX")
trap 'rm -rf "$out"' EXIT
mkdir -p "$out/bp"
cp "$here"/mods/blueprint/*.js "$out/bp/"
cp "$here/scripts/bench/main.js" "$out/main.js"
echo '{ "place": "none", "title": "Blueprint bench" }' > "$out/mod.json"
for n in "$@"; do
  node -e "import('$here/scripts/bench/diagram.mjs').then((m) => console.log('export const P = ' + JSON.stringify({ mode: '$mode', n: $n, src: m.bigDiagram($n) }) + ';'))" > "$out/params.js"
  printf 'n=%s: ' "$n"
  herdr-app check "$out" 2>&1 | grep -m1 -oE "RESULT.*|interrupted|Error.*" | sed 's/^RESULT //' || echo "no result"
done
