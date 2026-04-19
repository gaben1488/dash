"""Clean slate: remove all graph-generated frontmatter keys from every atom
in the vault. Brain-graph and graphify will then rewrite their own fields,
with no collision.

Removes: community, brain-community, brain-degree, brain-god-node.
Scope: entire vault (60-Graph is already empty — it was just wiped).
"""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
SKIP_DIRS = {'.obsidian', '.trash', 'assets', '.git'}
FM_RE = re.compile(r'^(---\n)(.*?)(\n---\n)', re.DOTALL)

STALE_KEYS = ('community:', 'brain-community:', 'brain-degree:', 'brain-god-node:')

def walk(root):
    for p in root.rglob('*.md'):
        if any(part in SKIP_DIRS for part in p.relative_to(VAULT).parts):
            continue
        yield p

scanned = 0
cleaned = 0
for p in walk(VAULT):
    scanned += 1
    try:
        txt = p.read_text(encoding='utf-8', errors='replace')
    except Exception:
        continue
    m = FM_RE.match(txt)
    if not m: continue
    fm = m.group(2)
    new_lines = [ln for ln in fm.split('\n')
                 if not ln.lstrip().startswith(STALE_KEYS)]
    new_fm = '\n'.join(new_lines)
    if new_fm != fm:
        new_txt = m.group(1) + new_fm + m.group(3) + txt[m.end():]
        p.write_text(new_txt, encoding='utf-8')
        cleaned += 1

print(f"scanned {scanned}, cleaned {cleaned}")
