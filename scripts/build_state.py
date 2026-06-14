#!/usr/bin/env python3
"""build_state.py — single machine-derived source of truth for AEMR live numbers.

Read-only over HEAD. Emits memory/00-STATE.md. Every field here is DERIVED by a
command from the working tree — never hand-typed. If a number you want has no
deriver below, it does not belong in 00-STATE.md (put it in a passport as prose).

Frontmatter carries git_sha; if git_sha != current HEAD the file is STALE and
must be regenerated. MEMORY.md links here instead of inlining counts (which rot).

Usage:  python scripts/build_state.py
"""
from __future__ import annotations
import json
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent  # C:/Users/filat/dash
MEM = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory")
OUT = MEM / "00-STATE.md"


def sh(*args: str) -> str:
    try:
        return subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=30).stdout.strip()
    except Exception:
        return ""


def git_sha() -> str:
    return sh("git", "rev-parse", "--short", "HEAD") or "unknown"


def count_glob(rel: str, pattern: str, exclude: tuple[str, ...] = ()) -> int:
    base = REPO / rel
    if not base.exists():
        return 0
    n = 0
    for p in base.rglob(pattern):
        if any(x in p.name for x in exclude):
            continue
        n += 1
    return n


def count_pattern_in_files(rel: str, glob: str, needle: str) -> int:
    base = REPO / rel
    if not base.exists():
        return 0
    total = 0
    for p in base.rglob(glob):
        try:
            total += p.read_text(encoding="utf-8", errors="ignore").count(needle)
        except Exception:
            pass
    return total


def big_files(min_loc: int = 1000) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    base = REPO / "packages"
    if not base.exists():
        return out
    for p in base.rglob("*.ts*"):
        if "node_modules" in p.parts or ".d.ts" in p.name:
            continue
        try:
            loc = sum(1 for _ in p.open(encoding="utf-8", errors="ignore"))
        except Exception:
            continue
        if loc >= min_loc:
            out.append((str(p.relative_to(REPO)).replace("\\", "/"), loc))
    return sorted(out, key=lambda t: -t[1])


def mulch_stats() -> tuple[int, dict[str, int], Counter]:
    d = REPO / ".mulch" / "expertise"
    per_domain: dict[str, int] = {}
    types: Counter = Counter()
    total = 0
    if not d.exists():
        return 0, per_domain, types
    for f in sorted(d.glob("*.jsonl")):
        n = 0
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            n += 1
            total += 1
            t = rec.get("type") or rec.get("recordType") or "unknown"
            types[t] += 1
        per_domain[f.stem] = n
    return total, per_domain, types


def memory_root_md() -> int:
    return len(list(MEM.glob("*.md")))


def main() -> None:
    sha = git_sha()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    tables = count_pattern_in_files("packages", "*.ts", "sqliteTable(")
    dicts = count_glob("packages/shared/src/dictionaries", "*.ts", exclude=("index", ".test."))
    pages = count_glob("packages/web/src/pages", "*.tsx", exclude=(".test.",))
    routes = count_glob("packages/server/src/routes", "*.ts", exclude=(".test.",))
    components = count_glob("packages/web/src/components", "*.tsx", exclude=(".test.",))
    test_files = count_glob("packages", "*.test.ts", exclude=()) + count_glob("packages", "*.test.tsx", exclude=())
    bigs = big_files()
    mulch_total, mulch_dom, mulch_types = mulch_stats()
    mem_md = memory_root_md()

    big_rows = "\n".join(f"| `{p}` | {loc} |" for p, loc in bigs[:15]) or "| (нет файлов >1000 LOC) | — |"
    dom_rows = "\n".join(f"| {k} | {v} |" for k, v in sorted(mulch_dom.items())) or "| (нет) | — |"
    type_rows = "\n".join(f"| {k} | {v} |" for k, v in sorted(mulch_types.items())) or "| (нет) | — |"

    md = f"""---
type: state-derived
generated: {now}
git_sha: {sha}
generator: scripts/build_state.py
note: "ЕДИНСТВЕННЫЙ источник живых чисел AEMR. Все значения деривятся из HEAD командой, не вписываются руками. Если git_sha != текущий HEAD — файл STALE, перегенерировать: python scripts/build_state.py"
---

# 00-STATE — машинно-выведенное состояние AEMR

> Числа здесь — производные от кода на `{sha}`. Не редактировать руками.
> `MEMORY.md` и паспорта ссылаются сюда вместо инлайна цифр (те гниют).

## Код (packages/)

| Метрика | Значение | Деривер |
|---|---|---|
| drizzle-таблицы (`sqliteTable(`) | {tables} | grep packages/**/*.ts |
| словари (shared/dictionaries) | {dicts} | glob *.ts |
| страницы web (pages/*.tsx) | {pages} | glob *.tsx |
| компоненты web (components/*.tsx) | {components} | glob *.tsx |
| роуты server (routes/*.ts) | {routes} | glob *.ts |
| тест-файлы (*.test.ts[x]) | {test_files} | glob |

## Файлы > 1000 LOC (кандидаты на split)

| Файл | LOC |
|---|---|
{big_rows}

## Mulch expertise (.mulch/expertise/)

Всего записей: **{mulch_total}** в {len(mulch_dom)} доменах.

| Домен | Записей |
|---|---|
{dom_rows}

| Тип | Записей |
|---|---|
{type_rows}

## Память (memory/ root)

| Метрика | Значение |
|---|---|
| .md файлов в memory/ root | **{mem_md}** |

> Историческая `MEMORY.md`-цифра «13 root-файлов» — фикция; реальное число выше.
"""
    OUT.write_text(md, encoding="utf-8")
    print(f"[build_state] wrote {OUT}")
    print(f"[build_state] git_sha={sha} tables={tables} dicts={dicts} pages={pages} "
          f"routes={routes} components={components} tests={test_files} "
          f"bigfiles={len(bigs)} mulch={mulch_total} mem_md={mem_md}")


if __name__ == "__main__":
    main()
