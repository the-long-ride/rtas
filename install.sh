#!/usr/bin/env sh
set -eu

dest=
force=
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --help|-h)
      echo "Usage: ./install.sh DESTINATION [--force]"
      exit 0
      ;;
    --*)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
    *) dest="$arg" ;;
  esac
done

if [ -z "$dest" ]; then
  echo "Usage: ./install.sh DESTINATION [--force]" >&2
  exit 2
fi

cli="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/dist/cli.js"
if [ ! -f "$cli" ]; then
  echo "dist/cli.js not found. Run 'npm install && npm run build' first, or install the npm package '@the-long-ride/rust-tauri-agent-skills' globally and use the 'rtas' command." >&2
  exit 1
fi

if [ -n "$force" ]; then
  exec node "$cli" install --dest "$dest" --all --force
else
  exec node "$cli" install --dest "$dest" --all
fi
