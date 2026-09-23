#!/usr/bin/env bash
# Launch Tracka desktop connected to its Neon Postgres database.
#
# Usage:
#   DATABASE_URL='postgresql://...' ./run.sh
#   # or: echo 'postgresql://...' > ~/.config/tracka-desktop/database_url && ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/tracka-desktop"
URL="${DATABASE_URL:-}"

if [[ -z "$URL" && -f "$CONFIG_DIR/database_url" ]]; then
  URL="$(tr -d '[:space:]' < "$CONFIG_DIR/database_url")"
fi

if [[ -z "$URL" ]]; then
  echo "note: DATABASE_URL is not set (running in offline-first local mode)." >&2
else
  export DATABASE_URL="$URL"
fi

mkdir -p "$CONFIG_DIR"
exec ./bin/tracka-desktop "$@"