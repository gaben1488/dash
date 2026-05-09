"""
skills_audit.py — глубокий аудит всех skills в ~/.claude/skills/
с проверкой upstream-актуальности (где возможно).

Output:
  reports/skills_audit_<date>.md — markdown-отчёт по каждому skill
  reports/skills_audit_<date>.json — машинно-читаемый

Что собираем для каждого skill:
  - name, description (из frontmatter SKILL.md)
  - размер SKILL.md (байты, строки)
  - mtime локального файла
  - кластер (impeccable / ag- / taste- / ruflo / cognee / caveman / anthropic / design / ... / custom)
  - upstream (если знаем по mapping table)
  - upstream HEAD commit (через git ls-remote, без клонирования)
  - применимость к AEMR (mapping по namespace)

Hardware-aware: ls-remote — лёгкая операция, можно для всех 90+ skills.
"""
import os, sys, json, subprocess, re
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

SKILLS_DIR = Path.home() / '.claude' / 'skills'
PLUGINS_DIR = Path.home() / '.claude' / 'plugins'
REPORTS_DIR = Path(r'C:\Users\filat\dash\reports')
REPORTS_DIR.mkdir(exist_ok=True)

# Mapping: namespace prefix → upstream repo (если знаем)
UPSTREAM_MAP = {
    'caveman':       'https://github.com/JuliusBrussee/caveman',
    'cavecrew':      'https://github.com/JuliusBrussee/caveman',
    'caveman-compress': 'https://github.com/JuliusBrussee/caveman',
    'caveman-stats': 'https://github.com/JuliusBrussee/caveman',
    'browser-harness': 'https://github.com/browser-use/browser-harness',
    'cognee-remember': 'https://github.com/topoteretes/cognee-integrations',
    'cognee-search':   'https://github.com/topoteretes/cognee-integrations',
    'cognee-sync':     'https://github.com/topoteretes/cognee-integrations',
    'graphify':      'https://github.com/safishamsi/graphify',
    'humanizer':     'local-custom',
    'distill':       'local-custom',
    'lint':          'local-custom',
    'playwright-skill': 'local-custom',
    'postgres':      'local-custom',
    'update-config': 'anthropic-builtin',
    'keybindings-help': 'anthropic-builtin',
    'simplify':      'anthropic-builtin',
    'fewer-permission-prompts': 'anthropic-builtin',
    'loop':          'anthropic-builtin',
    'schedule':      'anthropic-builtin',
    'claude-api':    'anthropic-builtin',
}

# Префикс кластера для group-by
def cluster_of(name: str) -> str:
    if name.startswith('ag-apple-platform-'): return 'ag-apple-platform'
    if name.startswith('ag-architecture-'): return 'ag-architecture'
    if name.startswith('ag-data-analytics-'): return 'ag-data-analytics'
    if name.startswith('ag-ddd-evented-'): return 'ag-ddd-evented'
    if name.startswith('ag-essentials-'): return 'ag-essentials'
    if name.startswith('ag-full-stack-'): return 'ag-full-stack'
    if name.startswith('ag-'): return 'ag-other'
    if name.startswith('impeccable-'): return 'impeccable'
    if name.startswith('caveman') or name == 'cavecrew': return 'caveman'
    if name.startswith('cognee-'): return 'cognee'
    if name.startswith('taste-'): return 'taste'
    if name.startswith('ruflo-'): return 'ruflo'
    if name in UPSTREAM_MAP and UPSTREAM_MAP[name] == 'local-custom': return 'custom-local'
    if name in UPSTREAM_MAP and UPSTREAM_MAP[name] == 'anthropic-builtin': return 'anthropic-builtin'
    return 'other'

def parse_frontmatter(path: Path) -> dict:
    """Извлекает name + description из SKILL.md (frontmatter)."""
    out = {'name': path.parent.name, 'description': '', 'version': ''}
    if not path.exists():
        return out
    try:
        text = path.read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        out['_error'] = str(e)
        return out

    fm_match = re.match(r'^---\n(.*?)\n---', text, re.DOTALL)
    if fm_match:
        for line in fm_match.group(1).splitlines():
            if ':' in line:
                k, v = line.split(':', 1)
                k = k.strip()
                v = v.strip()
                if k == 'name': out['name'] = v
                elif k == 'description': out['description'] = v[:200]
                elif k == 'version': out['version'] = v
    return out

def upstream_head(url: str) -> str | None:
    if not url or url.startswith('local-') or url.startswith('anthropic-'): return None
    try:
        r = subprocess.run(['git', 'ls-remote', url, 'HEAD'],
                          capture_output=True, text=True, timeout=20)
        if r.returncode == 0:
            return r.stdout.split('\t')[0][:8]
    except Exception:
        pass
    return None

def aemr_applicability(name: str, desc: str) -> str:
    """Эвристика: насколько skill применим к AEMR."""
    desc_low = desc.lower()
    name_low = name.lower()

    # явно бесполезные для AEMR
    if 'sales' in name_low or 'crm' in desc_low: return 'P3 — sales не нужен'
    if 'stripe' in name_low: return 'P3 — payments вне scope'
    if 'mobile' in name_low or 'react-native' in name_low: return 'P3 — нет мобилки'
    if 'adobe' in name_low and 'photo' in desc_low: return 'P3 — нет фото-задач'
    if 'slack-gif' in name_low: return 'P3 — нет slack'

    # P0 для AEMR
    if name_low.startswith('impeccable-'): return 'P0 — UI работа'
    if name_low.startswith('cognee-'): return 'P1 — knowledge graph (заблокирован LLM key)'
    if name_low.startswith('caveman'): return 'P2 — token compression по запросу'
    if 'systematic-debugging' in name_low: return 'P0 — bugs'
    if 'brainstorming' in name_low: return 'P0 — content вопросы'
    if 'test-driven' in name_low: return 'P0 — TDD для core'
    if 'verification-before-completion' in name_low: return 'P0 — anti-hallucination'
    if 'writing-skills' in name_low: return 'P1 — для новых skills'
    if 'data:' in name_low or 'sql' in name_low: return 'P0 — анализ AEMR данных'
    if 'postgres' in name_low: return 'P0 — PG migration'
    if 'figma' in name_low: return 'P1 — макеты дашборда'
    if 'playwright' in name_low: return 'P1 — e2e UI'
    if 'humanizer' in name_low: return 'P0 — стиль ответов'
    if 'distill' in name_low: return 'P1 — синтез knowledge'
    if 'lint' in name_low: return 'P1 — vault health'
    if 'graphify' in name_low: return 'P1 — код-граф'
    if 'browser-harness' in name_low or name_low == 'browser': return 'P2 — browser CDP'
    if 'design:' in name_low: return 'P1 — UI работа'
    if 'finance:' in name_low: return 'P1 — финансы AEMR (reconciliation)'
    if 'engineering:' in name_low: return 'P1 — code-review/debug'
    if 'product-management' in name_low: return 'P1 — brainstorm/roadmap'
    if 'operations:' in name_low: return 'P2 — runbook/process-doc'
    if 'pdf' in name_low: return 'P2 — паспорта проекта'
    if 'docx' in name_low or 'xlsx' in name_low: return 'P2 — отчёты в Office'
    if 'mcp-builder' in name_low: return 'P2 — если делаем custom MCP'

    return 'P2 — может пригодиться'

# ---- main ----
print(f'[skills_audit] scanning {SKILLS_DIR}')
all_skills = []

for entry in sorted(SKILLS_DIR.iterdir()):
    if not entry.is_dir(): continue
    skill_md = entry / 'SKILL.md'
    fm = parse_frontmatter(skill_md)
    name = entry.name
    cluster = cluster_of(name)
    upstream = UPSTREAM_MAP.get(name, '')
    if not upstream and cluster != 'other':
        # try to map by cluster
        if cluster in ('caveman', 'cognee', 'browser-harness', 'graphify'):
            upstream = UPSTREAM_MAP.get(name, '')

    record = {
        'name': name,
        'cluster': cluster,
        'frontmatter_name': fm.get('name', ''),
        'description': fm.get('description', ''),
        'version': fm.get('version', ''),
        'skill_md_size': skill_md.stat().st_size if skill_md.exists() else 0,
        'mtime': datetime.fromtimestamp(skill_md.stat().st_mtime).isoformat() if skill_md.exists() else '',
        'upstream': upstream,
        'applicability': aemr_applicability(name, fm.get('description', '')),
    }
    all_skills.append(record)

print(f'  found {len(all_skills)} skills')

# Group by cluster
clusters = {}
for s in all_skills:
    clusters.setdefault(s['cluster'], []).append(s)

print(f'  clusters: {", ".join(f"{k}({len(v)})" for k, v in sorted(clusters.items()))}')

# Upstream check for скиллов с known upstream
print('\n[upstream] checking HEADs for known repos (5-30 sec)...')
known_upstreams = sorted(set(UPSTREAM_MAP.values()) - {'local-custom', 'anthropic-builtin', ''})
upstream_heads = {}
for url in known_upstreams:
    h = upstream_head(url)
    upstream_heads[url] = h
    print(f'  {url}: HEAD={h}')

# Save reports
out_md = REPORTS_DIR / f'skills_audit_2026-05-09.md'
out_json = REPORTS_DIR / f'skills_audit_2026-05-09.json'

# Markdown report
md = ['# Skills audit — 2026-05-09', '', f'Total: **{len(all_skills)} skills** in `~/.claude/skills/`', '']
md.append('## Кластеры')
md.append('')
md.append('| Кластер | Кол-во | Источник | Auto-update? |')
md.append('|---|---:|---|---|')
cluster_origin = {
    'impeccable': 'pbakaus/impeccable plugin', 'caveman': 'jayminwest/caveman (manual)',
    'cognee': 'topoteretes/cognee-integrations (manual)', 'taste': 'plugin (taste-*)',
    'ruflo': 'plugin (ruflo-*)', 'ag-architecture': 'agentic-skills plugin',
    'ag-essentials': 'agentic-skills plugin', 'ag-data-analytics': 'agentic-skills plugin',
    'ag-ddd-evented': 'agentic-skills plugin', 'ag-full-stack': 'agentic-skills plugin',
    'ag-apple-platform': 'agentic-skills plugin', 'ag-other': 'agentic-skills plugin',
    'custom-local': 'наши локальные', 'anthropic-builtin': 'Anthropic builtin',
    'other': 'разное (plugins / builtin)',
}
auto_updates = {
    'impeccable': 'нет (manual update)',
    'caveman': 'нет (manual)', 'cognee': 'нет (manual)',
    'taste': 'plugin-managed (но user уточнил — не автообновляется)',
    'ruflo': 'plugin-managed (то же)',
    'ag-architecture': 'plugin-managed (то же)', 'ag-essentials': 'plugin-managed (то же)',
    'ag-data-analytics': 'plugin-managed (то же)', 'ag-ddd-evented': 'plugin-managed (то же)',
    'ag-full-stack': 'plugin-managed (то же)', 'ag-apple-platform': 'plugin-managed (то же)',
    'ag-other': 'plugin-managed (то же)',
    'custom-local': 'нет — наши',
    'anthropic-builtin': 'через update Claude Code',
    'other': 'смешано',
}
for k in sorted(clusters.keys()):
    md.append(f'| {k} | {len(clusters[k])} | {cluster_origin.get(k, "?")} | {auto_updates.get(k, "?")} |')

md.append('')
md.append('## Все skills (детально, отсортировано по кластеру)')
md.append('')
md.append('| Skill | Кластер | Description (≤80) | Размер | Mtime | Применимость |')
md.append('|---|---|---|---:|---|---|')

for s in sorted(all_skills, key=lambda x: (x['cluster'], x['name'])):
    desc = (s['description'] or '').replace('|', '\\|').replace('\n', ' ')[:80]
    mtime_short = s['mtime'][:10] if s['mtime'] else '?'
    md.append(f'| `{s["name"]}` | {s["cluster"]} | {desc} | {s["skill_md_size"]} | {mtime_short} | {s["applicability"]} |')

md.append('')
md.append('## Upstream HEAD проверка (для known repos)')
md.append('')
md.append('| Repo | HEAD |')
md.append('|---|---|')
for url, h in upstream_heads.items():
    md.append(f'| {url} | `{h or "n/a"}` |')

out_md.write_text('\n'.join(md), encoding='utf-8')
out_json.write_text(json.dumps({'skills': all_skills, 'upstream_heads': upstream_heads}, ensure_ascii=False, indent=2), encoding='utf-8')

print(f'\n[OK] wrote {out_md}')
print(f'[OK] wrote {out_json}')
print(f'\nTotal: {len(all_skills)} skills across {len(clusters)} clusters')
