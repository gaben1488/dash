"""orphan_snapshot.py — честный замер сирот в AEMR vault'е.

Идея:
  пройти все .md в vault кроме .obsidian/.trash/60-Graph/Templates/Attachments,
  посчитать для каждой incoming wikilinks ([[...]] и [[...|alias]]),
  выписать «сирот» (<2 inlinks) — отдельно с/без 70-Chat.

Запуск:
  python scripts/orphan_snapshot.py
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
EXCLUDE_DIRS = {".obsidian", ".trash", "60-Graph", "Templates", "Attachments"}

# [[Target]] или [[Target|alias]]; цепляем target до '|' или ']]'.
RE_LINK = re.compile(r"\[\[([^\]\|#]+)(?:#[^\]\|]+)?(?:\|[^\]]+)?\]\]")


def is_excluded(p: Path) -> bool:
    parts = set(p.relative_to(VAULT).parts)
    return bool(parts & EXCLUDE_DIRS)


def in_chat(p: Path) -> bool:
    return p.relative_to(VAULT).parts[0] == "70-Chat"


def normalise(name: str) -> str:
    """Привести target wikilink'а к stem'у (без .md, без пути)."""
    name = name.strip()
    if name.endswith(".md"):
        name = name[:-3]
    # Берём только последний сегмент пути (Obsidian резолвит по имени).
    return name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip().lower()


def main() -> int:
    if not VAULT.exists():
        print(f"[error] vault не найден: {VAULT}", file=sys.stderr)
        return 2

    files = [p for p in VAULT.rglob("*.md") if not is_excluded(p)]
    print(f"[scan] всего .md в vault'е (после фильтра): {len(files)}")

    by_stem: dict[str, list[Path]] = defaultdict(list)
    for p in files:
        by_stem[p.stem.lower()].append(p)

    inlinks: Counter[Path] = Counter()
    unresolved: Counter[str] = Counter()

    for src in files:
        try:
            txt = src.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        seen: set[Path] = set()
        for m in RE_LINK.findall(txt):
            target = normalise(m)
            if not target:
                continue
            hits = by_stem.get(target, [])
            if not hits:
                unresolved[target] += 1
                continue
            for tgt in hits:
                if tgt == src or tgt in seen:
                    continue
                seen.add(tgt)
                inlinks[tgt] += 1

    # Каждый файл должен присутствовать в Counter с 0 если ни одной ссылки.
    for p in files:
        inlinks.setdefault(p, 0)

    orphans_all = [p for p in files if inlinks[p] < 2]
    orphans_no_chat = [p for p in orphans_all if not in_chat(p)]
    orphans_only_chat = [p for p in orphans_all if in_chat(p)]

    by_top: Counter[str] = Counter()
    for p in orphans_all:
        by_top[p.relative_to(VAULT).parts[0]] += 1

    print()
    print(f"[total] orphans (<2 inlinks): {len(orphans_all)}")
    print(f"  └─ из них в 70-Chat:        {len(orphans_only_chat)}")
    print(f"  └─ вне 70-Chat:             {len(orphans_no_chat)}")
    print()
    print("[breakdown по top-folder]:")
    for folder, n in by_top.most_common():
        print(f"  {folder:25s} {n:>5}")
    print()
    print(f"[unresolved] уникальных broken-target: {len(unresolved)} "
          f"(топ-10 ниже)")
    for target, n in unresolved.most_common(10):
        print(f"  [{n:>3}] {target}")

    out = {
        "vault": str(VAULT),
        "files_scanned": len(files),
        "orphans_total": len(orphans_all),
        "orphans_in_chat": len(orphans_only_chat),
        "orphans_no_chat": len(orphans_no_chat),
        "by_top_folder": dict(by_top),
        "unresolved_top": unresolved.most_common(20),
        "sample_orphans_no_chat": [
            str(p.relative_to(VAULT)).replace("\\", "/")
            for p in orphans_no_chat[:30]
        ],
    }
    out_path = Path(__file__).resolve().parent.parent / "graphify-out" / "orphan_snapshot.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[json] {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
