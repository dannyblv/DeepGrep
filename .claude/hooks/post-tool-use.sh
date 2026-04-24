#!/bin/bash
# DeepGrep PostToolUse: queue edited source files for re-indexing.
INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

command -v jq &>/dev/null || exit 0

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')

[ -z "$FILE_PATH" ] && exit 0
[[ "$FILE_PATH" == *"node_modules"* ]] && exit 0
[[ "$FILE_PATH" == *".deepgrep"* ]] && exit 0

case "${FILE_PATH##*.}" in
  ts|tsx|js|jsx|py|go|rs|java|c|cpp|h) ;;
  *) exit 0 ;;
esac

ROOT="${CLAUDE_PROJECT_DIR:-.}"
DEEPGREP_DIR="$ROOT/.deepgrep"
QUEUE_PATH="$DEEPGREP_DIR/reindex-queue.json"

mkdir -p "$DEEPGREP_DIR"
[ -f "$QUEUE_PATH" ] || echo '[]' > "$QUEUE_PATH"

TS="$(($(date +%s) * 1000))"
TMP=$(mktemp)
jq --arg path "$FILE_PATH" --arg ts "$TS" \
  '[.[] | select(.path != $path)] + [{path: $path, queuedAt: ($ts|tonumber)}]' \
  "$QUEUE_PATH" > "$TMP" && mv "$TMP" "$QUEUE_PATH"

exit 0
