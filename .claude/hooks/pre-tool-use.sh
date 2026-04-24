#!/bin/bash
# DeepGrep PreToolUse: guard schema safety on Edit/Write, enforce MCP search.
# Shell for speed (~5ms vs ~100ms Node startup).
INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

command -v jq &>/dev/null || exit 0

TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')
NEW_CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.new_string // .tool_input.content // ""')

# ── Schema safety (Edit/Write) ────────────────────────────────────────────────
if [[ "$FILE_PATH" == *".deepgrep/graph.db"* ]]; then
  echo "BLOCKED: Do not edit graph.db directly. Use GraphDatabase.ts methods instead." >&2
  exit 2
fi

if [[ "$FILE_PATH" == *"GraphDatabase.ts"* ]]; then
  if printf '%s' "$NEW_CONTENT" | grep -qiE 'DROP[[:space:]]+TABLE|ALTER[[:space:]]+TABLE[[:space:]].*RENAME|DROP[[:space:]]+COLUMN'; then
    echo "BLOCKED: Destructive schema change detected. Create a migration in packages/extension/src/db/migrations/ first, then update GraphDatabase.ts." >&2
    exit 2
  fi
  if printf '%s' "$NEW_CONTENT" | grep -qiE 'CREATE[[:space:]]+TABLE|ADD[[:space:]]+COLUMN'; then
    echo "WARNING: Schema change detected in GraphDatabase.ts. Bump schema version in index_metadata and add a migration file."
    exit 1
  fi
fi

MIGRATION_DIR="${CLAUDE_PROJECT_DIR}/packages/extension/src/db/migrations"
# Migration files themselves are always allowed (they ARE the documented change)
if [[ "$FILE_PATH" != *"/db/migrations/"* ]]; then
  if printf '%s' "$NEW_CONTENT" | grep -qiE 'DROP[[:space:]]+TABLE|DELETE[[:space:]]+FROM[[:space:]]+nodes|DELETE[[:space:]]+FROM[[:space:]]+edges'; then
    # Allow when a migration file exists (developer has documented the schema change)
    if [[ -d "$MIGRATION_DIR" ]] && ls "$MIGRATION_DIR"/*.sql >/dev/null 2>&1; then
      : # migration file present — allow
    else
      echo "BLOCKED: Potentially destructive SQL detected. Add a .sql migration file in packages/extension/src/db/migrations/ first." >&2
      exit 2
    fi
  fi
fi

# ── DeepGrep search enforcement ───────────────────────────────────────────────
# Once graph.db exists, redirect codebase searches to mcp__deepgrep__ tools.
DB_PATH="${CLAUDE_PROJECT_DIR:-.}/.deepgrep/graph.db"

if [[ "$TOOL_NAME" == "Bash" ]] && [[ -f "$DB_PATH" ]]; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')
  # Match recursive grep/find used for code exploration (not build scripts or single-file checks)
  if printf '%s' "$CMD" | grep -qE '^[[:space:]]*(grep|rg|ag|find)[[:space:]].+(-r|-R|--recursive|/src|/packages)'; then
    printf '{"decision":"block","reason":"DeepGrep is indexed — use mcp__deepgrep__search_graph or mcp__deepgrep__get_context_for_symbol instead of grep. Only fall back to grep if the graph returns no results."}\n'
    exit 2
  fi
fi

exit 0
