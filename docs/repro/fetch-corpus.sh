#!/usr/bin/env bash
# Fetch the verification corpus used by the scripts in this directory.
#
# microsoft/vscode-loc (MIT) — the VS Code language packs. Human translations, which
# is the point: synthetic text proves a detector can fire, not that it stays quiet.
#
# The files are a few megabytes each. Over a throttled link they truncate silently,
# so every download is validated with a JSON parse and re-fetched once on failure.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)/work"
mkdir -p "$DIR"
BASE="https://raw.githubusercontent.com/microsoft/vscode-loc/main/i18n"

fetch () {
  local pack="$1" out="$2"
  for attempt in 1 2; do
    curl -sL --max-time 280 -o "$DIR/$out" "$BASE/$pack/translations/main.i18n.json"
    if node -e "JSON.parse(require('fs').readFileSync('$DIR/$out','utf8'))" 2>/dev/null; then
      echo "$out ok ($(wc -c < "$DIR/$out") bytes)"
      return 0
    fi
    echo "$out incomplete on attempt $attempt, retrying" >&2
    rm -f "$DIR/$out"
  done
  echo "$out FAILED" >&2
  return 1
}

fetch vscode-language-pack-zh-hans loc-zh.json
fetch vscode-language-pack-zh-hant loc-zht.json
fetch vscode-language-pack-ja      loc-ja.json
fetch vscode-language-pack-ko      loc-ko.json
fetch vscode-language-pack-ru      loc-ru.json

echo "corpus in $DIR"
