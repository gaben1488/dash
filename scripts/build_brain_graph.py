"""Brain-graph: apply graphify's pipeline to the AEMR Obsidian vault.

Procedure (mirrors graphify):
  detect  → scan vault, classify by type (from frontmatter)
  extract → parse frontmatter + wikilinks (deterministic, like AST)
  build   → NetworkX Graph: node=atom, edge=wikilink
  cluster → Leiden communities
  analyze → god-nodes, surprises, suggested questions
  report  → BRAIN_REPORT.md in 00-Meta/
  export  → enrich frontmatter (community: N), write brain-graph.json

Intentionally SKIPS 60-Graph/ — that folder is graphify's code-graph output,
with its own community structure. Mixing code-atoms into the brain-graph would
(a) overwrite graphify's `community:` frontmatter, (b) pollute concept communities
with function/class nodes. The two graphs stay separate; they're linked via
Cross-Brain-Map.md (00-Meta/) instead.

Brain-graph uses `brain-*` prefix for all enrichment fields so it never collides
with any other tool's frontmatter keys.
"""
import json, re, sys
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding='utf-8')

VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
OUT_REPORT = VAULT / "00-Meta" / "BRAIN_REPORT.md"
OUT_JSON   = VAULT / "00-Meta" / "brain-graph.json"

import networkx as nx
from graphify.cluster import cluster
from graphify.analyze import god_nodes, surprising_connections

FM_RE = re.compile(r'^---\n(.*?)\n---\n', re.DOTALL)
WIKI_RE = re.compile(r'\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]')
TAG_RE  = re.compile(r'["\']?#([А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z0-9/_-]+)["\']?')

SKIP_DIRS = {'.obsidian', '.trash', 'assets', '.git', '60-Graph'}

def parse_fm(text: str) -> dict:
    """Tiny YAML subset parser for frontmatter (type, tags, priority, status, related)."""
    m = FM_RE.match(text)
    if not m: return {}
    block = m.group(1)
    fm = {}
    cur_key = None
    for line in block.split('\n'):
        if not line.strip(): continue
        if line.startswith(' ') or line.startswith('\t'):
            if cur_key:
                v = line.strip().lstrip('-').strip().strip('"\'')
                if v:
                    existing = fm.get(cur_key)
                    if not isinstance(existing, list):
                        fm[cur_key] = [] if existing in (None, '') else [existing]
                    fm[cur_key].append(v)
            continue
        if ':' in line:
            k, _, v = line.partition(':')
            k = k.strip(); v = v.strip()
            cur_key = k
            if v.startswith('['):
                # inline list
                items = re.findall(r'"([^"]+)"|\'([^\']+)\'|([^,\[\]]+)', v)
                flat = [a or b or c for a,b,c in items if (a or b or c).strip()]
                flat = [x.strip() for x in flat if x.strip() and x.strip() != '[' and x.strip() != ']']
                fm[k] = flat
            else:
                fm[k] = v.strip('"\'')
    return fm

def node_id_from_path(p: Path) -> str:
    """Stable id: relative path without extension."""
    rel = p.relative_to(VAULT).with_suffix('').as_posix()
    return rel

def resolve_wikilink(target: str, current_dir: Path) -> Path | None:
    """Resolve wikilink [[X]] or [[folder/X]] to absolute path. Best-effort."""
    target = target.strip()
    if not target: return None
    # full path match
    candidates = []
    # direct match with .md
    p = VAULT / (target + '.md')
    if p.exists(): return p
    # match against all .md in vault by basename
    base = target.split('/')[-1]
    matches = list(VAULT.rglob(base + '.md'))
    if len(matches) == 1:
        return matches[0]
    elif len(matches) > 1:
        # prefer same dir, else first
        for m in matches:
            try:
                m.relative_to(current_dir)
                return m
            except ValueError:
                continue
        return matches[0]
    return None

# ── DETECT ──
print("1/6 detect")
all_md = []
for p in VAULT.rglob('*.md'):
    if any(part in SKIP_DIRS for part in p.parts): continue
    all_md.append(p)
print(f"  vault: {len(all_md)} markdown files")

types_counter = Counter()
by_type = defaultdict(list)

# ── EXTRACT ──
print("2/6 extract frontmatter + wikilinks")
atoms = {}  # node_id -> {path, fm, body, wikilinks, tags}
for p in all_md:
    try:
        txt = p.read_text(encoding='utf-8', errors='replace')
    except Exception:
        continue
    fm = parse_fm(txt)
    body = FM_RE.sub('', txt, count=1)
    wikilinks = [w.strip() for w in WIKI_RE.findall(body)]
    tags = list(set(TAG_RE.findall(body)))
    if isinstance(fm.get('tags'), list):
        tags.extend([t.lstrip('#').strip('"\'') for t in fm['tags']])
    atom_type = fm.get('type', 'unknown')
    types_counter[atom_type] += 1
    nid = node_id_from_path(p)
    atoms[nid] = {
        'path': p, 'fm': fm, 'wikilinks': wikilinks,
        'tags': tags, 'type': atom_type,
        'size': len(body),
    }
    by_type[atom_type].append(nid)

for t, c in sorted(types_counter.items(), key=lambda x:-x[1])[:15]:
    print(f"  {t}: {c}")

# ── BUILD ──
print("3/6 build graph")
G = nx.Graph()
for nid, a in atoms.items():
    G.add_node(nid,
        label=a['path'].stem,
        type=a['type'],
        path=str(a['path'].relative_to(VAULT)),
        tags=a['tags'][:10],
        size=a['size'],
    )

# resolve wikilinks → edges
resolved = 0; unresolved = 0
unresolved_list = []
for nid, a in atoms.items():
    for wl in a['wikilinks']:
        tgt = resolve_wikilink(wl, a['path'].parent)
        if tgt is None:
            unresolved += 1
            unresolved_list.append((nid, wl))
            continue
        tgt_id = node_id_from_path(tgt)
        if tgt_id in G.nodes and tgt_id != nid:
            G.add_edge(nid, tgt_id, kind='wikilink')
            resolved += 1

# also add tag-co-occurrence edges (weak)
tag_index = defaultdict(list)
for nid, a in atoms.items():
    for t in a['tags']:
        if len(t) >= 4:
            tag_index[t].append(nid)
tag_edges = 0
for tag, nids in tag_index.items():
    if 2 <= len(nids) <= 20:  # skip global tags
        for i in range(len(nids)):
            for j in range(i+1, len(nids)):
                if not G.has_edge(nids[i], nids[j]):
                    G.add_edge(nids[i], nids[j], kind='tag', tag=tag)
                    tag_edges += 1
                    if tag_edges > 5000: break
            if tag_edges > 5000: break
    if tag_edges > 5000: break

print(f"  nodes={G.number_of_nodes()} wikilink-edges={resolved} tag-edges={tag_edges} unresolved={unresolved}")

# ── CLUSTER ──
print("4/6 cluster")
try:
    communities = cluster(G)
except Exception as e:
    print(f"  Leiden failed ({e}), using connected-components fallback")
    communities = {i: list(c) for i, c in enumerate(nx.connected_components(G))}
print(f"  {len(communities)} communities")

# community labels: top-3 node labels by type-frequency
community_labels = {}
community_types = {}
for cid, nids in communities.items():
    types_in = Counter(atoms[n]['type'] if n in atoms else 'unknown' for n in nids)
    top_type = types_in.most_common(1)[0][0] if types_in else 'mixed'
    community_types[cid] = top_type
    # pick 2 named nodes as label
    sample = [atoms[n]['path'].stem for n in nids[:3] if n in atoms]
    community_labels[cid] = f"[{top_type}] " + " · ".join(sample[:2])

# ── ANALYZE ──
print("5/6 analyze")
# manual god-nodes by degree + betweenness
import networkx as nx
degree = dict(G.degree())
try:
    betw = nx.betweenness_centrality(G, k=min(300, G.number_of_nodes()))
except Exception:
    betw = {n: 0.0 for n in G.nodes}

gods = sorted(
    G.nodes,
    key=lambda n: (degree.get(n,0), betw.get(n,0.0)),
    reverse=True,
)[:30]

# bridges: edges whose removal disconnects communities
node_comm = {}
for cid, nids in communities.items():
    for n in nids: node_comm[n] = cid
bridges = []
for u, v, data in G.edges(data=True):
    if node_comm.get(u) != node_comm.get(v):
        bridges.append((u, v, data))

# orphans: nodes with no edges
orphans = [n for n in G.nodes if G.degree(n) == 0]
# dangling wikilinks report
dangling = unresolved_list[:100]

# ── REPORT ──
print("6/6 report + enrich")
now_s = datetime.now().strftime('%Y-%m-%d %H:%M')

lines = []
lines.append("---")
lines.append("type: brain-report")
lines.append("tags: [brain, graph, god-nodes, communities, аемр, p0]")
lines.append(f"created: {datetime.now().strftime('%Y-%m-%d')}")
lines.append(f"updated: {datetime.now().strftime('%Y-%m-%d')}")
lines.append(f"nodes: {G.number_of_nodes()}")
lines.append(f"edges: {G.number_of_edges()}")
lines.append(f"communities: {len(communities)}")
lines.append("priority: P0")
lines.append("status: active")
lines.append("description: \"Полный отчёт по графу мозга AEMR: все атомы, связи, сообщества, god-nodes, затыки.\"")
lines.append("related: [\"[[00-Meta/Brain-Architecture]]\", \"[[60-Graph/Code-Graph-MOC]]\", \"[[00-Meta/Cross-Brain-Map]]\", \"[[00-Meta/Graphify-Obsidian-Integration]]\"]")
lines.append("---")
lines.append("")
lines.append(f"# 🧠 BRAIN REPORT — граф второго мозга AEMR")
lines.append("")
lines.append(f"> [!info] Сгенерировано {now_s}")
lines.append(f"> **{G.number_of_nodes()}** атомов · **{G.number_of_edges()}** связей · **{len(communities)}** сообществ · **{resolved}** wikilinks разрешено · **{unresolved}** битых ссылок")
lines.append("")
lines.append("## 1. Структура vault'а по типам")
lines.append("")
lines.append("| Тип | Количество |")
lines.append("|-----|-----------|")
for t, c in sorted(types_counter.items(), key=lambda x:-x[1])[:20]:
    lines.append(f"| `{t}` | {c} |")
lines.append("")

lines.append("## 2. God-nodes — атомы с наибольшей центральностью")
lines.append("")
lines.append("Удаление одного из этих атомов разорвёт мозг сильнее всего. Трогать аккуратно.")
lines.append("")
lines.append("| Атом | Degree | Betweenness | Тип |")
lines.append("|------|--------|-------------|-----|")
for n in gods[:20]:
    a = atoms.get(n, {})
    t = a.get('type','?')
    lines.append(f"| [[{atoms[n]['path'].relative_to(VAULT).with_suffix('').as_posix() if n in atoms else n}\\|{atoms[n]['path'].stem if n in atoms else n}]] | {degree.get(n,0)} | {betw.get(n,0):.3f} | `{t}` |")
lines.append("")

lines.append("## 3. Сообщества (top-15 по размеру)")
lines.append("")
sorted_comms = sorted(communities.items(), key=lambda x:-len(x[1]))[:15]
for cid, nids in sorted_comms:
    lines.append(f"### Community #{cid} — {community_labels[cid]} ({len(nids)} атомов)")
    lines.append("")
    lines.append(f"**Главный тип:** `{community_types[cid]}`")
    lines.append("")
    # show up to 10 members
    lines.append("**Члены:**")
    for n in nids[:10]:
        if n in atoms:
            rel = atoms[n]['path'].relative_to(VAULT).with_suffix('').as_posix()
            lines.append(f"- [[{rel}|{atoms[n]['path'].stem}]]")
    if len(nids) > 10:
        lines.append(f"- … (ещё {len(nids)-10} атомов)")
    lines.append("")

lines.append("## 4. Мосты между сообществами")
lines.append("")
lines.append(f"Всего рёбер, соединяющих разные сообщества: **{len(bridges)}**.")
lines.append("")
lines.append("Топ-20 мостов (неожиданные связи):")
lines.append("")
lines.append("| Источник | Цель | Тип ребра |")
lines.append("|----------|------|-----------|")
for u, v, d in bridges[:20]:
    u_lbl = atoms[u]['path'].stem if u in atoms else u
    v_lbl = atoms[v]['path'].stem if v in atoms else v
    lines.append(f"| {u_lbl} | {v_lbl} | `{d.get('kind','?')}` |")
lines.append("")

lines.append("## 5. Орфанные атомы (без единой связи)")
lines.append("")
lines.append(f"Всего орфанов: **{len(orphans)}** — они не видны в графе, нужно либо связать, либо архивировать.")
lines.append("")
if orphans[:30]:
    lines.append("| Атом | Тип |")
lines.append("|------|-----|")
for n in orphans[:30]:
    a = atoms.get(n, {})
    lbl = a.get('path').stem if a.get('path') else n
    lines.append(f"| `{lbl}` | `{a.get('type','?')}` |")
if len(orphans) > 30:
    lines.append(f"| … ещё {len(orphans)-30} | |")
lines.append("")

lines.append("## 6. Битые wikilinks (атом ссылается на несуществующее)")
lines.append("")
lines.append(f"Всего битых ссылок: **{unresolved}**. Первые 30:")
lines.append("")
for src, wl in dangling[:30]:
    src_lbl = atoms[src]['path'].stem if src in atoms else src
    lines.append(f"- `{src_lbl}` → `[[{wl}]]` (не найдено)")
lines.append("")

lines.append("## 7. Рекомендации для следующей итерации")
lines.append("")
lines.append("1. **Орфаны**: связать минимум 2 wikilinks на каждый, иначе — архивировать в `archive/`.")
lines.append("2. **Битые ссылки**: либо создать недостающие атомы, либо исправить имена в исходных атомах.")
lines.append("3. **Мосты**: если мост между сообществами держится на одном ребре — усилить ещё 2-3 wikilinks, чтобы не рвалось.")
lines.append("4. **God-nodes**: добавить `protected: true` в frontmatter чтобы не удалять случайно.")
lines.append("5. **Сообщества без MOC**: для каждого из top-15 создать MOC в `10-Index/`.")
lines.append("")

lines.append("## 8. Автоматическое обновление")
lines.append("")
lines.append("Запуск: `python scripts/build_brain_graph.py`")
lines.append("")
lines.append("Hook: git post-commit уже обновляет код-граф; аналогичный hook для мозг-графа ставится вручную (vault в другом репо).")
lines.append("")

OUT_REPORT.write_text('\n'.join(lines), encoding='utf-8')
print(f"  report → {OUT_REPORT}")

# ── EXPORT JSON ──
print("  exporting brain-graph.json")
export = {
    'meta': {
        'generated_at': datetime.now().isoformat(),
        'vault': str(VAULT),
        'nodes': G.number_of_nodes(),
        'edges': G.number_of_edges(),
        'communities': len(communities),
        'resolved_wikilinks': resolved,
        'unresolved_wikilinks': unresolved,
    },
    'types': dict(types_counter),
    'god_nodes': [
        {'id': n, 'label': atoms[n]['path'].stem if n in atoms else n,
         'degree': degree.get(n,0), 'betweenness': betw.get(n,0.0),
         'type': atoms[n]['type'] if n in atoms else '?'}
        for n in gods[:30]
    ],
    'communities': {
        str(cid): {
            'label': community_labels[cid],
            'type': community_types[cid],
            'size': len(nids),
            'members': nids[:50],
        } for cid, nids in communities.items()
    },
    'bridges_count': len(bridges),
    'orphans_count': len(orphans),
}
OUT_JSON.write_text(json.dumps(export, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
print(f"  json → {OUT_JSON}")

# ── ENRICH FRONTMATTER ── (brain-community, brain-degree, brain-god-node)
# All brain-graph fields use `brain-` prefix so they never collide with other
# tools' frontmatter keys (notably graphify writes `community:` for code-atoms).
print("  enriching atom frontmatter with brain-community + brain-degree")
enriched = 0
for nid, a in atoms.items():
    p = a['path']
    cid = node_comm.get(nid)
    if cid is None: continue
    deg = degree.get(nid, 0)
    is_god = nid in gods[:30]
    try:
        txt = p.read_text(encoding='utf-8', errors='replace')
    except Exception:
        continue
    m = FM_RE.match(txt)
    if not m: continue
    fm_text = m.group(1)
    # remove stale brain-* fields AND any legacy `community:` written by previous
    # run of this script before the prefix-rename (otherwise it sticks forever)
    fm_lines = [ln for ln in fm_text.split('\n')
                if not ln.startswith(('brain-community:', 'brain-degree:', 'brain-god-node:'))]
    fm_lines.append(f"brain-community: {cid}")
    fm_lines.append(f"brain-degree: {deg}")
    if is_god: fm_lines.append("brain-god-node: true")
    new_fm = '\n'.join(fm_lines)
    new_text = f"---\n{new_fm}\n---\n" + txt[m.end():]
    if new_text != txt:
        p.write_text(new_text, encoding='utf-8')
        enriched += 1
print(f"  enriched {enriched} atoms")

print(f"\nDONE")
print(f"  Report: {OUT_REPORT}")
print(f"  JSON:   {OUT_JSON}")
print(f"  Communities: {len(communities)}")
print(f"  God-nodes: {len(gods[:30])}")
print(f"  Orphans: {len(orphans)}")
print(f"  Dangling wikilinks: {unresolved}")
