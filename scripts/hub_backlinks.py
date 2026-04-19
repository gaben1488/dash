"""Hub backlinks — дополняет orphan-linker v1.

Проблема: link_orphans_by_date.py добавляет в orphan ссылки на хабы
(outlinks). Это НЕ убирает сироту из списка orphan в Obsidian — для
этого нужны inlinks К сироте.

Решение: для каждого хаба (ноты с высокой степенью in-link) создаём
секцию «Связанные за дату», куда подшиваем список сирот той же даты.
Так у каждой сироты появляется как минимум один inlink от хаба.

Эвристики:
- Хабы: топ-15 нот по количеству inlinks в vault (кроме 70-Chat и пр.).
- Для каждого хаба: ноты той же даты, у которых <3 inlinks (сироты).
- Группируем по дате, добавляем секцию `## Связанные записи`.
- Ограничение: максимум 8 сирот на одну дату в хабе.
- Wrap в `<!-- AUTO:hub-backlink:v1 START --> ... END -->`, идемпотентно.

Запуск:
  python scripts/hub_backlinks.py              # dry-run
  python scripts/hub_backlinks.py --apply      # писать
  python scripts/hub_backlinks.py --top-hubs 20 --max-per-date 10
"""
from __future__ import annotations
import argparse, re, sys
from pathlib import Path
from collections import defaultdict, Counter

sys.stdout.reconfigure(encoding='utf-8')

VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
SKIP_DIRS = {'.obsidian', '.trash', '.git', 'Attachments', '60-Graph',
             'Templates', '70-Chat'}
FM_RE = re.compile(r'^---\n(.*?)\n---\n', re.DOTALL)
DATE_NAME_RE = re.compile(r'(20\d\d)[-_](\d\d)[-_](\d\d)')
WIKILINK_RE = re.compile(r'\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]')
MARKER = 'AUTO:hub-backlink:v1'
BLOCK_RE = re.compile(
    rf'\n?<!-- {MARKER} START -->.*?<!-- {MARKER} END -->\n?',
    re.DOTALL,
)


def is_skipped(p: Path) -> bool:
    try:
        rel = p.relative_to(VAULT).parts
    except ValueError:
        return True
    return any(part in SKIP_DIRS for part in rel)


def extract_date(p: Path, text: str) -> str | None:
    m = DATE_NAME_RE.search(p.stem)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    fm = FM_RE.match(text)
    if not fm:
        return None
    for line in fm.group(1).split('\n'):
        for k in ('date:', 'created:', 'updated:'):
            if line.strip().startswith(k):
                v = line.partition(':')[2].strip().strip('"\'')
                dm = DATE_NAME_RE.search(v)
                if dm:
                    return f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--top-hubs', type=int, default=15)
    ap.add_argument('--max-per-date', type=int, default=8)
    args = ap.parse_args()

    notes = []
    stem_to_path: dict[str, Path] = {}
    for p in VAULT.rglob('*.md'):
        if is_skipped(p):
            continue
        try:
            txt = p.read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue
        stem_to_path[p.stem] = p
        date = extract_date(p, txt)
        outlinks = [m.group(1).strip() for m in WIKILINK_RE.finditer(txt)]
        notes.append({'path': p, 'stem': p.stem, 'text': txt,
                      'date': date, 'outlinks': outlinks})

    # Count inlinks per note stem
    inlink_count: Counter[str] = Counter()
    for n in notes:
        for link in n['outlinks']:
            target = link.split('/')[-1]
            inlink_count[target] += 1

    # Hubs = top-N by inlinks
    hubs = [stem for stem, _ in inlink_count.most_common(args.top_hubs)
            if stem in stem_to_path]
    print(f"Hubs (top {args.top_hubs}):")
    for h in hubs:
        print(f"  {inlink_count[h]:3} inlinks · {h}")

    # Group orphans by date
    orphans_by_date: dict[str, list[Path]] = defaultdict(list)
    for n in notes:
        if n['date'] and inlink_count[n['stem']] < 3:
            orphans_by_date[n['date']].append(n['path'])

    # For each hub, find its date (if any) and attach that day's orphans
    hub_dates: dict[str, str | None] = {}
    for h in hubs:
        hp = stem_to_path[h]
        for n in notes:
            if n['path'] == hp:
                hub_dates[h] = n['date']
                break

    actions = 0
    touched = 0
    for h in hubs:
        hp = stem_to_path[h]
        # Candidate dates: hub's own date + top-3 most populated orphan-dates
        dates_to_link = set()
        if hub_dates.get(h):
            dates_to_link.add(hub_dates[h])
        top_dates = sorted(orphans_by_date.keys(),
                           key=lambda d: -len(orphans_by_date[d]))[:3]
        dates_to_link.update(top_dates)

        lines = [f"<!-- {MARKER} START -->",
                 "## Связанные записи (авто)", ""]
        any_added = False
        for d in sorted(dates_to_link):
            orphans = [p for p in orphans_by_date.get(d, [])
                       if p != hp][:args.max_per-date if False else args.max_per_date]
            if not orphans:
                continue
            any_added = True
            lines.append(f"### {d}")
            for op in orphans:
                rel = op.relative_to(VAULT).with_suffix('').as_posix()
                lines.append(f"- [[{rel}|{op.stem}]]")
                actions += 1
            lines.append("")
        lines.append(f"<!-- {MARKER} END -->")

        if not any_added:
            continue

        new_block = '\n' + '\n'.join(lines) + '\n'
        old_text = stem_to_path[h].read_text(encoding='utf-8', errors='replace')
        cleaned = BLOCK_RE.sub('\n', old_text)
        new_text = cleaned.rstrip() + new_block

        if new_text != old_text:
            touched += 1
            if args.apply:
                hp.write_text(new_text, encoding='utf-8')

    print(f"\n{'APPLIED' if args.apply else 'DRY-RUN'}: "
          f"hubs touched={touched}, total backlinks={actions}")


if __name__ == '__main__':
    main()
