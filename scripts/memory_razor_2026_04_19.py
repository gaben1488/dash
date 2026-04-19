"""One-shot script: apply Occam's razor to memory/ root.

Moves feedback/design/research/domain/personas docs from memory/ root to
the appropriate vault/20-Knowledge/ subfolders (which already have structure).
Canonical AEMR_*.md and core meta docs stay in memory/.
One-time reports move to memory/archive/superseded/.
Empty stubs (0 bytes) deleted.

Usage:
    python scripts/memory_razor_2026_04_19.py --plan      # print plan only
    python scripts/memory_razor_2026_04_19.py --apply     # execute
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

MEMORY = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory")
VAULT_20K = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/20-Knowledge")
ARCHIVE = MEMORY / "archive" / "superseded"


def classify(fn: str) -> tuple[str, str]:
    """Return (destination_dir, reason)."""
    # Explicit KEEP in memory/ root (canonical AEMR_*.md + core meta)
    keep_prefixes = (
        'AEMR_',
    )
    keep_exact = {
        'MEMORY.md', 'UNIFIED_MECHANISM.md', 'PROCEDURE.md',
        'FINAL_MASTER_ROADMAP.md', 'LIVING_SYSTEM_V3_PRODUCT_PLAN.md',
        'LIVING_SYSTEM_DIAGNOSIS_2026_04_18.md', 'SWARM_PATTERNS.md',
        'SKILL_ACTIVATION_MAP.md', 'SKILL_REGISTRY_LIVE.md',
        'SIGNAL_SYSTEM_RU.md', 'MASTER_V2_ENTRY.md', 'ENTITY_MAP.md',
        'IDEAL_PROMPT_TEMPLATE.md', 'CONNECTIONS_AUDIT.md',
        'POTERESHKI_2026_04_19.md',
    }

    if fn.startswith(keep_prefixes) or fn in keep_exact:
        return ('KEEP', 'canonical AEMR or core meta')

    # Empty stubs (0KB)
    p = MEMORY / fn
    if p.is_file() and p.stat().st_size == 0:
        return ('DELETE', 'empty stub (0 bytes)')

    # Feedback → vault/20-Knowledge/feedback/ (dash-cased filename)
    if fn.startswith('feedback_') and fn.endswith('.md'):
        return ('MOVE_FEEDBACK', f'→ vault/20-Knowledge/feedback/{fn.replace("feedback_", "feedback-").replace("_", "-")}')

    # Design docs
    if fn.startswith('design_') and fn.endswith('.md'):
        return ('MOVE_DESIGN', f'→ vault/20-Knowledge/design/{fn.replace("design_", "").replace("_", "-")}')
    if fn.startswith('methodology_') and fn.endswith('.md'):
        return ('MOVE_DESIGN', f'→ vault/20-Knowledge/design/{fn.replace("methodology_", "").replace("_", "-")}')
    if fn == 'report_methodology_paradigm.md':
        return ('MOVE_DESIGN', '→ vault/20-Knowledge/design/report-methodology-paradigm.md')

    # Research
    if fn.startswith('research_') and fn.endswith('.md'):
        return ('MOVE_RESEARCH', f'→ vault/20-Knowledge/research/{fn.replace("research_", "").replace("_", "-")}')
    if fn == 'procurement_analytics_reference.md':
        return ('MOVE_RESEARCH', '→ vault/20-Knowledge/research/procurement-analytics-reference.md')

    # Domain / data
    domain_files = {
        'domain_44fz_procurement.md', 'math_model_svod.md',
        'spreadsheet_sources_canonical.md', 'spreadsheet_analysis_2026_04_12.md',
        'shdyu_mapping_verified.md', 'shdyu_discrepancy_root_cause.md',
        'svod_structure_validated.md', 'audit_shdyu_new_2026_04_13.md',
        'architecture.md', 'mapping_data_to_ui_2026_04_13.md',
    }
    if fn in domain_files:
        return ('MOVE_DOMAIN', f'→ vault/20-Knowledge/domain/{fn.replace("_", "-")}')

    # Personas / user-context
    personas_files = {
        'personas_12_verified.md', 'user_requirements_recurring.md',
        'user_screen_resolution.md', 'USER_VOICE.md', 'received_files_index.md',
    }
    if fn in personas_files:
        return ('MOVE_PERSONAS', f'→ vault/20-Knowledge/personas/{fn.replace("_", "-").lower()}')

    # Reverse-engineering baselines
    baselines = {
        'analysis_v39_frontend.md', 'analysis_v39_deployed_full.md',
        'defect_audit_2026_04_11.md',
    }
    if fn in baselines:
        return ('MOVE_CONCEPTS', f'→ vault/20-Knowledge/concepts/{fn.replace("_", "-")}')

    # Large one-time reports → archive/superseded/
    reports = {
        'ORPHAN_COMPLETE_INVENTORY.md', 'TOTAL_CONSOLIDATION_AUDIT_2026_04_18.md',
        'MEMORY_CONSOLIDATION_REPORT.md', 'MULCH_CONSOLIDATION_REPORT.md',
        'PROJECT_WORK_MAP.md', 'MEMORY_UNIFICATION.md',
        'ACTIVE_TASKS.md', 'MASTER_PROJECT_STATUS.md',
        'OBSIDIAN_GRAPH_STATE.md', 'CONNECTIONS_AUDIT_RESULT.md',
        'CHRONOLOGICAL_CHAIN_REPORT.md',
        'SELF_IMPROVEMENT.md', 'WORK_SYSTEM.md',
        'WORKFLOW_CRITIQUE_2026_04_18.md', 'CAPABILITY_MAP_2026_04_18.md',
    }
    if fn in reports:
        return ('ARCHIVE', '→ archive/superseded/')

    # Unknown — leave in place with flag for manual review
    return ('REVIEW', 'not classified — keep in memory/ root, manual review later')


def plan():
    files = sorted([f for f in os.listdir(MEMORY) if f.endswith('.md') and (MEMORY / f).is_file()])
    stats: dict[str, list[tuple[str, str]]] = {}
    for f in files:
        action, reason = classify(f)
        stats.setdefault(action, []).append((f, reason))

    print(f"=== TOTAL {len(files)} .md files ===\n")
    for action in ['KEEP', 'MOVE_FEEDBACK', 'MOVE_DESIGN', 'MOVE_RESEARCH',
                   'MOVE_DOMAIN', 'MOVE_PERSONAS', 'MOVE_CONCEPTS', 'ARCHIVE',
                   'DELETE', 'REVIEW']:
        items = stats.get(action, [])
        if not items:
            continue
        print(f"[{action}] {len(items)} files:")
        for fn, reason in items[:50]:
            print(f"  {fn}")
            if action not in ('KEEP',):
                print(f"    {reason}")
        if len(items) > 50:
            print(f"  ... + {len(items) - 50} more")
        print()
    # Summary
    keep = len(stats.get('KEEP', []))
    move = sum(len(stats.get(k, [])) for k in ['MOVE_FEEDBACK', 'MOVE_DESIGN', 'MOVE_RESEARCH', 'MOVE_DOMAIN', 'MOVE_PERSONAS', 'MOVE_CONCEPTS'])
    arch = len(stats.get('ARCHIVE', []))
    dele = len(stats.get('DELETE', []))
    rev = len(stats.get('REVIEW', []))
    print(f"SUMMARY: KEEP {keep} | MOVE_to_vault {move} | ARCHIVE {arch} | DELETE {dele} | REVIEW {rev}")


def apply():
    files = sorted([f for f in os.listdir(MEMORY) if f.endswith('.md') and (MEMORY / f).is_file()])
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    (VAULT_20K / 'feedback').mkdir(parents=True, exist_ok=True)
    (VAULT_20K / 'design').mkdir(parents=True, exist_ok=True)
    (VAULT_20K / 'research').mkdir(parents=True, exist_ok=True)
    (VAULT_20K / 'domain').mkdir(parents=True, exist_ok=True)
    (VAULT_20K / 'personas').mkdir(parents=True, exist_ok=True)
    (VAULT_20K / 'concepts').mkdir(parents=True, exist_ok=True)

    moved = deleted = archived = kept = review = 0

    def target_path(action: str, fn: str) -> Path | None:
        if action == 'MOVE_FEEDBACK':
            return VAULT_20K / 'feedback' / (fn.replace('feedback_', 'feedback-').replace('_', '-'))
        if action == 'MOVE_DESIGN':
            if fn.startswith('design_'):
                return VAULT_20K / 'design' / fn.replace('design_', '').replace('_', '-')
            if fn.startswith('methodology_'):
                return VAULT_20K / 'design' / fn.replace('methodology_', '').replace('_', '-')
            return VAULT_20K / 'design' / fn.replace('_', '-')
        if action == 'MOVE_RESEARCH':
            if fn.startswith('research_'):
                return VAULT_20K / 'research' / fn.replace('research_', '').replace('_', '-')
            return VAULT_20K / 'research' / fn.replace('_', '-')
        if action == 'MOVE_DOMAIN':
            return VAULT_20K / 'domain' / fn.replace('_', '-')
        if action == 'MOVE_PERSONAS':
            return VAULT_20K / 'personas' / fn.replace('_', '-').lower()
        if action == 'MOVE_CONCEPTS':
            return VAULT_20K / 'concepts' / fn.replace('_', '-')
        if action == 'ARCHIVE':
            return ARCHIVE / fn
        return None

    for f in files:
        action, _ = classify(f)
        src = MEMORY / f
        if action == 'KEEP':
            kept += 1
            continue
        if action == 'DELETE':
            src.unlink()
            deleted += 1
            continue
        if action == 'REVIEW':
            review += 1
            continue
        # MOVE / ARCHIVE
        dst = target_path(action, f)
        if dst is None:
            continue
        # Skip if exists in vault (dedup)
        if dst.exists():
            # Keep vault canonical, delete memory version
            src.unlink()
            deleted += 1
            continue
        shutil.move(str(src), str(dst))
        if action == 'ARCHIVE':
            archived += 1
        else:
            moved += 1

    print(f"\nAPPLIED: KEEP {kept} | MOVED {moved} | ARCHIVED {archived} | DELETED {deleted} | REVIEW {review}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    if args.apply:
        apply()
    else:
        plan()


if __name__ == '__main__':
    main()
