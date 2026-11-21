#!/usr/bin/env bash
set -euo pipefail

if (( $# > 1 )); then
  echo "Usage: $0 [project-folder]" >&2
  exit 2
fi

args=()
if (( $# == 1 )); then
  if [[ ! -f "$1/project.yaml" ]]; then
    echo "Project folder must contain project.yaml: $1" >&2
    exit 2
  fi
  args=(--reopen-project "$(realpath -- "$1")")
fi

cd -- "$(dirname -- "$(realpath -- "${BASH_SOURCE[0]}")")"
unset ELECTRON_RUN_AS_NODE XM_SMOKE XM_SMOKE_SCREENSHOT
export CHOKIDAR_USEPOLLING="${CHOKIDAR_USEPOLLING:-1}"

if [[ ! -x node_modules/.bin/electron ]]; then
  npm ci
fi
npm run build
exec ./node_modules/.bin/electron . "${args[@]}"
