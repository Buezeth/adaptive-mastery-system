#!/usr/bin/env sh
# Thin wrapper so the installer works from a clone without a package manager.
# Usage: ./install.sh [command] [options]   (default command: init, target: current directory)
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js 18+ is required for the installer." >&2
  echo "       Install it from https://nodejs.org, or copy the folder manually:" >&2
  echo "       see ${here}/docs/INSTALL.md" >&2
  exit 2
fi

exec node "${here}/install/cli.mjs" "$@"
