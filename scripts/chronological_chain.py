"""chronological_chain.py — хронологическая цепочка raw-verbatim orphans.

Мотивация (пользователь, 18.04 поздно вечером):
    «Изначально ещё просил связь сирот в цепочку хронологии сообщений и
    ответов на них включая компакты, а также связь с теми элементами из
    уже существующих на которые эти сообщения и действия повлияли.»

Эта часть не была сделана `semantic_linker.py` — тот работает по теме и дате,
но не строит цепь «user-turn → claude-reply → compact → следующий turn».
Настоящий скрипт закрывает этот gap: каждая нота `70-Chat/raw-verbatim/*.md`
получает в тело блок

    <!-- AUTO:chronological-chain:v1 START -->
    ## Хронологическая позиция
    - ← предыдущий: [[2026-04-11-044318-0400]]
    - → следующий: [[2026-04-11-044502-0402]]
    - сессия: 725bfdb8-55f0-45ec-a166-df2c4a389210
    - компакт после: да | нет
    - повлияло на:
        - [[AEMR_SOURCE_AUDIT]] (mtime 2026-04-11 04:47)
        - commit a1b2c3d (packages/shared/src/schemas.ts)
    <!-- AUTO:chronological-chain:v1 END -->

Источники истины:
    1. `.claude/projects/C--Users-filat-dash/*.jsonl` — транскрипты сессий
       (user/assistant/tool события с `timestamp` и `parentUuid`).
    2. `70-Chat/raw-verbatim/*.md` — 685 атомов, имя = `YYYY-MM-DD-HHMMSS-NNNN.md`.
    3. `70-Chat/session-continuations/*.md` — 115 auto-compact нот
       (frontmatter `timestamp:` + длина, source: claude-auto-compaction).
    4. `memory/**/*.md` — canonical-артефакты с mtime для «повлияло на».

Алгоритм:
    A. **Индекс JSONL**: читаем все jsonl построчно, собираем события
       {uuid, parentUuid, sessionId, role, timestamp, ts_dt}. Делаем
       compact-detection: user-messages с текстом, начинающимся на
       «This session is being continued from a previous conversation…»
       или с `isCompactSummary:true` → отмечаем boundary.
    B. **Индекс orphans**: по имени извлекаем timestamp (`date + HHMMSS`)
       и ordinal. Сортируем по ordinal.
    C. **Соседи (prev/next)**: цепь по ordinal. Сиротам перед/после компакта
       ставим метку «compact-boundary» (разрыв — значит сосед за границей,
       но ссылка всё равно есть — это преодолеваемый разрыв).
    D. **Связь с сессией**: ищем event с самым близким timestamp'ом в jsonl,
       берём его sessionId. Если ничего не нашлось в ±60 сек — `unknown`.
    E. **«Повлияло на»**: сканируем memory/ (плоская + audit/) и vault
       canonical-папки 00-Meta..50-Workflow рекурсивно. Для каждого файла
       берём mtime. Для orphan с ts_o: артефакты с mtime в окне
       [ts_o, ts_o + window_min] → «повлияло на» (максимум 5 на orphan,
       отсортировано по ближайшему Δt). Причинно-следственные edges из
       `AEMR_CAUSALITY_MAP.md` уже покрываются отдельным скриптом
       `causality_backlinks.py` — здесь не дублируем.

Принципы безопасности:
    - Dry-run по умолчанию. `--apply` — пишет.
    - Идемпотентный маркер `AUTO:chronological-chain:v1` (отдельно от
      semantic-link, не мешает ему).
    - Если сосед/сессия не найдены — блок всё равно пишется, с «unknown»
      в поле, чтобы было видно: мы попытались.
    - Максимум 5 артефактов в «повлияло на», чтобы не засорять.

Запуск:
    python scripts/chronological_chain.py              # dry-run + отчёт
    python scripts/chronological_chain.py --apply      # пишет в орфанов
    python scripts/chronological_chain.py --window-min 30  # окно влияния
    python scripts/chronological_chain.py --top 50     # лимит первых N
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from bisect import bisect_left
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

# --- Пути ---------------------------------------------------------------

VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
RAW_DIR = VAULT / "70-Chat" / "raw-verbatim"
CONTINUATIONS_DIR = VAULT / "70-Chat" / "session-continuations"

PROJECTS_DIR = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash")
MEMORY_DIR = PROJECTS_DIR / "memory"

OUTPUT_REPORT = MEMORY_DIR / "CHRONOLOGICAL_CHAIN_REPORT.md"

# --- Константы ----------------------------------------------------------

# Имя orphan: 2026-04-11-044405-0401.md
ORPHAN_NAME_RE = re.compile(
    r"^(20\d\d)-(\d\d)-(\d\d)-(\d\d)(\d\d)(\d\d)-(\d{4})$"
)

# Маркер идемпотентности
MARKER_START = "<!-- AUTO:chronological-chain:v1 START -->"
MARKER_END = "<!-- AUTO:chronological-chain:v1 END -->"
AUTO_BLOCK_RE = re.compile(
    r"\n?" + re.escape(MARKER_START) + r".*?" + re.escape(MARKER_END) + r"\n?",
    re.DOTALL,
)

# Детектор auto-compact (по префиксу текста user-turn'а)
COMPACT_PREFIX_RE = re.compile(
    r"^\s*(?:<[^>]+>\s*)?This session is being continued from a previous",
    re.IGNORECASE,
)

# Canonical-папки в memory/ (плоская + audit + archive отдельно)
MEMORY_TOP_DIRS = ["", "audit"]  # пустая = сам memory/

# Canonical-папки во vault (для «повлияло на» обсидиановские артефакты)
VAULT_CANONICAL_DIRS = [
    "00-Meta",
    "10-Index",
    "20-Knowledge",
    "30-Decisions",
    "40-Active",
    "50-Workflow",
]

FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


# --- Вспомогательные функции -------------------------------------------


def parse_orphan_name(stem: str):
    """'2026-04-11-044405-0401' → (datetime, ordinal) или (None, None)."""
    m = ORPHAN_NAME_RE.match(stem)
    if not m:
        return None, None
    y, mo, d, h, mi, s, ordn = m.groups()
    try:
        dt = datetime(
            int(y), int(mo), int(d), int(h), int(mi), int(s),
            tzinfo=timezone.utc,
        )
    except ValueError:
        return None, None
    return dt, int(ordn)


def parse_iso(ts: str):
    """'2026-03-26T11:30:24.624Z' → datetime aware (UTC)."""
    if not ts:
        return None
    try:
        # Python 3.11+ умеет fromisoformat с 'Z' начиная с 3.11; на 3.14 — ок.
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        return datetime.fromisoformat(ts)
    except Exception:
        return None


def parse_frontmatter(txt: str):
    m = FM_RE.match(txt)
    if not m:
        return {}, 0
    fm: dict = {}
    for line in m.group(1).split("\n"):
        if ":" in line and not line.startswith((" ", "\t", "-")):
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip().strip('"')
    return fm, m.end()


# --- Индекс JSONL -------------------------------------------------------


def index_jsonl_sessions(verbose: bool = True):
    """Сканирует все *.jsonl в projects dir. Возвращает:
       events: list of {uuid, parentUuid, sessionId, role, timestamp, ts_dt,
                        is_compact_boundary}
       events_by_ts: отсортированный list of (ts_dt, idx) — для bisect-поиска
       session_turns: {sessionId: [events...] сорт по ts]}
       compact_boundaries: list of {sessionId, ts_dt, kind}
    """
    events = []
    compact_boundaries = []

    jsonl_files = sorted(PROJECTS_DIR.glob("*.jsonl"))
    for jf in jsonl_files:
        if verbose:
            size_mb = jf.stat().st_size / (1024 * 1024)
            print(f"[jsonl] {jf.name} ({size_mb:.1f} MB)")
        try:
            with jf.open("r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue

                    etype = obj.get("type", "")
                    if etype not in ("user", "assistant"):
                        # queue-operation, summary и прочие пропускаем
                        continue

                    ts = obj.get("timestamp", "")
                    ts_dt = parse_iso(ts)
                    if ts_dt is None:
                        continue

                    msg = obj.get("message") or {}
                    role = msg.get("role") if isinstance(msg, dict) else etype

                    uuid = obj.get("uuid") or ""
                    parent = obj.get("parentUuid")
                    sid = obj.get("sessionId") or jf.stem

                    # compact-detection: user-turn с isCompactSummary=true
                    # либо текстовый префикс «This session is being continued…»
                    is_compact = False
                    if etype == "user":
                        # поле верхнего уровня
                        if obj.get("isCompactSummary") is True:
                            is_compact = True
                        else:
                            content = msg.get("content") if isinstance(msg, dict) else None
                            text = ""
                            if isinstance(content, str):
                                text = content
                            elif isinstance(content, list):
                                for part in content:
                                    if isinstance(part, dict):
                                        t = part.get("text") or part.get("content") or ""
                                        if isinstance(t, str):
                                            text += t
                            if text and COMPACT_PREFIX_RE.match(text[:400]):
                                is_compact = True

                    rec = {
                        "uuid": uuid,
                        "parent": parent,
                        "sessionId": sid,
                        "role": role or etype,
                        "etype": etype,
                        "ts_dt": ts_dt,
                        "is_compact_boundary": is_compact,
                    }
                    events.append(rec)
                    if is_compact:
                        compact_boundaries.append({
                            "sessionId": sid,
                            "ts_dt": ts_dt,
                        })
        except Exception as exc:
            if verbose:
                print(f"[warn] {jf.name}: {exc}")
            continue

    events.sort(key=lambda e: e["ts_dt"])
    session_turns: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        session_turns[e["sessionId"]].append(e)

    ts_list = [e["ts_dt"] for e in events]

    if verbose:
        print(f"[jsonl] events indexed: {len(events)}")
        print(f"[jsonl] sessions: {len(session_turns)}")
        print(f"[jsonl] compact boundaries: {len(compact_boundaries)}")

    return {
        "events": events,
        "ts_list": ts_list,
        "session_turns": session_turns,
        "compact_boundaries": compact_boundaries,
    }


def find_session_for_ts(index: dict, ts: datetime, window_sec: int = 60):
    """Находит sessionId ближайшего JSONL-события к данному timestamp.
       Возвращает (sessionId, delta_sec, event_role) или (None, None, None)."""
    ts_list = index["ts_list"]
    events = index["events"]
    if not ts_list:
        return None, None, None
    pos = bisect_left(ts_list, ts)
    # Кандидаты: события на pos-1 и pos
    best = None
    for k in (pos - 1, pos):
        if 0 <= k < len(events):
            e = events[k]
            delta = abs((e["ts_dt"] - ts).total_seconds())
            if delta <= window_sec and (best is None or delta < best[1]):
                best = (e, delta)
    if best is None:
        return None, None, None
    e, delta = best
    return e["sessionId"], delta, e["role"]


def find_compact_between(
    index: dict,
    sid: str | None,
    ts_a: datetime,
    ts_b: datetime,
) -> bool:
    """Есть ли компакт-граница между ts_a и ts_b (возможно, в той же сессии)."""
    if ts_a > ts_b:
        ts_a, ts_b = ts_b, ts_a
    for cb in index["compact_boundaries"]:
        if sid and cb["sessionId"] != sid:
            continue
        if ts_a <= cb["ts_dt"] <= ts_b:
            return True
    return False


# --- Session-continuations индекс --------------------------------------


def index_session_continuations():
    """Извлекает timestamp из frontmatter каждой continuation-ноты.
       Возвращает list of {stem, ts_dt, path}."""
    out = []
    if not CONTINUATIONS_DIR.is_dir():
        return out
    for p in sorted(CONTINUATIONS_DIR.glob("*.md")):
        try:
            txt = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        fm, _ = parse_frontmatter(txt)
        ts_raw = fm.get("timestamp") or ""
        ts_dt = parse_iso(ts_raw)
        if ts_dt is None:
            # Пробуем вытащить из имени: 2026-04-04-110705-0001
            dt, _ordn = parse_orphan_name(p.stem)
            ts_dt = dt
        if ts_dt is None:
            continue
        out.append({"stem": p.stem, "ts_dt": ts_dt, "path": p})
    out.sort(key=lambda r: r["ts_dt"])
    return out


def nearest_continuation(
    continuations: list,
    ts: datetime,
    window_hours: int = 2,
):
    """Ищем continuation с timestamp в окне ±window_hours от ts."""
    best = None
    best_delta = None
    for c in continuations:
        delta = abs((c["ts_dt"] - ts).total_seconds())
        if delta <= window_hours * 3600 and (
            best_delta is None or delta < best_delta
        ):
            best = c
            best_delta = delta
    return best


# --- Индекс memory-артефактов (для «повлияло на») ----------------------


def index_artifacts():
    """Собирает {stem, path, mtime_dt} всех .md в memory/ и vault canonical-
       папках. Используем mtime файла для 'повлияло на'."""
    out = []

    # memory/ (плоская) + memory/audit/
    for sub in MEMORY_TOP_DIRS:
        root = MEMORY_DIR if sub == "" else MEMORY_DIR / sub
        if not root.is_dir():
            continue
        for p in sorted(root.glob("*.md")):
            try:
                mtime = datetime.fromtimestamp(
                    p.stat().st_mtime, tz=timezone.utc
                )
            except Exception:
                continue
            out.append({
                "stem": p.stem,
                "path": p,
                "mtime_dt": mtime,
                "origin": "memory" + (f"/{sub}" if sub else ""),
            })

    # vault canonical-папки (00-Meta..50-Workflow, рекурсивно)
    for top in VAULT_CANONICAL_DIRS:
        root = VAULT / top
        if not root.is_dir():
            continue
        for p in root.rglob("*.md"):
            try:
                mtime = datetime.fromtimestamp(
                    p.stat().st_mtime, tz=timezone.utc
                )
            except Exception:
                continue
            out.append({
                "stem": p.stem,
                "path": p,
                "mtime_dt": mtime,
                "origin": f"vault/{top}",
            })

    return out


def artifacts_in_window(
    artifacts: list,
    ts: datetime,
    window_min: int,
    max_n: int = 5,
):
    """Артефакты с mtime в диапазоне [ts, ts + window_min]."""
    out = []
    lo = ts
    hi = ts + timedelta(minutes=window_min)
    for a in artifacts:
        if lo <= a["mtime_dt"] <= hi:
            out.append((a, (a["mtime_dt"] - ts).total_seconds()))
    out.sort(key=lambda x: x[1])
    return out[:max_n]


# --- Главная логика ----------------------------------------------------


def build_chronology(raw_files: list[Path]):
    """Сортирует orphans по ordinal (который встроен в имя)."""
    parsed = []
    for p in raw_files:
        dt, ordn = parse_orphan_name(p.stem)
        if dt is None or ordn is None:
            continue
        parsed.append({"path": p, "stem": p.stem, "ts_dt": dt, "ordinal": ordn})
    parsed.sort(key=lambda r: r["ordinal"])
    return parsed


def render_block(
    prev_stem: str | None,
    next_stem: str | None,
    session_id: str | None,
    session_delta_sec: float | None,
    compact_after: bool,
    compact_before: bool,
    continuation_stem: str | None,
    influenced: list,
) -> str:
    lines = [
        "",
        MARKER_START,
        "## Хронологическая позиция",
        "",
    ]
    if prev_stem:
        lines.append(f"- **← предыдущий:** [[{prev_stem}]]")
    else:
        lines.append("- **← предыдущий:** _первый в цепи_")
    if next_stem:
        lines.append(f"- **→ следующий:** [[{next_stem}]]")
    else:
        lines.append("- **→ следующий:** _последний в цепи_")

    if session_id:
        d = f", Δt≈{session_delta_sec:.1f}s" if session_delta_sec is not None else ""
        lines.append(f"- **Сессия (JSONL):** `{session_id}`{d}")
    else:
        lines.append("- **Сессия (JSONL):** _не сопоставлена_")

    if compact_before:
        lines.append("- **Компакт до этой точки:** да (auto-compaction в окне)")
    if compact_after:
        lines.append("- **Компакт после этой точки:** да (auto-compaction в окне)")

    if continuation_stem:
        lines.append(
            f"- **Ближайшая компакт-нота:** [[{continuation_stem}]]"
        )

    if influenced:
        lines.append("- **Повлияло на (mtime в окне):**")
        for a, delta in influenced:
            mins = delta / 60.0
            lines.append(
                f"    - [[{a['stem']}]] — `{a['origin']}`, Δt=+{mins:.1f} мин"
            )
    else:
        lines.append("- **Повлияло на:** _в окне не найдено совпадений_")

    lines.append(MARKER_END)
    lines.append("")
    return "\n".join(lines)


def process(
    apply: bool,
    window_min: int,
    top_n: int | None,
    session_window_sec: int,
):
    print(f"[info] vault: {VAULT}")
    print(f"[info] raw-verbatim: {RAW_DIR}")
    print(f"[info] dry-run: {not apply}")
    print(f"[info] influence window: {window_min} min")

    if not RAW_DIR.is_dir():
        print(f"[error] RAW_DIR not found: {RAW_DIR}", file=sys.stderr)
        sys.exit(1)

    # 1. Индексируем источники
    jsonl_index = index_jsonl_sessions()
    continuations = index_session_continuations()
    print(f"[info] session-continuations indexed: {len(continuations)}")
    artifacts = index_artifacts()
    print(f"[info] artifacts indexed: {len(artifacts)}")

    # 2. Парсим и сортируем orphans
    raw_files = sorted(RAW_DIR.glob("*.md"))
    print(f"[info] raw-verbatim files: {len(raw_files)}")
    chain = build_chronology(raw_files)
    print(f"[info] orphans parsed with valid name: {len(chain)}")

    stats = Counter()
    stats["total_raw"] = len(raw_files)
    stats["parseable"] = len(chain)
    stats["unparseable"] = len(raw_files) - len(chain)

    inventory = []

    for idx, rec in enumerate(chain):
        if top_n is not None and idx >= top_n:
            break

        prev_rec = chain[idx - 1] if idx > 0 else None
        next_rec = chain[idx + 1] if idx + 1 < len(chain) else None

        sid, delta, role = find_session_for_ts(
            jsonl_index, rec["ts_dt"], window_sec=session_window_sec
        )
        if sid:
            stats["session_matched"] += 1
        else:
            stats["session_unmatched"] += 1

        # Компакт в окне 5 мин до/после
        cb_after = False
        cb_before = False
        if next_rec:
            cb_after = find_compact_between(
                jsonl_index, sid, rec["ts_dt"], next_rec["ts_dt"]
            )
        if prev_rec:
            cb_before = find_compact_between(
                jsonl_index, sid, prev_rec["ts_dt"], rec["ts_dt"]
            )
        if cb_after or cb_before:
            stats["compact_adjacent"] += 1

        cont = nearest_continuation(continuations, rec["ts_dt"], window_hours=2)
        cont_stem = cont["stem"] if cont else None
        if cont:
            stats["continuation_attached"] += 1

        influenced = artifacts_in_window(
            artifacts, rec["ts_dt"], window_min=window_min, max_n=5
        )
        if influenced:
            stats["influenced_links"] += len(influenced)
            stats["with_influence"] += 1

        block = render_block(
            prev_stem=prev_rec["stem"] if prev_rec else None,
            next_stem=next_rec["stem"] if next_rec else None,
            session_id=sid,
            session_delta_sec=delta,
            compact_after=cb_after,
            compact_before=cb_before,
            continuation_stem=cont_stem,
            influenced=influenced,
        )

        # Пишем идемпотентно
        try:
            txt = rec["path"].read_text(encoding="utf-8", errors="replace")
        except Exception as exc:
            stats["read_error"] += 1
            continue
        stripped = AUTO_BLOCK_RE.sub("\n", txt)
        new_txt = stripped.rstrip() + "\n" + block
        changed = new_txt != txt

        inventory.append({
            "stem": rec["stem"],
            "ts": rec["ts_dt"].isoformat(),
            "ordinal": rec["ordinal"],
            "prev": prev_rec["stem"] if prev_rec else None,
            "next": next_rec["stem"] if next_rec else None,
            "session": sid,
            "session_delta": delta,
            "compact_before": cb_before,
            "compact_after": cb_after,
            "continuation": cont_stem,
            "influenced": [
                (a["stem"], a["origin"], round(d / 60.0, 1))
                for a, d in influenced
            ],
            "changed": changed,
        })
        if changed:
            stats["would_write" if not apply else "written"] += 1
            if apply:
                try:
                    rec["path"].write_text(new_txt, encoding="utf-8")
                except Exception:
                    stats["write_error"] += 1
        else:
            stats["already_up_to_date"] += 1

    return {
        "inventory": inventory,
        "stats": stats,
        "jsonl_index": jsonl_index,
        "continuations": continuations,
    }


# --- Отчёт -------------------------------------------------------------


def write_report(result: dict, apply: bool, window_min: int) -> None:
    inv = result["inventory"]
    stats = result["stats"]

    # Агрегация по дате
    by_date = defaultdict(list)
    for r in inv:
        d = r["ts"][:10]
        by_date[d].append(r)

    # Топ-10 ярких влияний
    with_infl = [r for r in inv if r["influenced"]]
    with_infl.sort(key=lambda r: -len(r["influenced"]))
    examples = with_infl[:10]

    # Компакт-bridges: все, где компакт соседствует
    bridges = [r for r in inv if r["compact_before"] or r["compact_after"]]

    lines = [
        "---",
        "type: report",
        "tags: [chronological-chain, orphan, jsonl, compact-boundary]",
        "generated: 2026-04-18",
        "script: scripts/chronological_chain.py",
        f"dry_run: {not apply}",
        f"influence_window_min: {window_min}",
        "---",
        "",
        "# CHRONOLOGICAL CHAIN REPORT — raw-verbatim × JSONL × artifacts",
        "",
        "> Отчёт скрипта `scripts/chronological_chain.py`. Показывает, сколько",
        "> orphan-заметок в `70-Chat/raw-verbatim/` получили хронологическую",
        "> позицию (prev/next в ordinal-цепочке), сопоставление с JSONL-сессией,",
        "> ближайшую auto-compact ноту и артефакты memory/vault, которые были",
        "> изменены в окне после конкретного сообщения.",
        "",
        "## Итог",
        "",
        f"- Всего файлов в `raw-verbatim/`: **{stats.get('total_raw', 0)}**",
        f"- С валидным именем (`YYYY-MM-DD-HHMMSS-NNNN.md`): **{stats.get('parseable', 0)}**",
        f"- Непарсящихся (особые имена, task-notification fragments): **{stats.get('unparseable', 0)}**",
        f"- Сопоставлено с JSONL-сессией (window ≤60с): **{stats.get('session_matched', 0)}**",
        f"- Не сопоставлено с сессией: **{stats.get('session_unmatched', 0)}**",
        f"- С компакт-границей по соседству: **{stats.get('compact_adjacent', 0)}**",
        f"- С прикрепленной continuation-нотой (окно ±2ч): **{stats.get('continuation_attached', 0)}**",
        f"- Со ссылками 'повлияло на' (хотя бы 1): **{stats.get('with_influence', 0)}**",
        f"- Всего прямых связей 'повлияло на': **{stats.get('influenced_links', 0)}**",
        f"- Будут записаны (dry-run) / записаны (apply): **{stats.get('would_write', 0) + stats.get('written', 0)}**",
        f"- Уже актуальны: **{stats.get('already_up_to_date', 0)}**",
        "",
        "## Режим",
        "",
        f"`{'APPLY' if apply else 'DRY-RUN'}` — influence window {window_min} минут.",
        "",
        "## Разбивка по дням",
        "",
        "| Дата | Orphans в цепи | Session matched | С compact-соседством | С 'повлияло на' |",
        "|------|---------------:|----------------:|---------------------:|----------------:|",
    ]
    for d in sorted(by_date.keys()):
        rs = by_date[d]
        n = len(rs)
        n_sess = sum(1 for r in rs if r["session"])
        n_cb = sum(1 for r in rs if r["compact_before"] or r["compact_after"])
        n_inf = sum(1 for r in rs if r["influenced"])
        lines.append(f"| {d} | {n} | {n_sess} | {n_cb} | {n_inf} |")
    lines.append("")

    lines.append("## Примеры богатых цепочек (топ-10 по числу 'повлияло на')")
    lines.append("")
    if not examples:
        lines.append("_Ни одного orphan не попал в окно влияния артефактов._")
    else:
        for r in examples:
            lines.append(
                f"### [[{r['stem']}]] — {r['ts'][:19]}"
            )
            lines.append("")
            lines.append(
                f"- сессия: `{r['session'] or '—'}` · "
                f"ordinal: {r['ordinal']} · "
                f"prev: `{r['prev'] or '—'}` · "
                f"next: `{r['next'] or '—'}`"
            )
            if r["compact_before"] or r["compact_after"]:
                parts = []
                if r["compact_before"]:
                    parts.append("до")
                if r["compact_after"]:
                    parts.append("после")
                lines.append(f"- компакт: **{', '.join(parts)}**")
            if r["continuation"]:
                lines.append(f"- continuation: [[{r['continuation']}]]")
            lines.append("- повлияло на:")
            for stem, origin, dm in r["influenced"]:
                lines.append(f"    - [[{stem}]] — `{origin}`, Δt=+{dm} мин")
            lines.append("")
    lines.append("")

    lines.append("## Компакт-bridges (orphans на границе компакта)")
    lines.append("")
    lines.append(f"Всего: **{len(bridges)}**")
    lines.append("")
    if bridges:
        lines.append("| # | Файл | Дата | Компакт | Continuation | Session |")
        lines.append("|---|------|------|---------|--------------|---------|")
        for i, r in enumerate(bridges[:50], start=1):
            k_parts = []
            if r["compact_before"]:
                k_parts.append("before")
            if r["compact_after"]:
                k_parts.append("after")
            lines.append(
                f"| {i} | `{r['stem']}` | {r['ts'][:10]} | "
                f"{','.join(k_parts)} | "
                f"{r['continuation'] or '—'} | "
                f"`{(r['session'] or '—')[:20]}` |"
            )
        if len(bridges) > 50:
            lines.append(f"| ... | _(ещё {len(bridges) - 50})_ | | | | |")
    lines.append("")

    lines.append("## Orphans без сопоставления с JSONL")
    lines.append("")
    unmatched = [r for r in inv if not r["session"]]
    lines.append(f"Всего: **{len(unmatched)}**.")
    lines.append("")
    lines.append(
        "Причины обычно: (а) timestamp в имени взят из внешнего source'а "
        "(task-notification не из JSONL), (б) сессия для этой даты "
        "отсутствует в `.claude/projects/C--Users-filat-dash/*.jsonl`, "
        "(в) drift больше 60 секунд между именем файла и событием JSONL."
    )
    lines.append("")
    if unmatched[:20]:
        lines.append("Первые 20:")
        lines.append("")
        for r in unmatched[:20]:
            lines.append(
                f"- `{r['stem']}` — {r['ts'][:19]} · "
                f"prev `{r['prev'] or '—'}` → next `{r['next'] or '—'}`"
            )
    lines.append("")

    lines.append("## Как читать Хронологическую позицию в orphan-ноте")
    lines.append("")
    lines.append(
        "- `← предыдущий` / `→ следующий` — соседи по ordinal в имени "
        "(`YYYY-MM-DD-HHMMSS-NNNN`). Это глобальный счётчик сохранённых "
        "сообщений, не привязанный к сессии. Если между соседями был компакт — "
        "в блоке будет явная метка `компакт до/после`."
    )
    lines.append(
        "- `Сессия (JSONL)` — sessionId JSONL-транскрипта, в котором нашлось "
        "событие с ближайшим timestamp (окно ≤60 с). Показывает, в какой "
        "непрерывной сессии это сообщение жило."
    )
    lines.append(
        "- `Компакт до/после` — auto-compaction boundary обнаружена в интервале "
        "между соседями (детектор ищет user-turn с префиксом "
        "«This session is being continued from…» или флагом "
        "`isCompactSummary`)."
    )
    lines.append(
        "- `Ближайшая компакт-нота` — ссылка на "
        "`70-Chat/session-continuations/…` в окне ±2 ч. Часто даёт текст "
        "summary, который Claude сохранил при компакте."
    )
    lines.append(
        "- `Повлияло на` — артефакты memory/ и vault canonical-папок, у "
        "которых **mtime попадает в окно [ts_orphan, ts_orphan + window_min]**. "
        "Это косвенная связь «после сообщения был изменён файл»."
    )
    lines.append("")

    OUTPUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"[info] report written: {OUTPUT_REPORT}")


# --- CLI ---------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="Записать блок в orphans (default dry-run).")
    ap.add_argument("--window-min", type=int, default=30,
                    help="Окно 'повлияло на' в минутах после orphan (default 30).")
    ap.add_argument("--session-window-sec", type=int, default=60,
                    help="Окно для сопоставления orphan↔JSONL-event (default 60 сек).")
    ap.add_argument("--top", type=int, default=None,
                    help="Ограничить первыми N orphans (для отладки).")
    args = ap.parse_args()

    result = process(
        apply=args.apply,
        window_min=args.window_min,
        top_n=args.top,
        session_window_sec=args.session_window_sec,
    )
    write_report(result, apply=args.apply, window_min=args.window_min)

    stats = result["stats"]
    print("[done] stats:", dict(stats))


if __name__ == "__main__":
    main()
