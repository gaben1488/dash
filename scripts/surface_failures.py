#!/usr/bin/env python3
"""surface_failures.py — no-repeat-mistakes wire.

Given an edited file path, surface past mulch FAILURES whose anchor tokens match the
path (substring both ways, so anchor `recon` matches `reconcile.ts`). Reads the sidecar
memory/failure-anchors.json (built by mulch_anchor_failures.py). Prints a Claude Code
PostToolUse hookSpecificOutput JSON so the matched failures are injected as context the
moment a relevant file is edited — unprompted. Prints nothing when no match (silent).

  python scripts/surface_failures.py packages/core/src/pipeline/reconcile.ts
"""
from __future__ import annotations
import sys, re, json

sys.stdout.reconfigure(encoding="utf-8")
IDX = r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/failure-anchors.json"
CAP = 5
STOP = {
    "aemr", "core", "server", "shared", "pipeline", "packages", "test", "tests",
    "index", "data", "src", "main", "dash", "page", "pages", "route", "routes",
    "component", "components", "node_modules", "users", "filat",
}


def path_tokens(path: str) -> set[str]:
    out: set[str] = set()
    for ident in re.findall(r"[A-Za-z_][A-Za-z0-9_]+", path):
        for w in re.findall(r"[A-Z]?[a-z]{3,}|[A-Z]{3,}", ident):
            out.add(w.lower())
        if "_" in ident and len(ident) >= 4:
            out.add(ident.lower())
    return {t for t in out if len(t) >= 4 and t not in STOP}


def score_anchor(ptok: str, anchor: str) -> int:
    # exact path-token==anchor ranks above incidental substring (reconcile > recon-in-text)
    if ptok == anchor:
        return 10 + len(anchor)
    if len(ptok) >= 4 and ptok in anchor:
        return len(ptok)
    if len(anchor) >= 4 and anchor in ptok:
        return len(anchor)
    return 0


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else ""
    if not path:
        return
    ptoks = path_tokens(path)
    if not ptoks:
        return
    try:
        entries = json.load(open(IDX, encoding="utf-8"))
    except Exception:
        return
    hits = []
    for e in entries:
        sc = 0
        matched = set()
        for pt in ptoks:
            for a in e.get("anchors", []):
                s = score_anchor(pt, a)
                if s:
                    sc += s
                    matched.add(a)
        if sc:
            hits.append((sc, e, sorted(matched)))
    if not hits:
        return
    hits.sort(key=lambda h: -h[0])
    lines = []
    for _, e, ov in hits[:CAP]:
        res = e["resolution"] or "(см. запись)"
        lines.append(f"• [{e['id']}] {e['title']} — РЕШЕНИЕ: {res} (match: {', '.join(ov[:4])})")
    ctx = ("⚠ Прошлые ОШИБКИ на похожем файле (mulch failures, не повторять) — "
           + f"редактируется {path}:\n" + "\n".join(lines))
    out = {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": ctx}}
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
