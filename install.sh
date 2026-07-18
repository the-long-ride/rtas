#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: ./install.sh DESTINATION [--force]" >&2
  exit 2
fi

destination=$1
force=${2:-}
source_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/skills"

mkdir -p "$destination"

for skill_dir in "$source_dir"/*; do
  [ -d "$skill_dir" ] || continue
  name=$(basename "$skill_dir")
  target="$destination/$name"

  if [ -e "$target" ] && [ "$force" != "--force" ]; then
    echo "Skipping existing skill: $name (use --force to replace)" >&2
    continue
  fi

  rm -rf "$target"
  cp -R "$skill_dir" "$target"
  echo "Installed $name"
done
