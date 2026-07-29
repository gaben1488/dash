"""Выжать всё содержательное из журналов воркфлоу в один markdown.

Берёт каждую запись type=result, достаёт findings / done / mismatches /
blocked / covered и любой текстовый возврат, пишет в UTF-8 файл.
"""
import io
import json
import os
import glob

WF = r"C:/Users/filat/.claude/projects/C--Users-filat-dash/d62f77a0-8ae8-4a83-bcfd-4d9009e386f2/subagents/workflows"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workflow-harvest.md")


def walk(value, depth=0):
    """Рекурсивно вытащить осмысленные строки из произвольной структуры."""
    out = []
    if isinstance(value, str):
        s = value.strip()
        if len(s) > 30:
            out.append(s)
    elif isinstance(value, dict):
        for k, v in value.items():
            if k in ('what', 'where', 'proof', 'impact', 'severity'):
                out.append("%s: %s" % (k, v))
            else:
                out.extend(walk(v, depth + 1))
    elif isinstance(value, list):
        for v in value:
            out.extend(walk(v, depth + 1))
    return out


sections = []
for path in sorted(glob.glob(os.path.join(WF, "*", "journal.jsonl"))):
    run = os.path.basename(os.path.dirname(path))
    items = []
    with io.open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("type") != "result":
                continue
            label = rec.get("label") or rec.get("agentId") or "?"
            value = rec.get("value") if "value" in rec else rec.get("result")
            texts = walk(value)
            if texts:
                items.append((label, texts))
    if items:
        sections.append((run, items))

with io.open(OUT, "w", encoding="utf-8") as fh:
    fh.write("# Полная выжимка журналов воркфлоу\n\n")
    total = 0
    for run, items in sections:
        fh.write("## %s\n\n" % run)
        for label, texts in items:
            fh.write("### %s\n\n" % label)
            for t in texts:
                fh.write("- %s\n" % t.replace("\n", " ")[:1400])
                total += 1
            fh.write("\n")
    fh.write("\n---\n\nВсего пунктов: %d\n" % total)

print("runs:", len(sections), "items:", sum(len(i) for _, i in sections))
