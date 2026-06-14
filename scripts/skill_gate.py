#!/usr/bin/env python3
"""skill_gate.py — PreToolUse hard-stop gate (ONE category: raw Office/PDF parsing).

Answers the recurring "я прошу применять скиллы, а ты прыгаешь" complaint with the
single cleanest-false-positive category: a Bash command that parses an Office/PDF file
with a raw library (openpyxl / pypdf / python-docx / fitz / pdfplumber) instead of the
anthropic-skills:{xlsx,docx,pptx,pdf} skill. Returns permissionDecision "ask" (NOT
"deny") so legitimate raw use still proceeds after a one-tap confirm — enforcement
without hard-blocking. Deliberately scoped to one category; widen only after this proves
clean (per 2026-06-13 foundation-burst adversarial refinement).

Wired as a PreToolUse(Bash) hook; reads the tool-call JSON from stdin.
"""
from __future__ import annotations
import sys, json

LIBS = ("openpyxl", "PyPDF2", "pypdf", "python-docx", "import docx",
        "import fitz", "pdfplumber", "from docx", "from pptx", "import pptx")


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:
        return
    if payload.get("tool_name") != "Bash":
        return
    cmd = ((payload.get("tool_input") or {}).get("command") or "")
    if not any(lib in cmd for lib in LIBS):
        return
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": (
                "Office/PDF через raw-библиотеку. Правило: anthropic-skills:xlsx|docx|pptx|pdf "
                "ДО своего openpyxl/pypdf (capability-map §0). Подтверди, если raw-парсинг "
                "действительно нужен (напр. одно числовое значение из готового пайплайна)."
            ),
        }
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
