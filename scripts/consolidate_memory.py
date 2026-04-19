#!/usr/bin/env python3
"""
consolidate_memory.py — executes MEMORY_CONSOLIDATION_REPORT.md §3-4.

Default: --dry-run (prints plan, moves nothing).
--apply  : execute (create `_archive/` subdirs, move files, rewrite wikilinks).
--merge  : print merge plan declarations (manual execution).
--verify : after --apply, check MEMORY.md backlinks still resolve.

Never deletes files. Moves via shutil.move with git-aware fallback.
Rewrites wikilinks [[X]] / [X](./X.md) in remaining memory/*.md to
point at the superseding canonical document.
"""
from __future__ import annotations

import argparse
import io
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Force UTF-8 stdout/stderr on Windows consoles (cp1251 default)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

MEMORY_ROOT = (
    Path.home()
    / ".claude"
    / "projects"
    / "C--Users-filat-dash"
    / "memory"
)
LOG = MEMORY_ROOT / "consolidation.log"

# (source_filename, target_subdir, reason_id, replacement_canonical)
ARCHIVE_PLAN: list[tuple[str, str, str, str | None]] = [
    ("UNIFIED_CONCEPT.md",                        "_archive/superseded-by-aemr-v2",               "D1",  "AEMR_UNIFIED_CONCEPT_V2.md"),
    ("PRODUCT_MODEL.md",                          "_archive/superseded-by-aemr-v2",               "D2",  "AEMR_UNIFIED_CONCEPT_V2.md"),
    ("design_postgresql_schema.md",               "_archive/superseded-by-aemr-v2",               "D3",  "AEMR_PG_MIGRATION_PLAN.md"),
    ("design_frontend_spec_v1.md",                "_archive/superseded-by-v2-spec",               "D4",  "design_frontend_spec_v2.md"),
    ("design_dashboard_redesign.md",              "_archive/superseded-by-aemr-v2",               "D5",  "AEMR_DASHBOARD_F4_SPEC.md"),
    ("design_unified_issue_model.md",             "_archive/superseded-by-aemr-v2",               "D6",  "AEMR_CONTROL_CENTER_REDESIGN.md"),
    ("audit_pipeline_full.md",                    "_archive/superseded-by-layer-audits",          "D8",  "audit/CORE_AUDIT_2026_04_18.md"),
    ("audit_signals_comprehensive_2026_04_13.md", "_archive/superseded-by-signal-system-ru",      "D9",  "SIGNAL_SYSTEM_RU.md"),
    ("audit_signals_issues_2026_04_13.md",        "_archive/closed",                              "D10", None),
    ("audit_svod_tdpm_2026_04_13.md",             "_archive/superseded-by-layer-audits",          "D11", "audit/SHARED_AUDIT_2026_04_18.md"),
    ("audit_frontend_components_2026_04_13.md",   "_archive/superseded-by-layer-audits",          "D12", "audit/WEB_AUDIT_2026_04_18.md"),
    ("readiness_honest_2026_04_13.md",            "_archive/superseded-by-architecture-verdict", "D25", "AEMR_ARCHITECTURE_VERDICT.md"),
    ("session_state_2026_04_13.md",               "_archive/sessions",                            "D26", None),
]

MERGE_PAIRS = [
    ("audit_pipeline_full.md",             "audit/CORE_AUDIT_2026_04_18.md",  "M1: data-flow + 7 bugs"),
    ("MASTER_PROJECT_STATUS.md",           "FINAL_MASTER_ROADMAP.md",          "M2: chronology + lessons → §1.4"),
    ("ACTIVE_TASKS.md",                    "FINAL_MASTER_ROADMAP.md",          "M3: P1-P2 backlog dedup"),
    ("WORK_SYSTEM.md",                     "PROCEDURE.md",                     "M4: ux-workflow, ml-cycle"),
    ("AEMR_EVOLUTION_INSIGHTS.md",         "SELF_IMPROVEMENT.md",              "M5: A8-A12 + A1-A7 → unified"),
    ("design_full_dimensional_metrics.md", "AEMR_FILTER_COVERAGE_CHECK.md",    "M6: KB-tooltip + slicing API"),
    ("PRODUCT_MODEL.md",                   "AEMR_UNIFIED_CONCEPT_V2.md",       "M7: pipeline map + стек + страницы"),
]


def log(msg: str) -> None:
    ts = datetime.now().isoformat(timespec="seconds")
    line = f"[{ts}] {msg}"
    print(line)
    if LOG.parent.exists():
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")


def is_git_repo(path: Path) -> bool:
    try:
        subprocess.run(
            ["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"],
            check=True,
            capture_output=True,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def inject_frontmatter(target: Path, superseded_by: str | None) -> None:
    """Append / upsert `superseded_by:` line in YAML frontmatter."""
    if superseded_by is None:
        return
    try:
        text = target.read_text(encoding="utf-8")
    except OSError:
        return
    lines = text.splitlines()
    if lines and lines[0].strip() == "---":
        # find closing
        for i in range(1, min(len(lines), 80)):
            if lines[i].strip() == "---":
                # inject before closing if not present
                block = "\n".join(lines[1:i])
                if "superseded_by" not in block:
                    lines.insert(i, f'superseded_by: "[[{Path(superseded_by).stem}]]"')
                    lines.insert(i + 1, f"superseded_date: {datetime.now().strftime('%Y-%m-%d')}")
                    target.write_text("\n".join(lines) + ("\n" if text.endswith("\n") else ""), encoding="utf-8")
                return
    else:
        # prepend minimal frontmatter
        fm = ["---",
              f'superseded_by: "[[{Path(superseded_by).stem}]]"',
              f"superseded_date: {datetime.now().strftime('%Y-%m-%d')}",
              "---", ""]
        target.write_text("\n".join(fm) + text, encoding="utf-8")


def move_file(src: Path, dst_dir: Path, dry_run: bool, superseded_by: str | None) -> bool:
    if not src.exists():
        log(f"SKIP   missing: {src.name}")
        return False
    if not dry_run:
        dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / src.name
    if dst.exists():
        log(f"SKIP   already in archive: {dst.relative_to(MEMORY_ROOT)}")
        return False
    if dry_run:
        log(f"DRY    would move: {src.name} → {dst.relative_to(MEMORY_ROOT)} (superseded_by={superseded_by})")
        return False
    inject_frontmatter(src, superseded_by)
    if is_git_repo(src.parent):
        try:
            subprocess.run(["git", "mv", str(src), str(dst)], check=True, capture_output=True)
            log(f"MOVED  (git mv) {src.name} → {dst.relative_to(MEMORY_ROOT)}")
            return True
        except subprocess.CalledProcessError as exc:
            log(f"FAIL git mv {src.name}: {exc}; falling back to shutil")
    shutil.move(str(src), str(dst))
    log(f"MOVED  (shutil) {src.name} → {dst.relative_to(MEMORY_ROOT)}")
    return True


def rewrite_incoming_links(archive_map: dict[str, tuple[str, str | None]], dry_run: bool) -> int:
    """For every remaining *.md in memory/ (not inside _archive/ or archive/),
    rewrite wikilinks [[Stem]] / markdown links (./Stem.md) to canonical replacement.
    Leaves untouched when no replacement is declared."""
    updates = 0
    for md in MEMORY_ROOT.rglob("*.md"):
        rel = md.relative_to(MEMORY_ROOT)
        if rel.parts and rel.parts[0] in ("_archive", "archive"):
            continue
        try:
            original = md.read_text(encoding="utf-8")
        except OSError:
            continue
        text = original
        for source_name, (subdir, replacement) in archive_map.items():
            src_stem = Path(source_name).stem
            if replacement is None:
                continue
            rep_stem = Path(replacement).stem
            rep_path = f"./{replacement}"
            # wikilinks [[Stem]] and [[Stem|alias]]
            text = re.sub(rf"\[\[{re.escape(src_stem)}(\|[^\]]+)?\]\]",
                          lambda m: f"[[{rep_stem}{m.group(1) or ''}]]", text)
            # markdown links ](./source_name)
            text = text.replace(f"](./{source_name})", f"]({rep_path})")
            text = text.replace(f"]({source_name})", f"]({rep_path})")
        if text != original:
            if dry_run:
                log(f"DRY    would rewrite links in: {rel}")
            else:
                md.write_text(text, encoding="utf-8")
                log(f"REWRITE links in: {rel}")
            updates += 1
    return updates


def plan_archive(dry_run: bool) -> int:
    log(f"=== ARCHIVE PLAN ({len(ARCHIVE_PLAN)} files) — dry_run={dry_run} ===")
    moved = 0
    for fname, subdir, reason, replacement in ARCHIVE_PLAN:
        src = MEMORY_ROOT / fname
        dst_dir = MEMORY_ROOT / subdir
        log(f"[{reason}] {fname:60s} → {subdir}")
        if move_file(src, dst_dir, dry_run, replacement):
            moved += 1
    return moved


def plan_merges() -> None:
    log(f"=== MERGE PLAN ({len(MERGE_PAIRS)} pairs) — manual review required ===")
    for src, dst, reason in MERGE_PAIRS:
        log(f"[{reason}] source={src} → target={dst}")


def verify_index() -> None:
    idx = MEMORY_ROOT / "MEMORY.md"
    if not idx.exists():
        log("ERROR MEMORY.md not found")
        return
    pattern = re.compile(r"\[([^\]]+)\]\(\.\/([^\)]+)\)")
    broken: list[str] = []
    for m in pattern.finditer(idx.read_text(encoding="utf-8")):
        target = MEMORY_ROOT / m.group(2)
        if not target.exists():
            broken.append(m.group(2))
    log(f"VERIFY broken backlinks in MEMORY.md: {len(broken)}")
    for b in broken:
        log(f"  - {b}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="Actually move files (default: dry-run)")
    p.add_argument("--merge", action="store_true", help="Print merge plan declarations")
    p.add_argument("--verify", action="store_true", help="Verify MEMORY.md backlinks")
    args = p.parse_args()
    dry = not args.apply
    moved = plan_archive(dry)
    archive_map = {fname: (subdir, rep) for fname, subdir, _, rep in ARCHIVE_PLAN}
    rewrites = rewrite_incoming_links(archive_map, dry)
    log(f"SUMMARY moved={moved} rewrites={rewrites}")
    if args.merge:
        plan_merges()
    if args.verify:
        verify_index()
    log("DONE — log: " + str(LOG))


if __name__ == "__main__":
    main()
