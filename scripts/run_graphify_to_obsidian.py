"""Full graphify pipeline → AEMR Obsidian vault.

Pipeline: detect → extract (AST) → build → cluster → analyze
  → report → export (to_obsidian + to_json + to_html) → copy to vault/60-Graph/
"""
import json, shutil, sys
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

PROJECT = Path(r"C:/Users/filat/dash")
VAULT   = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
GRAPH_DIR = PROJECT / "graphify-out"
GRAPH_DIR.mkdir(exist_ok=True)

from graphify.detect import detect
from graphify.extract import collect_files, extract
from graphify.build import build
from graphify.cluster import cluster, score_all, cohesion_score
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate as gen_report
from graphify.export import to_obsidian, to_json, to_html

# ── STEP 1: detect ──
print("1/7 detect")
d = detect(PROJECT)
(GRAPH_DIR / ".graphify_detect.json").write_text(json.dumps(d, default=str), encoding='utf-8')
files = d.get('files', {})
for k, v in files.items():
    if v: print(f"   {k}: {len(v)}")

# ── STEP 2: AST extract ──
# EXCLUDE: scripts/ (contains helper Python with long docstrings that graphify
# turns into nodes named like concepts — pollutes 60-Graph with non-code noise).
# Only TypeScript/TSX product code should appear in the code-graph.
print("2/7 AST extract")
EXCLUDE_DIR_PARTS = {'scripts', 'node_modules', 'dist', 'build', '.turbo',
                     'graphify-out', '.git', 'coverage'}

def _is_excluded(path: Path) -> bool:
    try:
        parts = path.relative_to(PROJECT).parts
    except ValueError:
        return False
    return any(p in EXCLUDE_DIR_PARTS for p in parts)

code_files = []
for f in files.get('code', []):
    p = Path(f) if Path(f).is_absolute() else PROJECT / f
    if _is_excluded(p): continue
    if p.is_dir():
        for cf in collect_files(p):
            if not _is_excluded(cf): code_files.append(cf)
    else:
        code_files.append(p)
ast_result = extract(code_files)
print(f"   {len(ast_result['nodes'])} nodes, {len(ast_result['edges'])} edges (scripts/ excluded)")

extract_final = {
    'nodes': ast_result['nodes'], 'edges': ast_result['edges'],
    'hyperedges': [], 'input_tokens': 0, 'output_tokens': 0,
}
(GRAPH_DIR / ".graphify_extract.json").write_text(
    json.dumps(extract_final, indent=2, default=str), encoding='utf-8')

# ── STEP 3: build ──
print("3/7 build graph")
G = build([extract_final])
print(f"   nodes={G.number_of_nodes()} edges={G.number_of_edges()}")

# ── STEP 4: cluster ──
print("4/7 cluster (Leiden)")
communities = cluster(G)  # dict[int, list[str]]
print(f"   {len(communities)} communities")

# cohesion scores per community
cohesion = score_all(G, communities)  # dict[int, float]

# community labels: pick first few node labels as rough label
community_labels = {}
for cid, node_ids in communities.items():
    labels = []
    for nid in node_ids[:3]:
        lbl = G.nodes[nid].get('label', nid) if nid in G.nodes else nid
        labels.append(str(lbl))
    community_labels[cid] = " / ".join(labels) if labels else f"community-{cid}"

# ── STEP 5: analyze ──
print("5/7 analyze (god-nodes, surprises, suggested questions)")
gods = god_nodes(G, top_n=15)
surprises = surprising_connections(G, communities, top_n=10)
try:
    questions = suggest_questions(G, communities, community_labels, top_n=7)
except Exception as e:
    print(f"   suggest_questions skipped: {e}")
    questions = []

# ── STEP 6: export ──
print("6/7 export")
to_json(G, communities, str(GRAPH_DIR / "graph.json"))
try:
    to_html(G, communities, str(GRAPH_DIR / "graph.html"), community_labels)
except Exception as e:
    print(f"   html failed: {e}")

total_files = sum(len(v) for v in files.values())
detection_result = {
    "total_files": total_files,
    "total_words": d.get('total_words', 0),
    "files": {k: len(v) for k, v in files.items()},
    **d,  # include everything else detect returned
}
token_cost = {"input_tokens": 0, "output_tokens": 0, "total_usd": 0.0}

report_md = gen_report(
    G, communities, cohesion, community_labels,
    gods, surprises, detection_result, token_cost,
    str(PROJECT), questions,
)
(GRAPH_DIR / "GRAPH_REPORT.md").write_text(report_md, encoding='utf-8')
print(f"   report: {len(report_md)} chars")

# ── STEP 7: export to Obsidian vault ──
print("7/7 Obsidian export → AEMR vault")
DEST = VAULT / "60-Graph"
DEST.mkdir(parents=True, exist_ok=True)

# clean old
for sub in ("nodes", "communities"):
    old = DEST / sub
    if old.exists(): shutil.rmtree(old)

n_written = to_obsidian(G, communities, str(DEST), community_labels, cohesion)
print(f"   to_obsidian: {n_written} files → {DEST}")

# CRITICAL: graphify.to_obsidian creates {DEST}/.obsidian/graph.json for graph-view
# colors, but Obsidian treats nested .obsidian/ as a SUB-VAULT and refuses to
# index the parent folder's contents. Rename it to keep the config accessible
# without triggering sub-vault detection.
nested = DEST / ".obsidian"
if nested.exists():
    color_cfg = nested / "graph.json"
    if color_cfg.exists():
        shutil.move(str(color_cfg), str(DEST / "graph-colors.json"))
    try: nested.rmdir()
    except OSError: shutil.rmtree(nested)
    print(f"   fixed: removed nested .obsidian/, saved colors as graph-colors.json")

# copy artefacts alongside
for name in ("graph.json", "graph.html"):
    s = GRAPH_DIR / name
    if s.exists(): shutil.copy2(s, DEST / name)

# write GRAPH_REPORT.md with frontmatter
rp = DEST / "GRAPH_REPORT.md"
fm = (
    "---\n"
    "type: graph-report\n"
    "tags: [graphify, code-map, архитектура, аемр, moc]\n"
    f"created: {datetime.utcnow().strftime('%Y-%m-%d')}\n"
    "source: graphify-ast-auto\n"
    f"nodes: {G.number_of_nodes()}\n"
    f"edges: {G.number_of_edges()}\n"
    f"communities: {len(communities)}\n"
    "description: \"Детальная карта кода AEMR: файлы × функции × классы × их связи. God-nodes + сообщества + сюрпризы.\"\n"
    "priority: P0\n"
    "status: active\n"
    "related: [\"[[60-Graph/Code-Graph-MOC]]\", \"[[00-Meta/Graphify-Obsidian-Integration]]\"]\n"
    "---\n\n"
)
rp.write_text(fm + report_md, encoding='utf-8')

# MOC for 60-Graph/
moc = DEST / "Code-Graph-MOC.md"
with moc.open('w', encoding='utf-8') as f:
    f.write("---\n"
            "type: moc\n"
            "tags: [moc, graphify, code-map, аемр]\n"
            f"created: {datetime.utcnow().strftime('%Y-%m-%d')}\n"
            f"updated: {datetime.utcnow().strftime('%Y-%m-%d')}\n"
            "priority: P0\n"
            "description: \"MOC по графу кода AEMR — god-nodes, сообщества, 44-ФЗ, pipeline\"\n"
            "---\n\n"
            f"# 🕸️ Карта кода AEMR\n\n"
            f"> [!info] Сгенерировано: `graphify` AST-only\n"
            f"> **{G.number_of_nodes()}** узлов · **{G.number_of_edges()}** связей · **{len(communities)}** сообществ · {datetime.utcnow():%Y-%m-%d %H:%M}\n\n"
            "## Навигация\n\n"
            "- [[GRAPH_REPORT]] — полный отчёт, god-nodes по центральности, сюрпризы\n"
            "- `graph.json` — граф в JSON (для `graphify query` / `path` / `explain`)\n"
            "- `graph.html` — интерактивная визуализация (открыть в браузере)\n"
            "- `nodes/` — атом на каждый узел с wikilinks\n"
            "- `communities/` — атом на каждое сообщество\n\n"
            "## Top-5 god-nodes (по центральности)\n\n")
    for g in gods[:5]:
        f.write(f"- **[[nodes/{g.get('label',g['id'])}]]** — degree {g.get('degree','?')}, betweenness {g.get('betweenness',0):.3f}\n")
    f.write("\n## Сюрпризы (неожиданные связи между сообществами)\n\n")
    for s in surprises[:5]:
        src = s.get('source','?'); tgt = s.get('target','?')
        f.write(f"- [[nodes/{src}]] ↔ [[nodes/{tgt}]] — {s.get('explanation','')}\n")
    f.write("\n## Как использовать\n\n"
            "1. **Перед правкой кода X**: открыть `nodes/X.md` → посмотреть `outlinks` (зависит от) и `inlinks` (кто зависит)\n"
            "2. **Поиск «а кто ещё вызывает Y?»**: `graphify query \"кто вызывает Y\"` (CLI)\n"
            "3. **Визуально**: открыть `graph.html`, фильтровать по community\n"
            "4. **Obsidian Canvas**: `ctrl+shift+P` → Graph View — подхватит все wikilinks\n"
            "5. **Перед рефакторингом**: `graphify path \"A\" \"B\"` — кратчайший путь между сущностями\n\n"
            "## Автоматическое обновление\n\n"
            "Git hook `post-commit` запускает `python scripts/run_graphify_to_obsidian.py` после каждого коммита. Граф всегда свежий.\n\n"
            "См. [[00-Meta/Graphify-Obsidian-Integration]] — протокол работы.\n")

print(f"\nDONE → {DEST}")
print(f"  Report: {DEST / 'GRAPH_REPORT.md'}")
print(f"  MOC:    {moc}")
print(f"  Graph:  {DEST / 'graph.json'}")
print(f"  Wiki:   {DEST / 'nodes'} + {DEST / 'communities'}")
