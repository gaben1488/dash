"""Semantic linker для 70-Chat/raw-verbatim — записывает wikilinks ВНУТРЬ тела
каждой ценной orphan-заметки, чтобы Obsidian перестал рисовать их сиротами.

Мотивация (обсуждение 18.04):
    Предыдущие скрипты `link_orphans_by_date.py`, `hub_backlinks.py`,
    `causality_backlinks.py` писали обратные ссылки из canonical-артефактов,
    но сами raw-verbatim остались без wikilinks в теле. Внешне граф не менялся.
    Эта утилита закрывает тот gap: в каждый valuable orphan добавляется блок
    «Связанные документы» с 2-5 `[[wikilink]]` на canonical-ноты, подобранные
    по трём сигналам:

        1. **Date match** — yyyy-mm-dd в имени orphan'а совпадает с датой
           canonical (из имени или frontmatter).
        2. **Stem mention** — тело orphan'а явно упоминает имя canonical-ноты
           (regex на стем).
        3. **Token overlap** — Jaccard по rare-токенам (>=4 символов, вне
           STOP_TOKENS, без HEX-хешей и tool-id'шников).

    Ценными считаются orphans, содержащие `<result>` >= 400 символов, либо
    прозу >= 300 кириллических символов без XML-мусора.

    Механические (Stop hook, Background command без `<result>`, interruption-
    уведомления) — помечаются `skipped`.

Безопасность:
    - Dry-run по умолчанию. Флаг `--apply` пишет изменения.
    - Идемпотентно: старый блок `<!-- AUTO:semantic-link:v1 -->` вырезается
      и перезаписывается.
    - Максимум 5 wikilinks на orphan.
    - При отсутствии совпадений — блок не добавляется (иначе мусор).

Вывод:
    `memory/ORPHAN_COMPLETE_INVENTORY.md` — таблица всех orphans с превью
    и предложенными wikilinks.

Использование:
    python scripts/semantic_linker.py                   # dry-run
    python scripts/semantic_linker.py --apply            # пишет файлы
    python scripts/semantic_linker.py --apply --top 40   # лимит первых N
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
RAW_DIR = VAULT / "70-Chat" / "raw-verbatim"

# Папки, заметки из которых считаем кандидатами canonical-таргетов
CANONICAL_DIRS = [
    "00-Meta",
    "10-Index",
    "20-Knowledge",
    "30-Decisions",
    "40-Active",
    "50-Workflow",
]

# Папки, которые НЕ трогаем для записи
SKIP_FOR_WRITE = {
    "archive-compressed",
    "session-continuations",
    "responses",
    "messages",
    "chains",
    "sessions",
    "system-injected",
}

OUTPUT_REPORT = Path(
    r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/ORPHAN_COMPLETE_INVENTORY.md"
)

DATE_IN_NAME = re.compile(r"(20\d\d)[-_](\d\d)[-_](\d\d)")
FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]")

AUTO_BLOCK_RE = re.compile(
    r"\n?<!-- AUTO:semantic-link:v1 START -->.*?<!-- AUTO:semantic-link:v1 END -->\n?",
    re.DOTALL,
)

# Механические маркеры (по которым метим skipped)
MECH_PATTERNS = [
    re.compile(r"^Stop hook feedback:", re.M),
    re.compile(r"<summary>Background command .+ completed</summary>", re.M),
    re.compile(r"\[Request interrupted by user", re.M),
    re.compile(r"^API Error: \d+", re.M),
]

# Токенизация
TOKEN_RE = re.compile(r"[A-Za-zА-Яа-яЁё0-9_\-]{4,}")
HEX_HASH_RE = re.compile(r"^[a-f0-9]{8,}$")
ALL_DIGITS_RE = re.compile(r"^[0-9\-_]+$")

STOP_TOKENS = {
    # English structural
    "this", "that", "with", "from", "have", "been", "were", "will",
    "what", "when", "where", "which", "there", "here", "their", "them",
    "about", "into", "your", "they", "than", "then", "more", "also",
    "some", "such", "only", "most", "much", "many", "very", "over",
    "after", "before", "between", "while", "would", "could", "should",
    "tool", "name", "type", "input", "result", "content", "text", "used",
    "task", "tool-use", "tool-result", "toolu", "tool_use", "tool_result",
    "user", "assistant", "human", "agent", "output", "file", "path",
    "note", "notes", "line", "lines", "file-", "path-",
    "null", "true", "false", "none",
    # Russian structural
    "это", "этого", "этому", "этим", "этих", "который", "которая",
    "которые", "которого", "которую", "также", "чтобы", "если", "когда",
    "потому", "потому_что", "уже", "ещё", "еще", "даже", "очень", "нужно",
    "надо", "можно", "нельзя", "будет", "была", "были", "быть", "есть",
    "нет", "или", "без", "при", "для", "как", "так", "там", "тут",
    "здесь", "туда", "сюда", "все", "всё", "всех", "всем", "всеми",
    "весь", "вся", "мне", "меня", "мной", "мною", "тебе", "тебя", "тобой",
    "ему", "его", "ней", "неё", "них", "ними", "нас", "вас", "нами",
    "мой", "моя", "моё", "мои", "твой", "твоя", "твоё", "свой", "своя",
    "свои", "наш", "ваш", "каждый", "каждая", "какой", "какая", "какие",
    "один", "одна", "одно", "одни", "два", "три", "четыре", "пять",
    "делать", "сделал", "сделать", "сделано", "делал", "делает", "делают",
    "просто", "именно", "кроме", "между", "после", "перед", "через",
    "только", "уже", "пока", "тоже", "сам", "сама", "само", "сами",
    # Markdown / xml noise
    "markdown", "html", "json", "yaml", "csv", "https", "http", "www",
    "task-notification", "status", "completed", "usage", "summary",
    "output-file", "tool-use-id", "total_tokens", "duration_ms",
    "tool_uses", "appdata", "local", "temp", "tasks",
    # Generic dev
    "true", "false", "none", "null", "undefined",
}


def is_mechanical(text: str) -> tuple[bool, str]:
    """Проверка на механические noise-заметки. Возвращает (is_mech, reason)."""
    stripped = text.strip()
    if len(stripped) < 200:
        # Совсем короткие — очень вероятно Stop hook / ack
        for pat in MECH_PATTERNS:
            if pat.search(stripped):
                return True, "short-mechanical"
        if len(stripped) < 80:
            return True, "tiny-note"
    for pat in MECH_PATTERNS:
        if pat.search(stripped):
            # Если есть mechanical-маркер И тело маленькое — skip
            if len(stripped) < 500:
                return True, "mechanical-marker"
    # Background command без <result>
    if "<summary>Background command" in stripped and "<result>" not in stripped:
        return True, "bg-command-no-result"
    return False, ""


def extract_result_text(text: str) -> str:
    """Достаёт содержимое <result>...</result> если есть, иначе весь текст."""
    m = re.search(r"<result>(.*?)</result>", text, re.DOTALL)
    if m:
        return m.group(1)
    return text


def cyrillic_char_count(text: str) -> int:
    return sum(1 for ch in text if "а" <= ch.lower() <= "я" or ch.lower() == "ё")


def is_valuable(text: str) -> tuple[bool, str]:
    """Valuable = есть <result> >=400 chars, либо >=300 кириллических букв."""
    m = re.search(r"<result>(.*?)</result>", text, re.DOTALL)
    if m and len(m.group(1).strip()) >= 400:
        return True, "has-result"
    if cyrillic_char_count(text) >= 300:
        return True, "rich-russian-prose"
    return False, ""


def parse_frontmatter(txt: str) -> tuple[dict, int]:
    m = FM_RE.match(txt)
    if not m:
        return {}, 0
    fm: dict = {}
    for line in m.group(1).split("\n"):
        if ":" in line and not line.startswith((" ", "\t", "-")):
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
    return fm, m.end()


def extract_date(stem: str, fm: dict) -> str | None:
    m = DATE_IN_NAME.search(stem)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    for k in ("date", "created", "updated"):
        v = fm.get(k)
        if v:
            vm = DATE_IN_NAME.search(v)
            if vm:
                return f"{vm.group(1)}-{vm.group(2)}-{vm.group(3)}"
    return None


def tokenize(text: str) -> set[str]:
    raw = TOKEN_RE.findall(text.lower())
    out = set()
    for t in raw:
        if t in STOP_TOKENS:
            continue
        if HEX_HASH_RE.match(t):
            continue
        if ALL_DIGITS_RE.match(t):
            continue
        # Даты вроде 2026-04-14
        if re.match(r"^20\d\d[-_]?\d\d", t):
            continue
        out.add(t)
    return out


def load_canonicals() -> list[dict]:
    """Сканирует CANONICAL_DIRS, строит для каждого файла токен-набор."""
    out = []
    for top in CANONICAL_DIRS:
        top_dir = VAULT / top
        if not top_dir.is_dir():
            continue
        for p in top_dir.rglob("*.md"):
            try:
                txt = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            fm, fm_end = parse_frontmatter(txt)
            body = txt[fm_end:]
            date = extract_date(p.stem, fm)
            # Для индекса токенов берём frontmatter + первые 2000 символов тела
            index_text = " ".join([
                " ".join(fm.values()),
                body[:2000],
                p.stem,
            ])
            tokens = tokenize(index_text)
            out.append({
                "path": p,
                "stem": p.stem,
                "date": date,
                "tokens": tokens,
                "folder": top,
            })
    return out


def build_stem_regex(canonicals: list[dict]) -> re.Pattern:
    """Регекс, ловящий упоминания стемов canonical'ов в произвольном тексте.
    Приоритет длинным стемам → короткие, чтобы не матчить подстроки."""
    stems = sorted({c["stem"] for c in canonicals}, key=len, reverse=True)
    # Экранируем и соединяем | (слишком длинные файлы могут взорвать регекс;
    # но Obsidian-стемов ~300 штук, это ок).
    escaped = [re.escape(s) for s in stems if len(s) >= 4]
    pat = r"(?<![A-Za-zА-Яа-я0-9_\-])(" + "|".join(escaped) + r")(?![A-Za-zА-Яа-я0-9_\-])"
    return re.compile(pat, re.IGNORECASE)


def score_match(
    orphan_tokens: set[str],
    orphan_date: str | None,
    canonical: dict,
    mentioned_stems: set[str],
) -> float:
    """Scoring:
    - Jaccard rare-token overlap: 0..1, веc 1.0
    - Date equality: +0.5
    - Stem mention в теле orphan: +1.5 (сильнейший сигнал)
    """
    ct = canonical["tokens"]
    if not orphan_tokens or not ct:
        base = 0.0
    else:
        inter = len(orphan_tokens & ct)
        union = len(orphan_tokens | ct)
        base = inter / union if union else 0.0
    score = base
    if orphan_date and canonical["date"] == orphan_date:
        score += 0.5
    if canonical["stem"].lower() in mentioned_stems:
        score += 1.5
    return score


def pick_topk(
    orphan_tokens: set[str],
    orphan_date: str | None,
    canonicals: list[dict],
    mentioned_stems: set[str],
    k: int = 5,
) -> list[tuple[dict, float]]:
    scored = []
    for c in canonicals:
        s = score_match(orphan_tokens, orphan_date, c, mentioned_stems)
        if s >= 0.02:  # порог отсечения, чтобы не писать мусор
            scored.append((c, s))
    scored.sort(key=lambda x: -x[1])
    return scored[:k]


def render_link_block(top_matches: list[tuple[dict, float]]) -> str:
    lines = [
        "",
        "<!-- AUTO:semantic-link:v1 START -->",
        "## Связанные документы",
        "",
    ]
    for c, score in top_matches:
        folder = c["folder"]
        lines.append(f"- [[{c['stem']}]] — {folder}, score {score:.2f}")
    lines.append("<!-- AUTO:semantic-link:v1 END -->")
    lines.append("")
    return "\n".join(lines)


def preview(text: str, n: int = 300) -> str:
    # Убираем XML-обёртки и ищем содержательное превью
    body = text
    if "<result>" in body:
        body = extract_result_text(body)
    # Убираем frontmatter
    fm_m = FM_RE.match(body)
    if fm_m:
        body = body[fm_m.end():]
    # Сжимаем пробелы
    body = re.sub(r"\s+", " ", body).strip()
    return body[:n] + ("…" if len(body) > n else "")


def process_orphans(apply: bool, top_n: int | None) -> dict:
    canonicals = load_canonicals()
    print(f"[info] canonicals scanned: {len(canonicals)} из {CANONICAL_DIRS}")
    stem_regex = build_stem_regex(canonicals)
    print(f"[info] stem-regex built, {len({c['stem'] for c in canonicals})} unique stems")

    raw_files = sorted(RAW_DIR.glob("*.md"))
    print(f"[info] raw-verbatim files: {len(raw_files)}")

    inventory = []
    stats = Counter()
    applied_count = 0
    processed = 0

    for p in raw_files:
        if top_n is not None and processed >= top_n:
            break
        processed += 1
        try:
            txt = p.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:
            stats["read-error"] += 1
            continue

        mech, reason = is_mechanical(txt)
        if mech:
            stats["mechanical"] += 1
            inventory.append({
                "path": p,
                "status": "mechanical",
                "reason": reason,
                "date": extract_date(p.stem, {}),
                "preview": preview(txt, 200),
                "links": [],
            })
            continue

        val, val_reason = is_valuable(txt)
        if not val:
            stats["not-valuable"] += 1
            inventory.append({
                "path": p,
                "status": "skipped-not-valuable",
                "reason": "short-non-mechanical",
                "date": extract_date(p.stem, {}),
                "preview": preview(txt, 200),
                "links": [],
            })
            continue

        orphan_date = extract_date(p.stem, {})
        orphan_tokens = tokenize(extract_result_text(txt))
        mentioned = {m.group(1).lower() for m in stem_regex.finditer(txt)}
        top = pick_topk(orphan_tokens, orphan_date, canonicals, mentioned, k=5)

        if not top:
            stats["valuable-no-match"] += 1
            inventory.append({
                "path": p,
                "status": "valuable-no-match",
                "reason": val_reason,
                "date": orphan_date,
                "preview": preview(txt, 300),
                "links": [],
            })
            continue

        # Идемпотентно вычистить старый блок и поставить новый
        stripped = AUTO_BLOCK_RE.sub("\n", txt)
        block = render_link_block(top)
        new_txt = stripped.rstrip() + "\n" + block
        changed = new_txt != txt

        inventory.append({
            "path": p,
            "status": "linked" if changed else "already-linked",
            "reason": val_reason,
            "date": orphan_date,
            "preview": preview(txt, 300),
            "links": [(c["stem"], c["folder"], round(sc, 3)) for c, sc in top],
        })
        if changed:
            stats["would-link" if not apply else "linked"] += 1
            if apply:
                try:
                    p.write_text(new_txt, encoding="utf-8")
                    applied_count += 1
                except Exception as exc:
                    stats["write-error"] += 1
        else:
            stats["already-linked"] += 1

    stats["total"] = len(raw_files)
    stats["processed"] = processed
    stats["applied"] = applied_count

    return {"inventory": inventory, "stats": stats, "canonicals": canonicals}


def write_inventory_report(result: dict, apply: bool) -> None:
    inv = result["inventory"]
    stats = result["stats"]
    lines = [
        "---",
        "type: inventory",
        "tags: [orphan, semantic-link, inventory]",
        "generated: 2026-04-18",
        "script: scripts/semantic_linker.py",
        "---",
        "",
        "# ORPHAN COMPLETE INVENTORY — raw-verbatim × canonical",
        "",
        "> Полный перечень всех заметок в `70-Chat/raw-verbatim/` с классификацией,",
        "> превью и предложенными `[[wikilinks]]` на canonical-ноты vault'а.",
        "> Сформировано скриптом `semantic_linker.py`.",
        "",
        "## Итог",
        "",
        f"- Всего файлов в raw-verbatim: **{stats.get('total', 0)}**",
        f"- Обработано в этом прогоне: **{stats.get('processed', 0)}**",
        f"- Mechanical (Stop hook / bg-command / interruption): **{stats.get('mechanical', 0)}**",
        f"- Короткие не-mechanical (skipped-not-valuable): **{stats.get('not-valuable', 0)}**",
        f"- Valuable, но без совпадений: **{stats.get('valuable-no-match', 0)}**",
        f"- Valuable с wikilinks (plan/apply): **{stats.get('would-link', 0) + stats.get('linked', 0) + stats.get('already-linked', 0)}**",
        f"- Фактически записано (если `--apply`): **{stats.get('applied', 0)}**",
        "",
        "## Легенда статусов",
        "",
        "- `linked` — в файл записан блок `<!-- AUTO:semantic-link:v1 -->` с wikilinks.",
        "- `already-linked` — блок уже был в точности такой, ничего не переписано.",
        "- `valuable-no-match` — проза содержательная, но не нашёлся ни один canonical с score ≥ 0.02.",
        "- `skipped-not-valuable` — проза < 300 кириллических символов и нет `<result>` ≥ 400. Кандидат в `compress_chat_orphans.py`.",
        "- `mechanical` — Stop hook feedback, Background command без `<result>`, interruption-уведомление. Кандидат в compress.",
        "",
        "## Разбивка по дням (валидные valuable)",
        "",
    ]
    # Группировка по дате для valuable-записей
    by_date = defaultdict(list)
    for rec in inv:
        if rec["status"] in ("linked", "already-linked", "valuable-no-match"):
            by_date[rec["date"] or "unknown"].append(rec)
    lines.append("| Дата | Valuable | Со ссылками |")
    lines.append("|------|---------:|------------:|")
    for d in sorted(by_date.keys()):
        total_d = len(by_date[d])
        linked_d = sum(1 for r in by_date[d] if r["status"] in ("linked", "already-linked"))
        lines.append(f"| {d} | {total_d} | {linked_d} |")
    lines.append("")

    # Полная таблица valuable (linked + valuable-no-match)
    lines.append("## Полная таблица valuable-orphans")
    lines.append("")
    lines.append("| # | Файл | Дата | Статус | Top-3 wikilinks | Превью (300 chars) |")
    lines.append("|---|------|------|--------|-----------------|--------------------|")
    idx = 0
    for rec in inv:
        if rec["status"] not in ("linked", "already-linked", "valuable-no-match"):
            continue
        idx += 1
        fname = rec["path"].name
        links_str = ", ".join(
            f"[[{stem}]] ({score})" for stem, _f, score in rec["links"][:3]
        ) if rec["links"] else "—"
        # Превью: убрать pipe и новую строку чтобы не ломать таблицу
        prv = rec["preview"].replace("|", "∣").replace("\n", " ")[:300]
        lines.append(
            f"| {idx} | `{fname}` | {rec['date'] or '—'} | {rec['status']} | {links_str} | {prv} |"
        )

    lines.append("")
    lines.append("## Mechanical / skipped-not-valuable — кандидаты в compress")
    lines.append("")
    lines.append("| Файл | Дата | Статус | Reason | Превью |")
    lines.append("|------|------|--------|--------|--------|")
    for rec in inv:
        if rec["status"] not in ("mechanical", "skipped-not-valuable"):
            continue
        fname = rec["path"].name
        prv = rec["preview"].replace("|", "∣").replace("\n", " ")[:150]
        lines.append(
            f"| `{fname}` | {rec['date'] or '—'} | {rec['status']} | {rec['reason']} | {prv} |"
        )
    lines.append("")
    lines.append(f"> Режим: {'APPLY' if apply else 'DRY-RUN'}.")
    OUTPUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"[info] inventory written: {OUTPUT_REPORT}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Запись в файлы (default dry-run).")
    ap.add_argument("--top", type=int, default=None, help="Лимит первых N raw-verbatim для прохода.")
    args = ap.parse_args()

    if not RAW_DIR.is_dir():
        print(f"[error] raw-verbatim dir not found: {RAW_DIR}")
        sys.exit(1)

    print(f"[start] semantic_linker {'APPLY' if args.apply else 'DRY-RUN'}")
    result = process_orphans(apply=args.apply, top_n=args.top)
    print("\n=== STATS ===")
    for k, v in result["stats"].items():
        print(f"  {k:28s} {v}")
    write_inventory_report(result, apply=args.apply)
    if not args.apply:
        print("\n[DRY-RUN] Запусти с `--apply`, чтобы записать wikilinks в raw-verbatim.")


if __name__ == "__main__":
    main()
