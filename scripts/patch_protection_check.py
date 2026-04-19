#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
patch_protection_check.py — pre-commit защита от патчей, полузавершённых скриптов,
неправильных путей, сирот без проверки, problematic-claim без evidence и потерянных уроков.

Запуск:
    python scripts/patch_protection_check.py              # dry-run по `git diff --cached`
    python scripts/patch_protection_check.py --staged      # явно staged changes
    python scripts/patch_protection_check.py --range HEAD~1..HEAD   # проверить последний commit
    python scripts/patch_protection_check.py --install     # установить как pre-commit hook в .git/hooks

Выход (exit code):
    0 — все шесть защит зелёные или только warning'и (не блокируют).
    1 — одна или более защит FAIL (блокирует commit, если установлен как hook).

Связано:
    memory/PROJECT_WORK_MAP.md §Часть 3 (шесть защит)
    memory/UNIFIED_MECHANISM.md §10 (десять правил-обещаний)
    CLAUDE.md §6 правило 9 (lint-and-validate green перед commit)

Зависимостей нет (только stdlib Python ≥3.9).
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

# ----- Константы проекта ---------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent  # dash/
SCRIPTS_DIR = REPO_ROOT / "scripts"
MEMORY_DIR = Path("C:/Users/filat/.claude/projects/C--Users-filat-dash/memory")
MULCH_DIR = REPO_ROOT / ".mulch" / "expertise"

# Канонические FS-пути из UNIFIED_MECHANISM §1.13
VAULT_ROOT = "C:/Users/filat/Documents/Obsidian/delete not delete"

# Известные анти-паттерны путей (защита 3.3)
WRONG_PATHS = [
    # (регекс-паттерн, сообщение)
    (
        re.compile(r"Obsidian[\\/](?!delete not delete)[^\\/]*[\\/]AEMR", re.IGNORECASE),
        "Vault root должен быть 'delete not delete/', AEMR — подпапка. См. UNIFIED_MECHANISM §1.13.",
    ),
    (
        re.compile(r"delete not delete[\\/]AEMR[\\/]\.obsidian", re.IGNORECASE),
        ".obsidian/ должен быть в корне vault, не внутри AEMR/ (sub-vault = поломка). "
        "См. CLAUDE.md правило 12.",
    ),
]

# Чек-листы связанных слоёв (защита 3.1). Ключ — маркёр-файл, значение — список
# других путей, которые обычно затрагиваются вместе с ним.
RELATED_LAYERS = {
    # Тип 1 — Схема БД
    "packages/shared/src/types.ts": [
        "packages/shared/src/schemas.ts",
        "packages/server/data/migrations/",
        ".test.ts",
    ],
    "packages/shared/src/schemas.ts": [
        "packages/shared/src/types.ts",
        ".test.ts",
    ],
    # Тип 2 — Колонка в источнике
    "packages/server/src/services/google-sheets.ts": [
        "packages/shared/src/dictionaries/",
        "packages/shared/src/report-map.ts",
    ],
    "packages/shared/src/report-map.ts": [
        "packages/shared/src/report-map.test.ts",
    ],
    # Тип 3 — Новая метрика
    "packages/web/src/lib/metrics-registry.ts": [
        "packages/web/src/components/ui/kb-tooltip.tsx",
        "packages/shared/src/constants.ts",
    ],
    # Тип 5 — Фильтр
    "packages/web/src/hooks/useFilteredData.ts": [
        "packages/web/src/hooks/useUrlSync.ts",
    ],
    # Тип 7 — Скрипт
    # (проверка --dry-run / --apply делается отдельно, см. check_half_done_scripts)
}

# Паттерны problematic-claim (защита 3.5)
PROBLEM_WORDS = re.compile(
    r"\b(сломано|broken|race\s*condition|leak|утечк|RCE|SQL\s*injection|bug\b|дефект)",
    re.IGNORECASE,
)
# file:line reference (достаточное evidence)
EVIDENCE_RE = re.compile(r"\b[a-zA-Z_/.\\-]+\.(?:ts|tsx|py|sql|md):\d+\b")
# row count / measurement evidence
MEASUREMENT_RE = re.compile(r"\b\d+\s+(?:строк|rows?|case|записей|LoC|файлов)\b", re.IGNORECASE)

# Паттерны orphan/sирот (защита 3.4)
ORPHAN_FILE_RE = re.compile(r"(70-Chat[\\/]raw-verbatim|AEMR_ORPHAN)", re.IGNORECASE)
VERIFIED_COMMIT_RE = re.compile(r"\bverified:\w+", re.IGNORECASE)

# Паттерн failure в memory (защита 3.6)
FAILURE_WORDS = re.compile(r"\b(failed|ошибка|anti-?pattern|mistake|промах)", re.IGNORECASE)


# ----- Модель отчёта -------------------------------------------------------


@dataclass
class CheckResult:
    name: str
    status: str  # "pass" | "warn" | "fail"
    messages: List[str] = field(default_factory=list)

    def is_blocking(self) -> bool:
        return self.status == "fail"

    def render(self) -> str:
        icon = {"pass": "[OK]", "warn": "[WARN]", "fail": "[FAIL]"}[self.status]
        lines = [f"{icon} {self.name}"]
        for msg in self.messages:
            lines.append(f"    - {msg}")
        return "\n".join(lines)


# ----- Git helpers ---------------------------------------------------------


def git_diff_files(scope: str) -> List[Path]:
    """Список изменённых файлов. scope: 'staged' | 'unstaged' | 'HEAD~1..HEAD' (range)."""
    if scope == "staged":
        cmd = ["git", "diff", "--name-only", "--cached"]
    elif scope == "unstaged":
        cmd = ["git", "diff", "--name-only", "HEAD"]
    else:  # range
        cmd = ["git", "diff", "--name-only", scope]
    try:
        out = subprocess.check_output(cmd, cwd=REPO_ROOT, text=True, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return []
    return [Path(line.strip()) for line in out.splitlines() if line.strip()]


def git_diff_content(scope: str) -> str:
    """Полный diff (для поиска problematic-claim, path'ов внутри добавленных строк)."""
    if scope == "staged":
        cmd = ["git", "diff", "--cached"]
    elif scope == "unstaged":
        cmd = ["git", "diff", "HEAD"]
    else:
        cmd = ["git", "diff", scope]
    try:
        return subprocess.check_output(
            cmd, cwd=REPO_ROOT, text=True, stderr=subprocess.DEVNULL, errors="replace"
        )
    except subprocess.CalledProcessError:
        return ""


def git_last_commit_message() -> str:
    try:
        return subprocess.check_output(
            ["git", "log", "-1", "--pretty=%B"], cwd=REPO_ROOT, text=True
        )
    except subprocess.CalledProcessError:
        return ""


# ----- Проверки ------------------------------------------------------------


def check_patch_only(changed: List[Path]) -> CheckResult:
    """3.1 Anti-patch-only — маркёр-файл изменён, но связанные слои — нет."""
    res = CheckResult(name="3.1 Anti-patch-only")
    changed_strs = {str(p).replace("\\", "/") for p in changed}

    violations: List[str] = []
    for marker, required_list in RELATED_LAYERS.items():
        if any(marker in s for s in changed_strs):
            missing = [
                req
                for req in required_list
                if not any(req in s for s in changed_strs)
            ]
            if missing:
                violations.append(
                    f"{marker} изменён, но не тронуты связанные: {', '.join(missing)}"
                )

    if violations:
        res.status = "warn"  # warn, не fail — чтобы не блокировать оправданные патчи
        res.messages = violations
        res.messages.append(
            "См. PROJECT_WORK_MAP.md Часть 2 — полные чек-листы по 10 типам изменений."
        )
    else:
        res.status = "pass"
    return res


def check_half_done_scripts(changed: List[Path]) -> CheckResult:
    """3.2 Anti-half-done-script — новый/изменённый скрипт без --dry-run / --apply."""
    res = CheckResult(name="3.2 Anti-half-done-script")
    issues: List[str] = []

    for p in changed:
        if not (str(p).startswith("scripts/") and p.suffix == ".py"):
            continue
        abs_path = REPO_ROOT / p
        if not abs_path.exists():
            continue  # удалён
        text = abs_path.read_text(encoding="utf-8", errors="replace")
        has_argparse = "argparse" in text
        has_dry = "--dry-run" in text or "dry_run" in text
        has_apply = "--apply" in text or "apply=True" in text
        if not (has_argparse and has_dry and has_apply):
            issues.append(
                f"{p}: "
                f"argparse={'ok' if has_argparse else 'MISSING'}, "
                f"--dry-run={'ok' if has_dry else 'MISSING'}, "
                f"--apply={'ok' if has_apply else 'MISSING'}"
            )

    if issues:
        res.status = "fail"
        res.messages = issues
        res.messages.append(
            "Правило: скрипт всегда с --dry-run (default=True) и отдельным --apply. "
            "См. UNIFIED_MECHANISM §1.7, PROJECT_WORK_MAP Часть 4 правило 12."
        )
    else:
        res.status = "pass"
    return res


def check_wrong_paths(diff_text: str) -> CheckResult:
    """3.3 Anti-wrong-path — hardcoded path противоречит канону."""
    res = CheckResult(name="3.3 Anti-wrong-path")
    hits: List[str] = []
    # Ищем только в добавленных строках (начинаются с '+' но не '+++')
    added_lines = [
        line[1:] for line in diff_text.splitlines() if line.startswith("+") and not line.startswith("+++")
    ]
    added_text = "\n".join(added_lines)

    for pattern, msg in WRONG_PATHS:
        matches = pattern.findall(added_text)
        if matches:
            hits.append(f"{msg} Найдено {len(matches)} вхождений.")

    if hits:
        res.status = "fail"
        res.messages = hits
    else:
        res.status = "pass"
    return res


def check_orphan_verification(changed: List[Path], commit_msg: str) -> CheckResult:
    """3.4 Anti-wrong-orphan-id — правки orphan-файлов без verified:<id> в commit."""
    res = CheckResult(name="3.4 Anti-wrong-orphan-id")
    orphan_files = [p for p in changed if ORPHAN_FILE_RE.search(str(p))]
    if not orphan_files:
        res.status = "pass"
        return res

    if VERIFIED_COMMIT_RE.search(commit_msg):
        res.status = "pass"
        res.messages.append(
            f"Тронуто orphan-файлов: {len(orphan_files)}. verified:<id> найден в commit-msg."
        )
    else:
        res.status = "warn"
        res.messages = [
            f"Тронуто {len(orphan_files)} orphan-файлов без 'verified:<chat-id>' в commit-msg.",
            "Правило: перед линковкой сироты обязательно Read + классификация A/B/C "
            "(AEMR_ORPHAN_DEEP_ANALYSIS). В commit-сообщении укажи verified:<id> для каждого.",
        ]
    return res


def check_problematic_claims(changed: List[Path], diff_text: str) -> CheckResult:
    """3.5 Anti-wrong-problematic — claim 'сломано' в memory/*.md без file:line evidence."""
    res = CheckResult(name="3.5 Anti-wrong-problematic")
    issues: List[str] = []

    memory_md_files = [
        p for p in changed if str(p).replace("\\", "/").startswith("memory/") and p.suffix == ".md"
    ]
    if not memory_md_files:
        res.status = "pass"
        return res

    # Анализируем добавленные строки в memory/*.md
    added_in_memory: List[str] = []
    current_file = ""
    in_memory = False
    for line in diff_text.splitlines():
        if line.startswith("diff --git"):
            current_file = line
            in_memory = "memory/" in line and line.endswith(".md")
        elif in_memory and line.startswith("+") and not line.startswith("+++"):
            added_in_memory.append(line[1:])

    added_joined = "\n".join(added_in_memory)
    problem_hits = PROBLEM_WORDS.findall(added_joined)
    if problem_hits:
        has_evidence = bool(EVIDENCE_RE.search(added_joined)) or bool(
            MEASUREMENT_RE.search(added_joined)
        )
        if not has_evidence:
            issues.append(
                f"В memory/*.md добавлены problematic-слова ({len(problem_hits)} шт.) "
                "без file:line evidence или row-count measurement."
            )
            issues.append(
                "Правило: любой claim 'сломано' должен иметь file:line или N строк/rows. "
                "См. PROJECT_WORK_MAP §3.5."
            )

    if issues:
        res.status = "warn"
        res.messages = issues
    else:
        res.status = "pass"
    return res


def check_lost_lessons(changed: List[Path], diff_text: str) -> CheckResult:
    """3.6 Anti-lost-lesson — в diff'е memory/*.md есть 'failed' / 'ошибка',
    но в mulch нет свежей failure-записи."""
    res = CheckResult(name="3.6 Anti-lost-lesson")
    memory_md_changed = any(
        str(p).replace("\\", "/").startswith("memory/") and p.suffix == ".md"
        for p in changed
    )
    if not memory_md_changed:
        res.status = "pass"
        return res

    # Есть ли failure-слова в diff
    has_failure_words = bool(FAILURE_WORDS.search(diff_text))
    if not has_failure_words:
        res.status = "pass"
        return res

    # Проверим, изменён ли хотя бы один .mulch/expertise/*.jsonl в этом diff
    mulch_changed = any(
        str(p).replace("\\", "/").startswith(".mulch/expertise/") for p in changed
    )
    if mulch_changed:
        res.status = "pass"
        res.messages.append("failure-слова найдены, но .mulch/ тоже изменён — lesson учтён.")
    else:
        res.status = "warn"
        res.messages = [
            "В memory/*.md упомянуты failure/ошибки, но .mulch/ не изменён.",
            "Правило: каждая ошибка → ml record <domain> --type failure "
            "--description ... --resolution ... (обещание №8).",
        ]
    return res


# ----- Установка как pre-commit hook ---------------------------------------


HOOK_CONTENT = """#!/bin/sh
# Auto-installed by scripts/patch_protection_check.py --install
python scripts/patch_protection_check.py --staged
exit $?
"""


def install_hook() -> int:
    hook_dir = REPO_ROOT / ".git" / "hooks"
    if not hook_dir.exists():
        print("FAIL: .git/hooks/ не найден. Это не git-репозиторий?")
        return 1
    hook_path = hook_dir / "pre-commit"
    hook_path.write_text(HOOK_CONTENT, encoding="utf-8")
    try:
        # Unix — делаем executable; на Windows не обязательно
        hook_path.chmod(0o755)
    except Exception:
        pass
    print(f"[OK] pre-commit hook установлен: {hook_path}")
    print("     Теперь `git commit` автоматически запускает защиту.")
    return 0


# ----- Main ----------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pre-commit защита от патчей / half-done scripts / wrong paths."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--staged", action="store_true",
        help="Проверить staged changes (git diff --cached). По умолчанию.",
    )
    group.add_argument(
        "--unstaged", action="store_true",
        help="Проверить unstaged changes (git diff HEAD).",
    )
    group.add_argument(
        "--range", metavar="REV..REV",
        help="Проверить произвольный git range (например HEAD~1..HEAD).",
    )
    parser.add_argument(
        "--install", action="store_true",
        help="Установить этот скрипт как pre-commit hook в .git/hooks/.",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Явный apply-флаг (для совместимости с правилом '--dry-run по умолчанию'). "
             "На семантику не влияет — скрипт в любом случае read-only.",
    )
    args = parser.parse_args()

    if args.install:
        return install_hook()

    if args.range:
        scope = args.range
    elif args.unstaged:
        scope = "unstaged"
    else:
        scope = "staged"

    changed = git_diff_files(scope)
    if not changed:
        print("[OK] Нет изменений для проверки.")
        return 0

    diff_text = git_diff_content(scope)
    commit_msg = git_last_commit_message()

    print(f"patch_protection_check.py — scope={scope}, файлов={len(changed)}")
    print("-" * 60)

    checks = [
        check_patch_only(changed),
        check_half_done_scripts(changed),
        check_wrong_paths(diff_text),
        check_orphan_verification(changed, commit_msg),
        check_problematic_claims(changed, diff_text),
        check_lost_lessons(changed, diff_text),
    ]

    for c in checks:
        print(c.render())
    print("-" * 60)

    fails = sum(1 for c in checks if c.status == "fail")
    warns = sum(1 for c in checks if c.status == "warn")
    passes = sum(1 for c in checks if c.status == "pass")

    summary = f"Итог: {passes} pass, {warns} warn, {fails} fail."
    print(summary)

    if fails:
        print(
            "\nCOMMIT BLOCKED. Разберись с FAIL'ами или запусти с --unstaged чтобы проверить вручную."
        )
        return 1
    if warns:
        print(
            "\nWarnings найдены — прочитай сообщения. Commit разрешён, но проверь PROJECT_WORK_MAP Часть 2."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
