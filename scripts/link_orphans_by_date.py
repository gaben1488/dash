"""Link orphan notes in the AEMR vault via safe heuristics.

Implements H1 + H2 + H6:
  H1  Same date-code (filename `_YYYY_MM_DD` / `_YYYY-MM-DD` OR frontmatter
      `date:` / `created:` / `updated:`): group same-day notes. Orphans in a
      group get a "Co-created" section linking up to 5 hub-like peers
      (peers ranked by in-link count in the whole vault).
  H2  Folder co-location: orphan gets a "Folder" back-link to the nearest
      `_index.md` / `MOC.md` / `README.md` / `Home.md` in an ancestor dir.
  H6  Existing frontmatter `related:` wikilinks that point to missing notes
      are reported (not auto-fixed; surfaces stale refs).

Safety:
- Dry-run default. `--apply` to write.
- Every inserted block wrapped in `<!-- AUTO:orphan-link:v1 START -->` /
  `<!-- AUTO:orphan-link:v1 END -->` markers → idempotent rewrite.
- Skips notes that already have >=3 incoming wikilinks (not orphans).
- Skips `.obsidian`, `.trash`, `.git`, `Attachments`, `60-Graph`, `Templates`.
- Caps: max 5 H1 links + 1 H2 link per note.
- Requires 2+ signals OR explicit date-code to trigger H1.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
SKIP_DIRS = {'.obsidian', '.trash', '.git', 'Attachments', '60-Graph', 'Templates', '70-Chat'}

FM_RE = re.compile(r'^---\n(.*?)\n---\n', re.DOTALL)
DATE_IN_NAME = re.compile(r'_(20\d\d)[-_](\d\d)[-_](\d\d)')
WIKILINK_RE = re.compile(r'\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]')
FM_DATE_KEYS = ('date:', 'created:', 'updated:')
MOC_NAMES = ('_index.md', 'index.md', 'MOC.md', 'README.md', 'Home.md')

AUTO_BLOCK_RE = re.compile(
    r'\n?<!-- AUTO:orphan-link:v1 START -->.*?<!-- AUTO:orphan-link:v1 END -->\n?',
    re.DOTALL,
)

MIN_INLINKS_FOR_NOT_ORPHAN = 3
MAX_H1_LINKS = 5


def is_skipped(p: Path) -> bool:
    try:
        rel = p.relative_to(VAULT).parts
    except ValueError:
        return True
    return any(part in SKIP_DIRS for part in rel)


def parse_frontmatter(txt: str) -> tuple[dict, int]:
    """Return (fm_dict, end_offset). Naive line-based parser."""
    m = FM_RE.match(txt)
    if not m:
        return {}, 0
    fm: dict = {}
    for line in m.group(1).split('\n'):
        if ':' in line and not line.startswith((' ', '\t', '-')):
            k, _, v = line.partition(':')
            fm[k.strip()] = v.strip()
    return fm, m.end()


def extract_date(name_stem: str, fm: dict) -> str | None:
    m = DATE_IN_NAME.search(name_stem)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    for k in ('date', 'created', 'updated'):
        v = fm.get(k)
        if v:
            vm = re.match(r'(20\d\d)[-_/](\d\d)[-_/](\d\d)', v.strip().strip('"\''))
            if vm:
                return f"{vm.group(1)}-{vm.group(2)}-{vm.group(3)}"
    return None


def extract_wikilinks(body: str) -> list[str]:
    return [m.group(1).strip() for m in WIKILINK_RE.finditer(body)]


def find_folder_moc(note_path: Path) -> Path | None:
    cur = note_path.parent
    while cur != VAULT and cur.is_relative_to(VAULT):
        for name in MOC_NAMES:
            cand = cur / name
            if cand.exists() and cand != note_path:
                return cand
        cur = cur.parent
    return None


def scan_vault():
    notes = []  # list of dicts
    stem_to_path: dict[str, Path] = {}
    for p in VAULT.rglob('*.md'):
        if is_skipped(p):
            continue
        try:
            txt = p.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue
        fm, fm_end = parse_frontmatter(txt)
        body = txt[fm_end:]
        date = extract_date(p.stem, fm)
        outlinks = extract_wikilinks(body)
        notes.append({
            'path': p,
            'stem': p.stem,
            'fm': fm,
            'fm_end': fm_end,
            'body': body,
            'text': txt,
            'date': date,
            'outlinks': outlinks,
        })
        stem_to_path[p.stem] = p
    return notes, stem_to_path


def build_inlinks(notes, stem_to_path):
    """Резолвер wikilink → путь: сначала пробует целевой стринг as-is,
    потом как last segment пути (для `[[sub/dir/note]]` формы)."""
    inlinks: dict[Path, list[Path]] = defaultdict(list)
    for n in notes:
        for target in n['outlinks']:
            tpath = stem_to_path.get(target)
            if tpath is None:
                stem = target.rstrip('/').rsplit('/', 1)[-1]
                tpath = stem_to_path.get(stem)
            if tpath and tpath != n['path']:
                inlinks[tpath].append(n['path'])
    return inlinks


def classify(notes, inlinks):
    totals = {
        'total': len(notes),
        'with_date_name': 0,
        'with_fm_date': 0,
        'orphan': 0,
        'orphan_with_date': 0,
        'orphan_no_signal': 0,
    }
    orphans = []
    for n in notes:
        name_has_date = bool(DATE_IN_NAME.search(n['stem']))
        if name_has_date:
            totals['with_date_name'] += 1
        if any(k in n['fm'] for k in ('date', 'created', 'updated')):
            totals['with_fm_date'] += 1
        incount = len(inlinks.get(n['path'], []))
        is_orphan = incount < MIN_INLINKS_FOR_NOT_ORPHAN
        if is_orphan:
            totals['orphan'] += 1
            if n['date']:
                totals['orphan_with_date'] += 1
            has_folder_moc = find_folder_moc(n['path']) is not None
            if not n['date'] and not has_folder_moc:
                totals['orphan_no_signal'] += 1
            orphans.append(n)
    return totals, orphans


def plan_links(notes, orphans, inlinks, stem_to_path):
    by_date: dict[str, list] = defaultdict(list)
    for n in notes:
        if n['date']:
            by_date[n['date']].append(n)

    plans = []
    broken_related_reports = []
    for orphan in orphans:
        h1_links: list[str] = []
        if orphan['date']:
            peers = [p for p in by_date[orphan['date']] if p['path'] != orphan['path']]
            peers.sort(key=lambda p: -len(inlinks.get(p['path'], [])))
            h1_links = [p['stem'] for p in peers[:MAX_H1_LINKS]]

        h2_link = None
        moc = find_folder_moc(orphan['path'])
        if moc:
            h2_link = moc.stem

        # H6: broken related
        related_raw = orphan['fm'].get('related', '')
        if related_raw:
            for m in re.finditer(r'\[\[([^\]|#]+)', related_raw):
                tgt = m.group(1).strip()
                if tgt not in stem_to_path:
                    broken_related_reports.append((orphan['path'], tgt))

        if h1_links or h2_link:
            plans.append({
                'orphan': orphan,
                'h1': h1_links,
                'h2': h2_link,
            })
    return plans, broken_related_reports


def render_block(h1: list[str], h2: str | None) -> str:
    lines = ['', '<!-- AUTO:orphan-link:v1 START -->', '## Related (auto-linked)']
    if h1:
        lines.append('')
        lines.append('**Co-created (same date):**')
        for stem in h1:
            lines.append(f'- [[{stem}]]')
    if h2:
        lines.append('')
        lines.append(f'**Folder MOC:** [[{h2}]]')
    lines.append('<!-- AUTO:orphan-link:v1 END -->')
    lines.append('')
    return '\n'.join(lines)


def apply_plan(plan, write: bool) -> bool:
    orphan = plan['orphan']
    txt = orphan['text']
    stripped = AUTO_BLOCK_RE.sub('\n', txt)
    block = render_block(plan['h1'], plan['h2'])
    if not stripped.endswith('\n'):
        stripped += '\n'
    new_txt = stripped.rstrip() + '\n' + block
    if new_txt == txt:
        return False
    if write:
        orphan['path'].write_text(new_txt, encoding='utf-8')
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='Write changes (default dry-run).')
    ap.add_argument('--top', type=int, default=10, help='Top-N strongest proposals to print.')
    args = ap.parse_args()

    print(f"Scanning {VAULT} ...")
    notes, stem_to_path = scan_vault()
    inlinks = build_inlinks(notes, stem_to_path)
    totals, orphans = classify(notes, inlinks)

    print("\n=== CLASSIFICATION ===")
    for k, v in totals.items():
        print(f"  {k:24s} {v}")

    plans, broken_related = plan_links(notes, orphans, inlinks, stem_to_path)

    print(f"\n=== PLAN ({len(plans)} orphans would be linked) ===")
    # Strength score: #h1_links * inlinks_of_top_peer + (1 if h2 else 0)
    def strength(pl):
        peer_in = 0
        if pl['h1']:
            top = stem_to_path.get(pl['h1'][0])
            peer_in = len(inlinks.get(top, [])) if top else 0
        return len(pl['h1']) * (peer_in + 1) + (1 if pl['h2'] else 0)
    plans.sort(key=strength, reverse=True)

    print(f"\n=== TOP {args.top} STRONGEST PROPOSALS ===")
    for pl in plans[:args.top]:
        rel = pl['orphan']['path'].relative_to(VAULT)
        h1_preview = ', '.join(pl['h1'][:3]) + ('...' if len(pl['h1']) > 3 else '')
        print(f"  {rel}")
        print(f"    date={pl['orphan']['date']}  H1=[{h1_preview}]  H2={pl['h2']}")

    changed = 0
    for pl in plans:
        if apply_plan(pl, write=args.apply):
            changed += 1

    print(f"\n=== SUMMARY ===")
    print(f"  plans generated : {len(plans)}")
    print(f"  would modify    : {changed}")
    print(f"  broken related  : {len(broken_related)} (H6 report-only)")
    if broken_related[:5]:
        print("  sample broken related:")
        for src, tgt in broken_related[:5]:
            print(f"    {src.relative_to(VAULT)}  ->  [[{tgt}]]")

    if args.apply:
        print("\n[APPLIED]")
    else:
        print("\n[DRY-RUN] re-run with --apply to write.")


if __name__ == '__main__':
    main()
