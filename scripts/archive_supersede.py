"""Wire superseded_by pointers from archive notes to their live successors.

Strategy (per open-question #0 brainstorm):
  S1 Timeline-proximity  — for each archive file with date X and topic T,
                           find nearest live note on topic T after date X.
  S2 Name-token overlap  — score candidates by shared rare tokens in filename.
  S4 Content-hash quotes — bonus if any 200-char chunk from archive appears
                           verbatim in the candidate (high-confidence signal).

Writes two-way link:
  archive:   superseded_by:       ["[[live/...]]"]
             superseded_on:       YYYY-MM-DD
             superseded_confidence: 0.xx
  live:      supersedes:          ["[[archive/...]]"]

Both changes wrapped in `<!-- AUTO:supersede:v1 START/END -->` markers for idempotence.

USAGE
  python scripts/archive_supersede.py            # dry-run (default)
  python scripts/archive_supersede.py --apply    # write changes
  python scripts/archive_supersede.py --min-confidence 0.5
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

MEMORY = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory")
ARCHIVE = MEMORY / "archive"

DATE_RE = re.compile(r'(20\d\d)[-_](\d\d)[-_](\d\d)')
FM_RE = re.compile(r'^---\n(.*?)\n---\n', re.DOTALL)
MARKER_ARCH = '<!-- AUTO:supersede:v1 '
QUOTE_LEN = 160
STOP_TOKENS = {'md', 'and', 'the', 'for', 'of', 'in', 'on', 'a',
               'session', 'audit', 'report', 'notes', 'note',
               'design', 'feedback', 'analysis', 'plan', 'index',
               'new', 'final', 'v1', 'v2', 'v3', 'v4', 'part', 'full',
               'to', 'is', 'an'}


def tokenize(name: str) -> set[str]:
    # strip date, numbers, common noise
    stem = Path(name).stem.lower()
    stem = DATE_RE.sub('', stem)
    toks = re.split(r'[_\-\s\.]+', stem)
    return {t for t in toks if len(t) > 2 and t not in STOP_TOKENS and not t.isdigit()}


def extract_date(path: Path) -> date | None:
    m = DATE_RE.search(path.name)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    try:
        text = path.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return None
    fm = FM_RE.match(text)
    if fm:
        for line in fm.group(1).split('\n'):
            if ':' in line:
                key, _, val = line.partition(':')
                if key.strip() in ('date', 'created', 'updated'):
                    m2 = DATE_RE.search(val)
                    if m2:
                        try:
                            return date(int(m2.group(1)), int(m2.group(2)), int(m2.group(3)))
                        except ValueError:
                            continue
    return None


def strip_markers(text: str, marker: str) -> str:
    pat = re.compile(
        rf'\n?{re.escape(marker)}START -->\n.*?{re.escape(marker)}END -->\n?',
        re.DOTALL,
    )
    return pat.sub('\n', text)


def candidates_for(arch_file: Path, live_files: list[Path],
                   arch_date: date | None) -> list[tuple[Path, float]]:
    arch_tokens = tokenize(arch_file.name)
    if not arch_tokens:
        return []
    try:
        arch_text = arch_file.read_text(encoding='utf-8', errors='replace')
    except OSError:
        arch_text = ''
    # sample chunks for quote-match
    quotes = []
    body = FM_RE.sub('', arch_text)
    for i in range(0, min(len(body), 4000), 500):
        chunk = body[i:i + QUOTE_LEN].strip()
        if len(chunk) >= 100:
            quotes.append(chunk)

    scored = []
    for live in live_files:
        live_tokens = tokenize(live.name)
        if not live_tokens:
            continue
        overlap = len(arch_tokens & live_tokens)
        if overlap < 2:
            continue
        # S2 score
        score = overlap / max(len(arch_tokens | live_tokens), 1)  # Jaccard
        # S1 boost: live is AFTER arch_date
        if arch_date:
            live_date = extract_date(live)
            if live_date:
                delta_days = (live_date - arch_date).days
                if delta_days >= 0:
                    # closer = better, cap at 90d
                    score += 0.15 * max(0, 1 - delta_days / 90)
                else:
                    score -= 0.2  # penalize older successors
        # S4 quote bonus
        if quotes:
            try:
                live_text = live.read_text(encoding='utf-8', errors='replace')
                for q in quotes[:3]:
                    if q in live_text:
                        score += 0.25
                        break
            except OSError:
                pass
        if score > 0:
            scored.append((live, round(score, 3)))
    scored.sort(key=lambda t: -t[1])
    return scored[:3]


def insert_frontmatter_keys(text: str, keys: dict[str, str]) -> str:
    """Idempotent: update or add keys in frontmatter. Wraps in marker block."""
    fm = FM_RE.match(text)
    marker_start = f"{MARKER_ARCH}START -->"
    marker_end = f"{MARKER_ARCH}END -->"
    # Remove any old auto-block in frontmatter
    if fm:
        fm_body = fm.group(1)
        # strip prior auto lines
        lines = [ln for ln in fm_body.split('\n')
                 if not ln.startswith(tuple(keys.keys()))]
        lines += [f"{k} {v}" for k, v in keys.items()]
        new_fm = '---\n' + '\n'.join(lines) + '\n---\n'
        rest = text[fm.end():]
        return new_fm + rest
    # No frontmatter — prepend one
    lines = [f"{k} {v}" for k, v in keys.items()]
    return '---\n' + '\n'.join(lines) + '\n---\n\n' + text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--min-confidence', type=float, default=0.35)
    args = ap.parse_args()

    if not ARCHIVE.exists():
        print(f"NO archive/ dir at {ARCHIVE}")
        sys.exit(0)

    arch_files = [p for p in ARCHIVE.rglob('*.md') if p.is_file()]
    live_files = [p for p in MEMORY.rglob('*.md')
                  if p.is_file() and 'archive' not in p.parts]

    print(f"archive: {len(arch_files)} files")
    print(f"live:    {len(live_files)} files\n")

    proposals = []  # (arch, live, conf)
    for arch in arch_files:
        arch_date = extract_date(arch)
        cands = candidates_for(arch, live_files, arch_date)
        for live, score in cands:
            if score >= args.min_confidence:
                proposals.append((arch, live, score))
                break  # only top-1 supersession

    proposals.sort(key=lambda t: -t[2])

    print(f"=== PROPOSALS (min confidence {args.min_confidence}, {len(proposals)}) ===\n")
    for arch, live, conf in proposals[:20]:
        print(f"  {conf:.2f}  {arch.relative_to(MEMORY)}")
        print(f"         -> [[{live.stem}]]")

    if not args.apply:
        print(f"\n[DRY-RUN] {len(proposals)} archive files would get superseded_by.")
        print(f"         Run with --apply to write.")
        return

    # Apply
    today = date.today().isoformat()
    live_reverse: dict[Path, list[Path]] = {}
    for arch, live, conf in proposals:
        # Archive: add superseded_by
        arch_text = arch.read_text(encoding='utf-8', errors='replace')
        arch_text = strip_markers(arch_text, MARKER_ARCH)
        new_text = insert_frontmatter_keys(arch_text, {
            'superseded_by:': f'["[[{live.stem}]]"]',
            'superseded_on:': today,
            'superseded_confidence:': f'{conf:.2f}',
        })
        # banner near top
        banner = (f"\n> [!archived] Superseded by [[{live.stem}]] "
                  f"(confidence {conf:.2f}, {today}). Held for historical context.\n")
        # add banner after frontmatter if not present
        if '> [!archived]' not in new_text:
            fm = FM_RE.match(new_text)
            if fm:
                new_text = new_text[:fm.end()] + banner + new_text[fm.end():]
        arch.write_text(new_text, encoding='utf-8')
        live_reverse.setdefault(live, []).append(arch)

    # Live: add supersedes list
    for live, archs in live_reverse.items():
        live_text = live.read_text(encoding='utf-8', errors='replace')
        live_text = strip_markers(live_text, MARKER_ARCH)
        sup_list = ', '.join(f'"[[archive/{a.stem}]]"' for a in archs)
        live_text = insert_frontmatter_keys(live_text, {
            'supersedes:': f'[{sup_list}]',
        })
        live.write_text(live_text, encoding='utf-8')

    print(f"\n[APPLIED] {len(proposals)} archive files marked superseded; "
          f"{len(live_reverse)} live files got 'supersedes:' list.")


if __name__ == '__main__':
    main()
