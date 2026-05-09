"""
sync_ag_skills.py — обновляет наши 36 ag-* skills из antigravity-awesome-skills v11.0.0.

Mapping: ag-<bundle>-<name>/SKILL.md ← antigravity/skills/<name>/SKILL.md
Bundle prefix не из upstream, добавляется при инсталляции через npx.

Usage: python scripts/sync_ag_skills.py [--dry-run]
"""
import sys, hashlib
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

UPSTREAM_SKILLS = Path(r'C:\Users\filat\AppData\Local\Temp\skill-updates\antigravity-v11\skills')
LOCAL_SKILLS = Path(r'C:\Users\filat\.claude\skills')
DRY = '--dry-run' in sys.argv

# Map our ag-* names → upstream skill folder name (drop bundle prefix)
def upstream_name(local_name):
    """ag-essentials-systematic-debugging → systematic-debugging"""
    if not local_name.startswith('ag-'):
        return None
    parts = local_name[3:].split('-')
    # bundles: essentials, full-stack-developer, architecture-design, data-analytics, ddd-evented-architecture, apple-platform-design
    bundles = ['essentials', 'full-stack-developer', 'architecture-design', 'data-analytics', 'ddd-evented-architecture', 'apple-platform-design']
    for b in bundles:
        b_parts = b.split('-')
        if parts[:len(b_parts)] == b_parts:
            return '-'.join(parts[len(b_parts):])
    return None

def file_hash(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()[:12]

# Find all ag-* local skills
ag_skills = sorted(d.name for d in LOCAL_SKILLS.iterdir() if d.is_dir() and d.name.startswith('ag-'))
print(f'[sync_ag_skills] {"DRY-RUN" if DRY else "APPLY"}: {len(ag_skills)} ag-* skills locally\n')

unchanged, changed, missing_upstream = [], [], []
actions = []

for local_name in ag_skills:
    upstream = upstream_name(local_name)
    if not upstream:
        print(f'  [warn] cannot derive upstream for {local_name}')
        continue
    local_path = LOCAL_SKILLS / local_name / 'SKILL.md'
    upstream_path = UPSTREAM_SKILLS / upstream / 'SKILL.md'
    if not upstream_path.exists():
        missing_upstream.append((local_name, upstream))
        continue
    if not local_path.exists():
        actions.append(('create', local_path, upstream_path, local_name))
        continue
    lh = file_hash(local_path)
    uh = file_hash(upstream_path)
    if lh == uh:
        unchanged.append(local_name)
    else:
        changed.append((local_name, lh, uh))
        actions.append(('update', local_path, upstream_path, local_name))

print(f'  Unchanged (identical): {len(unchanged)}')
print(f'  Changed: {len(changed)}')
print(f'  Missing in upstream v11: {len(missing_upstream)}')
print()
if changed:
    print('  Changed skills:')
    for n, lh, uh in changed[:20]:
        print(f'    {n}: {lh} → {uh}')
if missing_upstream:
    print('  Missing in upstream v11 (renamed/removed?):')
    for ln, un in missing_upstream:
        print(f'    {ln} → expected upstream skills/{un}/')

if DRY or not actions:
    print(f'\n[DRY] would apply {len(actions)} updates.')
else:
    for kind, local_p, up_p, name in actions:
        local_p.parent.mkdir(parents=True, exist_ok=True)
        local_p.write_bytes(up_p.read_bytes())
        print(f'  ✓ {kind}: {name}')
    print(f'\n[DONE] {len(actions)} skills synced.')
