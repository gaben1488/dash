#!/usr/bin/env python3
"""
sync_to_vault.py — зеркалит verified-регистры из Claude memory/ в Obsidian vault.

ПРОБЛЕМА (MEMORY.md §5, TODO с апреля): папка memory/
(.claude/projects/C--Users-filat-dash/memory/) НЕ в git и НЕ в Obsidian →
пользователь не видит verified-регистры, которые пишет Claude. Зеркалирование
делалось руками → дрейф.

РЕШЕНИЕ: копировать designated регистры в
vault/AEMR/20-Knowledge/registers/ с баннером «mirror, canonical=memory/».
Пишет ТОЛЬКО в registers/ (dedicated subdir) — НЕ трогает курируемые ноты
пользователя. Идемпотентно (перезаписывает зеркала). Безопасно.

Usage:
  python scripts/sync_to_vault.py            # применить
  python scripts/sync_to_vault.py --dry-run  # показать, что синканёт
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

MEMORY = Path.home() / ".claude" / "projects" / "C--Users-filat-dash" / "memory"
VAULT_REGISTERS = (
    Path.home() / "Documents" / "Obsidian" / "delete not delete"
    / "AEMR" / "20-Knowledge" / "registers"
)

# Designated verified-регистры (канонический источник = memory/).
# Glob-паттерны: берём свежайшую дату-версию каждого семейства.
REGISTER_GLOBS = [
    "PROJECT_CONTEXT_*.md",
    "BUG_REGISTER_*.md",
    "MEMORY_SYSTEM_AUDIT_*.md",
    "SIGNAL_VALIDATION_*.md",
    "SIGNAL_VERIFICATION_PER_ROW_*.md",
    "CODE_DEBT_REGISTER_*.md",
    "SECURITY_REVIEW_2026-*.md",
    "SECURITY_REVIEW_ROUND2_*.md",
    "SIMPLIFY_REGISTER_*.md",
    "DEADCODE_DISPOSITION_*.md",
    "SESSION_COORDINATION_*.md",
    "GAP_REGISTER_*.md",
    "PASSPORT_SYNTHESIS_*.md",
]

BANNER = (
    "> ⚠ **АВТО-ЗЕРКАЛО из Claude `memory/`** — канонический источник там.\n"
    "> НЕ редактировать здесь: правь `memory/{name}`, затем "
    "`python scripts/sync_to_vault.py`.\n\n"
)


def latest(glob: str) -> Path | None:
    """Свежайший по имени файл семейства (даты в имени ISO-сортируемы)."""
    hits = sorted(MEMORY.glob(glob))
    return hits[-1] if hits else None


def main() -> int:
    dry = "--dry-run" in sys.argv
    if not MEMORY.is_dir():
        print(f"✗ memory/ не найдена: {MEMORY}")
        return 1
    if not VAULT_REGISTERS.parent.is_dir():
        print(f"✗ vault 20-Knowledge не найдена: {VAULT_REGISTERS.parent}")
        return 1

    if not dry:
        VAULT_REGISTERS.mkdir(exist_ok=True)

    synced, skipped = [], []
    for glob in REGISTER_GLOBS:
        src = latest(glob)
        if src is None:
            skipped.append(glob)
            continue
        body = src.read_text(encoding="utf-8")
        # Вставляем баннер после frontmatter (--- ... ---), иначе в начало.
        banner = BANNER.replace("{name}", src.name)
        if body.startswith("---"):
            end = body.find("\n---", 3)
            if end != -1:
                cut = end + len("\n---") + 1
                out = body[:cut] + "\n" + banner + body[cut:]
            else:
                out = banner + body
        else:
            out = banner + body
        dst = VAULT_REGISTERS / src.name
        action = "DRY" if dry else "sync"
        if not dry:
            dst.write_text(out, encoding="utf-8")
        synced.append((action, src.name, len(out)))

    print(f"=== sync_to_vault {'(DRY-RUN)' if dry else ''} ===")
    print(f"memory: {MEMORY}")
    print(f"vault : {VAULT_REGISTERS}")
    for action, name, size in synced:
        print(f"  [{action}] {name}  ({size} bytes)")
    if skipped:
        print(f"  пропущены (нет файла): {', '.join(skipped)}")
    print(f"Итого: {len(synced)} зеркал, {len(skipped)} пропущено.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
