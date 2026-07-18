#!/usr/bin/env python3
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
errors = []

for skill_file in sorted((root / "skills").glob("*/SKILL.md")):
    text = skill_file.read_text(encoding="utf-8")
    folder = skill_file.parent.name
    match = re.match(
        r"^---\nname:\s*([a-z0-9-]+)\ndescription:\s*(.+?)\n---\n",
        text,
        flags=re.DOTALL,
    )
    if not match:
        errors.append(f"{skill_file}: invalid frontmatter")
        continue

    name = match.group(1).strip()
    description = match.group(2).strip()
    body = text[match.end():]

    if name != folder:
        errors.append(f"{skill_file}: name {name!r} does not match folder {folder!r}")
    if len(name) > 64:
        errors.append(f"{skill_file}: name exceeds 64 characters")
    if len(description) > 1024:
        errors.append(f"{skill_file}: description exceeds 1024 characters")
    if len(body.splitlines()) > 500:
        errors.append(f"{skill_file}: body exceeds 500 lines")
    if len(body.split()) > 500:
        errors.append(f"{skill_file}: body exceeds compact-pack limit of 500 words")

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)

print(f"Validated {len(list((root / 'skills').glob('*/SKILL.md')))} skills.")
