"""Собрать ПОЛНЫЕ отчёты всех агентов и субагентов проекта — без сжатия.

Зачем: агенты в чате доносили «топ-3 находки», а полные отчёты оставались в
журналах. Скрипт проходит по всем источникам и сохраняет финальные ответы
целиком, по файлу на агента, плюс индекс с размерами и первой строкой.

Источники:
  1. <project>/*.jsonl                       — транскрипты сессий (tool_result от Agent)
  2. <project>/*/subagents/**/*.jsonl        — журналы субагентов и воркфлоу
  3. <temp>/**/tasks/*.output                — выводы фоновых задач

Запуск:
  python scripts/harvest_agent_reports.py [папка-вывода]
Вывод (UTF-8): <папка>/index.md + <папка>/reports/*.md
Кириллицу в консоль не печатаем (правило Windows-кодировок).
"""
import io
import json
import os
import re
import sys
import glob

PROJECT = r"C:/Users/filat/.claude/projects/C--Users-filat-dash"
TEMP = r"C:/Users/filat/AppData/Local/Temp/claude/C--Users-filat-dash"
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "artifacts", "agent-reports")

MIN_LEN = 400          # короче — это техническая реплика, не отчёт
SLUG = re.compile(r"[^0-9A-Za-zА-Яа-яЁё _-]+")


def texts_of(content):
    """Все текстовые куски из content сообщения (строка или список блоков)."""
    if isinstance(content, str):
        return [content]
    out = []
    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text" and part.get("text"):
                out.append(part["text"])
            # результат вызова Agent приходит как tool_result с вложенным content
            elif part.get("type") == "tool_result":
                out.extend(texts_of(part.get("content")))
    return out


def last_assistant_text(path):
    """Финальный ответ агента: последнее непустое assistant-сообщение файла."""
    best = ""
    try:
        with io.open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line or '"assistant"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                msg = rec.get("message") or {}
                if msg.get("role") != "assistant":
                    continue
                for t in texts_of(msg.get("content")):
                    if len(t.strip()) > len(best):
                        best = t.strip()
    except Exception:
        return ""
    return best


def agent_results_in_session(path):
    """Отчёты субагентов, пришедшие в сессию как tool_result (полный текст)."""
    found = []
    try:
        with io.open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line or "tool_result" not in line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                msg = rec.get("message") or {}
                for t in texts_of(msg.get("content")):
                    t = t.strip()
                    # отчёт агента, а не вывод команды: длинный и с русской прозой
                    if len(t) >= MIN_LEN and re.search(r"[А-Яа-я]{40}", t.replace(" ", "")):
                        found.append(t)
    except Exception:
        pass
    return found


def slug(text, limit=60):
    return SLUG.sub("", text).strip().replace(" ", "-")[:limit] or "report"


os.makedirs(os.path.join(OUT, "reports"), exist_ok=True)
index = []
seen = set()


def save(kind, source, text):
    key = text[:300]
    if key in seen or len(text) < MIN_LEN:
        return
    seen.add(key)
    n = len(index) + 1
    name = "%04d-%s-%s.md" % (n, kind, slug(os.path.basename(source), 40))
    with io.open(os.path.join(OUT, "reports", name), "w", encoding="utf-8") as fh:
        fh.write("<!-- источник: %s -->\n\n" % source)
        fh.write(text)
    first = next((l.strip() for l in text.splitlines() if l.strip()), "")
    index.append((name, kind, len(text), first[:200]))


# 1. Журналы субагентов и воркфлоу
for path in glob.glob(os.path.join(PROJECT, "*", "subagents", "**", "*.jsonl"), recursive=True):
    save("subagent", path, last_assistant_text(path))

# 2. Выводы фоновых задач
for path in glob.glob(os.path.join(TEMP, "**", "tasks", "*.output"), recursive=True):
    save("task", path, last_assistant_text(path))

# 3. Отчёты, пришедшие в сессии как результат вызова Agent
for path in glob.glob(os.path.join(PROJECT, "*.jsonl")):
    for t in agent_results_in_session(path):
        save("in-session", path, t)

index.sort(key=lambda r: -r[2])
with io.open(os.path.join(OUT, "index.md"), "w", encoding="utf-8") as fh:
    fh.write("# Индекс полных отчётов агентов\n\n")
    fh.write("Всего: %d, суммарно %d КБ. Отсортировано по объёму.\n\n" % (
        len(index), sum(r[2] for r in index) // 1024))
    for name, kind, size, first in index:
        fh.write("- `%s` — %s, %d КБ — %s\n" % (name, kind, max(1, size // 1024), first))

print("reports:", len(index), "total KB:", sum(r[2] for r in index) // 1024)
