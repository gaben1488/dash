#!/usr/bin/env python3
"""mulch_anchor_failures.py — build a SIDECAR anchor index for mulch failures.

Mulch's schema forbids extra fields (`must NOT have additional properties`), so anchors
live OUTSIDE the records, in memory/failure-anchors.json. Read-only over .mulch — never
mutates expertise records, so `ml validate` stays green. Idempotent: regenerate anytime.

Failures carry no file paths, so each anchor entry is match-TOKENS derived from the
record text (identifiers, file-stems, snake/camel parts, Cyrillic key-words).
surface_failures.py matches an edited file's path tokens (substring) against these to
surface the relevant past failure unprompted = the no-repeat-mistakes wire.

  python scripts/mulch_anchor_failures.py            # dry-run (prints proposed anchors)
  python scripts/mulch_anchor_failures.py --apply    # write memory/failure-anchors.json
"""
from __future__ import annotations
import sys, re, json, glob

sys.stdout.reconfigure(encoding="utf-8")
EXP = ".mulch/expertise/*.jsonl"
OUT = r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/failure-anchors.json"

STOP = {
    "aemr", "core", "server", "shared", "pipeline", "packages", "test", "tests",
    "index", "data", "page", "pages", "route", "routes", "component", "components",
    "src", "main", "dash", "file", "code", "this", "that", "with", "from", "have",
    "value", "values", "field", "fields", "type", "types", "record", "records",
    "которые", "которая", "который", "когда", "после", "перед", "через", "если",
    "поле", "поля", "файл", "файла", "файлы", "вместо", "только", "может",
}


def rtype(r: dict) -> str:
    return r.get("type") or r.get("recordType") or ""


def text_of(r: dict) -> str:
    parts = [r.get("title", ""), r.get("description", ""), r.get("resolution", ""),
             r.get("name", ""), r.get("content", ""), r.get("domain", "")]
    return " ".join(str(p) for p in parts if p)


def tokens(text: str) -> set[str]:
    out: set[str] = set()
    for ident in re.findall(r"[A-Za-z_][A-Za-z0-9_]+", text):
        if "_" in ident and len(ident) >= 4:
            out.add(ident.lower())
        for part in ident.split("_"):
            for w in re.findall(r"[A-Z]?[a-z]{3,}|[A-Z]{3,}", part):
                out.add(w.lower())
    for stem in re.findall(r"([A-Za-z][\w-]+)\.tsx?", text):
        out.add(stem.lower())
    for w in re.findall(r"[А-Яа-яЁё]{4,}", text):
        out.add(w.lower())
    return {t for t in out if len(t) >= 4 and t not in STOP}


def short(r: dict, n: int = 90) -> str:
    return (r.get("title") or r.get("description") or r.get("name") or "")[:n]


def main() -> None:
    apply = "--apply" in sys.argv
    entries = []
    for f in sorted(glob.glob(EXP)):
        domain = f.replace("\\", "/").split("/")[-1].replace(".jsonl", "")
        for line in open(f, encoding="utf-8"):
            s = line.strip()
            if not s:
                continue
            try:
                r = json.loads(s)
            except Exception:
                continue
            if rtype(r) != "failure":
                continue
            toks = tokens(text_of(r))
            if domain.startswith("aemr-"):
                toks.add(domain.split("aemr-")[1])
            anchors = sorted(toks)[:20]
            entries.append({
                "id": r.get("id", "?"),
                "domain": domain,
                "title": short(r),
                "resolution": (r.get("resolution") or "")[:200],
                "anchors": anchors,
            })
            if not apply:
                print(f"[{domain}] {r.get('id','?')}: {short(r,60)}")
                print(f"    anchors: {anchors}")
    if apply:
        open(OUT, "w", encoding="utf-8").write(json.dumps(entries, ensure_ascii=False, indent=1))
        print(f"[APPLIED] wrote {OUT}  ({len(entries)} failure anchor entries)")
    else:
        print(f"\n[DRY-RUN] {len(entries)} failure anchor entries (use --apply to write {OUT})")


if __name__ == "__main__":
    main()
