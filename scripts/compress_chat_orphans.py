"""Compress noisy chat-orphan files from Obsidian vault into gzipped archive.

Strategy — separate wheat from chaff in 70-Chat/raw-verbatim:
  Category B1  — <task-notification> for background commands w/o <result>
  Category B2  — Stop-hook feedback / System-injected / "Task stopped"
  Category B3  — Very short files (< 300 bytes) with no semantic content

For each moved file we gzip it into 70-Chat/archive-compressed/YYYY-MM/
and drop a breadcrumb .index.json so the original filename can be recovered.

Never touches:
  - raw-verbatim files containing <result> with > 500 chars
  - session-continuations/
  - responses/  (already atomized w/ frontmatter)
  - messages/   (user messages, always kept)
  - chains/     (complex — requires per-chunk analysis, skip for now)

USAGE
  python scripts/compress_chat_orphans.py                # dry-run (default)
  python scripts/compress_chat_orphans.py --apply        # really move + gzip
  python scripts/compress_chat_orphans.py --verbose      # list every candidate
  python scripts/compress_chat_orphans.py --max 50       # process only first 50

SAFETY
  - Dry-run default. Prints summary table, does nothing.
  - --apply requires interactive confirmation if > 100 files.
  - Every move is reversible: see archive-compressed/<ym>/.index.json
  - Never deletes; only moves.
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/70-Chat")
RAW = VAULT / "raw-verbatim"
ARCHIVE = VAULT / "archive-compressed"

# Regex signatures for noise detection
RE_TASK_NOTIF_OPEN = re.compile(r"<task-notification>")
RE_RESULT_BLOCK = re.compile(r"<result>(.*?)</result>", re.DOTALL)
RE_BACKGROUND_CMD = re.compile(r'Background command ".*?" completed', re.IGNORECASE)
RE_STOP_HOOK = re.compile(r"^\s*Stop hook feedback\b", re.IGNORECASE)
RE_INTERRUPTED = re.compile(r"\[Request interrupted by user")
RE_TASK_STOPPED = re.compile(r"\bTask stopped\b|\bSystem notification\b", re.IGNORECASE)

MIN_RESULT_LEN = 500    # <result>…</result> shorter than this doesn't save the file
MIN_FILE_LEN = 300      # files shorter than this with no <result> → noise candidate

DATE_RE = re.compile(r'(20\d\d)-(\d\d)-\d\d')


def classify(path: Path) -> tuple[str, str]:
    """Return (verdict, reason).

    verdict ∈ {"KEEP", "COMPRESS"}.
    reason — one-line explanation for the summary table.
    """
    try:
        raw = path.read_text(encoding='utf-8', errors='replace')
    except OSError as exc:
        return "KEEP", f"unreadable: {exc}"

    size = len(raw)

    # Rule 1: if <result> block with > MIN_RESULT_LEN — KEEP unconditionally.
    m = RE_RESULT_BLOCK.search(raw)
    if m and len(m.group(1).strip()) >= MIN_RESULT_LEN:
        return "KEEP", f"has <result> {len(m.group(1))} chars"

    # Rule 2: background-command notification without meaningful result → COMPRESS (AP-07)
    if RE_TASK_NOTIF_OPEN.search(raw) and RE_BACKGROUND_CMD.search(raw):
        if not m or len(m.group(1).strip()) < 200:
            return "COMPRESS", "bg-cmd notification w/o result"

    # Rule 3: Stop-hook feedback — COMPRESS
    if RE_STOP_HOOK.search(raw[:200]):
        return "COMPRESS", "Stop hook feedback"

    # Rule 4: Request interrupted — COMPRESS (system noise)
    if RE_INTERRUPTED.search(raw) and size < 500:
        return "COMPRESS", "interrupted (tiny)"

    # Rule 5: very short + no <result> + only XML wrapper → COMPRESS
    if size < MIN_FILE_LEN and RE_TASK_NOTIF_OPEN.search(raw) and not m:
        return "COMPRESS", f"tiny notification wrapper ({size} bytes)"

    # Rule 6: Task stopped / System notification markers
    if RE_TASK_STOPPED.search(raw[:300]) and size < 500:
        return "COMPRESS", "Task stopped marker"

    # Default: KEEP (safety — unknown content better stays)
    return "KEEP", f"default keep ({size} bytes)"


def month_bucket(path: Path) -> str:
    m = DATE_RE.search(path.name)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return "unknown"


def gzip_move(src: Path, dst_dir: Path) -> Path:
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst_gz = dst_dir / (src.name + ".gz")
    with src.open("rb") as fin, gzip.open(dst_gz, "wb", compresslevel=9) as fout:
        shutil.copyfileobj(fin, fout)
    src.unlink()
    return dst_gz


def update_index(dst_dir: Path, entry: dict) -> None:
    idx_path = dst_dir / ".index.json"
    try:
        idx = json.loads(idx_path.read_text(encoding='utf-8')) if idx_path.exists() else []
    except Exception:
        idx = []
    idx.append(entry)
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=2), encoding='utf-8')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually move files (default: dry-run)")
    ap.add_argument("--verbose", action="store_true", help="list every candidate")
    ap.add_argument("--max", type=int, default=0, help="process only first N (0 = all)")
    ap.add_argument("--target", default="raw-verbatim",
                    choices=["raw-verbatim"],
                    help="subfolder to scan (only raw-verbatim supported today)")
    args = ap.parse_args()

    target = VAULT / args.target
    if not target.is_dir():
        print(f"FATAL: target not found: {target}")
        return 2

    files = sorted(target.glob("*.md"))
    if args.max:
        files = files[: args.max]

    total = len(files)
    if total == 0:
        print("No .md files found.")
        return 0

    reasons: Counter[str] = Counter()
    by_verdict: dict[str, list[tuple[Path, str]]] = defaultdict(list)

    for p in files:
        verdict, reason = classify(p)
        by_verdict[verdict].append((p, reason))
        reasons[reason] += 1

    keep_n = len(by_verdict["KEEP"])
    comp_n = len(by_verdict["COMPRESS"])

    print(f"\n=== compress_chat_orphans.py — {'APPLY' if args.apply else 'DRY-RUN'} ===")
    print(f"Scanned: {total} files in {target}")
    print(f"  KEEP:      {keep_n}  ({100 * keep_n / total:.1f}%)")
    print(f"  COMPRESS:  {comp_n}  ({100 * comp_n / total:.1f}%)")
    print("\nTop reasons:")
    for reason, n in reasons.most_common(10):
        print(f"  {n:5d}  {reason}")

    if args.verbose:
        print("\n--- COMPRESS candidates ---")
        for p, r in by_verdict["COMPRESS"][:200]:
            print(f"  {p.name}  |  {r}")
        if comp_n > 200:
            print(f"  ... {comp_n - 200} more not shown")

    if not args.apply:
        print("\n[dry-run] Nothing moved. Re-run with --apply to commit.")
        return 0

    # Confirmation for large batches
    if comp_n > 100:
        print(f"\nAbout to move {comp_n} files to {ARCHIVE}/")
        ans = input("Continue? [yes/NO]: ").strip().lower()
        if ans != "yes":
            print("Aborted.")
            return 1

    moved = 0
    errors = 0
    for p, reason in by_verdict["COMPRESS"]:
        bucket = month_bucket(p)
        dst_dir = ARCHIVE / bucket
        try:
            size_before = p.stat().st_size
            dst = gzip_move(p, dst_dir)
            size_after = dst.stat().st_size
            update_index(dst_dir, {
                "original": p.name,
                "archive": dst.name,
                "size_before": size_before,
                "size_after": size_after,
                "reason": reason,
                "moved_at": datetime.now().isoformat(timespec='seconds'),
            })
            moved += 1
        except Exception as exc:
            print(f"  ERROR moving {p.name}: {exc}")
            errors += 1

    print(f"\nDone. Moved: {moved}, errors: {errors}")
    if errors:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
