"""evergreen_distill.py — отбор «золотых» сирот из 70-Chat/raw-verbatim.

Задача:
  пройтись по всем 869 raw-verbatim файлам и выставить каждому score
  на основании эвристик (длина <result>, наличие god-nodes из graphify,
  совпадение с терминами SIGNAL_SYSTEM_RU.md, наличие таблиц / кода /
  длинного русского текста). Топ-N по score становится кандидатом на
  перенос в 20-Knowledge/evergreen/ с обратными ссылками.

Философия:
  - никогда не меняет оригинальные raw-verbatim файлы (read-only);
  - по-умолчанию dry-run, пишет только audit-таблицу;
  - --write-top N требует подтверждения при N > 10;
  - идемпотентный маркер AUTO:evergreen:v1 в evergreen-файле.

Запуск:
  python scripts/evergreen_distill.py                       # dry-run, печать топ-30
  python scripts/evergreen_distill.py --write-audit         # записать audit-таблицу
  python scripts/evergreen_distill.py --write-top 15        # создать 15 evergreen-нот
  python scripts/evergreen_distill.py --threshold 60        # переопределить порог
  python scripts/evergreen_distill.py --verbose             # подробный лог

Связь с репо:
  - использует graphify-out/GRAPH_REPORT.md (god-nodes, communities);
  - читает memory/SIGNAL_SYSTEM_RU.md для терминов сигналов;
  - пишет audit-таблицу в memory/audit/evergreen_candidates_<date>.md;
  - при --write-top создаёт evergreen-ноты в
    Obsidian/.../AEMR/20-Knowledge/evergreen/.
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# -----------------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------------

VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
RAW_DIR = VAULT / "70-Chat" / "raw-verbatim"
EVERGREEN_DIR = VAULT / "20-Knowledge" / "evergreen"

REPO_ROOT = Path(__file__).resolve().parents[1]
GRAPH_REPORT = REPO_ROOT / "graphify-out" / "GRAPH_REPORT.md"

MEMORY_ROOT = Path(
    r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory"
)
SIGNAL_SYSTEM = MEMORY_ROOT / "SIGNAL_SYSTEM_RU.md"
AUDIT_DIR = MEMORY_ROOT / "audit"
DECISIONS_DIR = VAULT / "30-Decisions"

# -----------------------------------------------------------------------------
# Regex signatures
# -----------------------------------------------------------------------------

RE_RESULT = re.compile(r"<result>(.*?)</result>", re.DOTALL)
RE_SUMMARY = re.compile(r"<summary>(.*?)</summary>", re.DOTALL)
RE_BACKGROUND = re.compile(r'Background command ".*?" completed', re.IGNORECASE)
RE_STOP_HOOK = re.compile(r"^\s*Stop hook feedback", re.IGNORECASE)
RE_TABLE = re.compile(r"\n\|[^\n]+\|\n\|[\s\-\:\|]+\|", re.MULTILINE)
RE_CODE_BLOCK = re.compile(r"```(ts|tsx|python|py|js|jsx|json|sql)\b", re.IGNORECASE)
RE_CYRILLIC = re.compile(r"[а-яА-ЯёЁ]")
RE_GOD_LINE = re.compile(r"^\s*\d+\.\s+`([^`]+)`\s+-\s+\d+\s+edges", re.MULTILINE)
RE_COMMUNITY_NODES = re.compile(r"^Nodes \(\d+\):\s*(.*)$", re.MULTILINE)
RE_DATE_NAME = re.compile(r"(20\d\d)-(\d\d)-(\d\d)-\d{6}-\d{4}")

# Threshold below which file is useless noise.
NOISE_CAP = -80

# -----------------------------------------------------------------------------
# Dataclasses
# -----------------------------------------------------------------------------


@dataclass
class Candidate:
    path: Path
    score: int = 0
    reasons: list[str] = field(default_factory=list)
    size: int = 0
    result_len: int = 0
    summary: str = ""
    first_result_line: str = ""
    has_table: bool = False
    has_code: bool = False
    date: str = ""

    @property
    def slug(self) -> str:
        return self.path.stem

    def to_row(self) -> str:
        first = self.first_result_line.replace("|", "/").strip()[:90]
        if not first:
            first = "(no <result>)"
        summary = self.summary.replace("|", "/").strip()[:50]
        return (
            f"| {self.score:>4} | [[70-Chat/raw-verbatim/{self.slug}]] "
            f"| {summary or '—'} | {self.size:>6} | {first} |"
        )


# -----------------------------------------------------------------------------
# Heuristics source loaders
# -----------------------------------------------------------------------------


def load_god_nodes() -> set[str]:
    if not GRAPH_REPORT.exists():
        return set()
    txt = GRAPH_REPORT.read_text(encoding="utf-8", errors="replace")
    # God-nodes lines look like "1. `CalcEngine` - 9 edges"
    nodes = set(RE_GOD_LINE.findall(txt))
    # Also include tokens from community-Nodes lines (first 30 communities).
    for match in RE_COMMUNITY_NODES.findall(txt)[:30]:
        for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]{3,}", match):
            nodes.add(token)
    return nodes


def load_signal_terms() -> set[str]:
    if not SIGNAL_SYSTEM.exists():
        return set()
    txt = SIGNAL_SYSTEM.read_text(encoding="utf-8", errors="replace")
    # Grab bold headers and backticked tokens.
    terms: set[str] = set()
    for match in re.findall(r"\*\*([^\*]{4,40})\*\*", txt):
        terms.add(match.strip().lower())
    for match in re.findall(r"`([^`]{4,40})`", txt):
        terms.add(match.strip().lower())
    return terms


def load_decision_dates() -> set[str]:
    if not DECISIONS_DIR.exists():
        return set()
    dates: set[str] = set()
    for p in DECISIONS_DIR.rglob("*.md"):
        m = re.search(r"(20\d\d)[-_](\d\d)[-_](\d\d)", p.stem)
        if m:
            dates.add("-".join(m.groups()))
    return dates


# -----------------------------------------------------------------------------
# Scoring
# -----------------------------------------------------------------------------


def score_file(path: Path, god_nodes: set[str], signal_terms: set[str],
               decision_dates: set[str]) -> Candidate:
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return Candidate(path=path, score=NOISE_CAP, reasons=["unreadable"])

    cand = Candidate(path=path, size=len(raw))

    m = RE_RESULT.search(raw)
    if m:
        body = m.group(1).strip()
        cand.result_len = len(body)
        cand.first_result_line = body.splitlines()[0] if body.splitlines() else ""
        if cand.result_len >= 2000:
            cand.score += 25
            cand.reasons.append("result>=2000")
        elif cand.result_len >= 500:
            cand.score += 15
            cand.reasons.append("result>=500")
        else:
            cand.score += 5
            cand.reasons.append("short_result")
    else:
        if cand.size >= 1500:
            cand.score += 10
            cand.reasons.append("long_no_result")

    s = RE_SUMMARY.search(raw)
    if s:
        cand.summary = s.group(1).strip().splitlines()[0][:80]
        # Significant if summary mentions an Agent with named task.
        if re.search(r"Agent\s+\"[^\"]{10,}\"", s.group(1)):
            cand.score += 10
            cand.reasons.append("named_agent")

    # God-node mentions.
    hits = sum(1 for g in god_nodes if g and g in raw)
    if hits >= 2:
        cand.score += 20
        cand.reasons.append(f"god_nodes({hits})")
    elif hits == 1:
        cand.score += 8
        cand.reasons.append("god_node(1)")

    # Signal terms.
    low = raw.lower()
    term_hits = sum(1 for t in signal_terms if t and t in low)
    if term_hits >= 3:
        cand.score += 15
        cand.reasons.append(f"signal_terms({term_hits})")
    elif term_hits >= 1:
        cand.score += 5
        cand.reasons.append(f"signal_terms({term_hits})")

    # Code blocks.
    if RE_CODE_BLOCK.search(raw):
        cand.has_code = True
        cand.score += 5
        cand.reasons.append("code_block")

    # Tables.
    if RE_TABLE.search(raw):
        cand.has_table = True
        cand.score += 5
        cand.reasons.append("table")

    # Cyrillic volume.
    if len(RE_CYRILLIC.findall(raw)) >= 300:
        cand.score += 5
        cand.reasons.append("russian_300+")

    # Decision date co-occurrence.
    dm = RE_DATE_NAME.match(path.stem)
    if dm:
        cand.date = "-".join(dm.groups())
        if cand.date in decision_dates:
            cand.score += 10
            cand.reasons.append("decision_date")

    # Noise penalties (can drop score below 0).
    if RE_STOP_HOOK.match(raw):
        cand.score -= 100
        cand.reasons.append("STOP_HOOK")
    if not m and RE_BACKGROUND.search(raw):
        cand.score -= 100
        cand.reasons.append("BACKGROUND_NOOP")
    if cand.size < 400 and not m:
        cand.score -= 50
        cand.reasons.append("too_small")

    return cand


# -----------------------------------------------------------------------------
# Reporting
# -----------------------------------------------------------------------------


def audit_table(candidates: list[Candidate], top: int) -> str:
    header = (
        "| Score | Файл | Summary | Size | Первая строка <result> |\n"
        "|------:|------|---------|-----:|-------------------------|\n"
    )
    rows = [c.to_row() for c in candidates[:top]]
    return header + "\n".join(rows) + "\n"


def write_audit(candidates: list[Candidate], out: Path, top: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    total = len(candidates)
    visible = sum(1 for c in candidates if c.score >= 50)
    pct = 100 * visible / total if total else 0
    body = (
        f"---\n"
        f"type: audit-evergreen\n"
        f"created: {datetime.now():%Y-%m-%d}\n"
        f"source: scripts/evergreen_distill.py\n"
        f"total_files: {total}\n"
        f"evergreen_candidates: {visible} ({pct:.1f}%)\n"
        f"---\n\n"
        f"# Кандидаты в evergreen (топ-{top}, сортировка по score)\n\n"
        f"Итого: **{total}** файлов обработано, **{visible}** со score ≥ 50\n\n"
    )
    body += audit_table(candidates, top)
    out.write_text(body, encoding="utf-8")
    print(f"[audit] записано {out}")


def pick_hub(cand: Candidate) -> str:
    text = cand.path.read_text(encoding="utf-8", errors="replace").lower()
    hubs = [
        ("ui", "10-Index/Dashboard-UI"),
        ("filter", "10-Index/Dashboard-UI"),
        ("карточк", "10-Index/Dashboard-UI"),
        ("signal", "10-Index/Signal-System"),
        ("сигнал", "10-Index/Signal-System"),
        ("trust", "10-Index/Pipeline-Audit"),
        ("pipeline", "10-Index/Pipeline-Audit"),
        ("calc", "10-Index/Pipeline-Audit"),
        ("44-фз", "10-Index/44-FZ-Procurement"),
        ("нмцк", "10-Index/44-FZ-Procurement"),
        ("бюджет", "10-Index/44-FZ-Procurement"),
        ("agent", "10-Index/Agent-Swarm"),
        ("swarm", "10-Index/Agent-Swarm"),
    ]
    for token, hub in hubs:
        if token in text:
            return hub
    return "10-Index/Workflow"


def write_evergreen(cand: Candidate) -> Path:
    EVERGREEN_DIR.mkdir(parents=True, exist_ok=True)
    slug = cand.slug
    out = EVERGREEN_DIR / f"{slug}.md"
    raw = cand.path.read_text(encoding="utf-8", errors="replace")
    m = RE_RESULT.search(raw)
    summary_body = (m.group(1).strip() if m else raw).strip()[:600]
    hub = pick_hub(cand)
    body = (
        f"---\n"
        f"type: evergreen\n"
        f"source: raw-verbatim\n"
        f"raw: \"[[70-Chat/raw-verbatim/{slug}]]\"\n"
        f"score: {cand.score}\n"
        f"date: {cand.date or 'unknown'}\n"
        f"hub: \"[[{hub}]]\"\n"
        f"reasons: {cand.reasons}\n"
        f"created: {datetime.now():%Y-%m-%d}\n"
        f"---\n\n"
        f"<!-- AUTO:evergreen:v1 START -->\n\n"
        f"# Evergreen: {cand.summary or slug}\n\n"
        f"> Выжимка из автоматически отобранного tool-result'а.\n"
        f"> Агент: `{cand.summary or 'unknown'}`\n"
        f"> Score: **{cand.score}** ({', '.join(cand.reasons)})\n\n"
        f"## Суть\n\n"
        f"{summary_body}\n\n"
        f"## Источник\n\n"
        f"- [[70-Chat/raw-verbatim/{slug}]]\n\n"
        f"## Хаб\n\n"
        f"- [[{hub}]]\n\n"
        f"<!-- AUTO:evergreen:v1 END -->\n"
    )
    out.write_text(body, encoding="utf-8")
    return out


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write-audit", action="store_true",
                    help="write audit table to memory/audit/")
    ap.add_argument("--write-top", type=int, default=0,
                    help="write N top evergreen notes (requires confirm if > 10)")
    ap.add_argument("--threshold", type=int, default=50,
                    help="score threshold for 'evergreen candidate' stat")
    ap.add_argument("--top", type=int, default=30,
                    help="rows in preview table")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if not RAW_DIR.exists():
        print(f"[error] {RAW_DIR} не существует", file=sys.stderr)
        return 2

    god = load_god_nodes()
    signals = load_signal_terms()
    dec_dates = load_decision_dates()
    if args.verbose:
        print(f"[load] god-nodes: {len(god)}, signal-terms: {len(signals)}, "
              f"decision-dates: {len(dec_dates)}")

    files = sorted(RAW_DIR.glob("*.md"))
    if args.verbose:
        print(f"[scan] raw-verbatim files: {len(files)}")
    cands = [score_file(p, god, signals, dec_dates) for p in files]
    cands.sort(key=lambda c: c.score, reverse=True)

    visible = sum(1 for c in cands if c.score >= args.threshold)
    print(f"Итого файлов: {len(cands)}")
    print(f"  со score ≥ {args.threshold}: {visible}")
    print(f"  ≤ {NOISE_CAP} (шум):         "
          f"{sum(1 for c in cands if c.score <= NOISE_CAP)}")
    print()
    print(f"Preview топ-{args.top}:")
    print(audit_table(cands, args.top))

    if args.write_audit:
        out = AUDIT_DIR / f"evergreen_candidates_{datetime.now():%Y-%m-%d}.md"
        write_audit(cands, out, args.top)

    if args.write_top:
        n = args.write_top
        if n > 10:
            reply = input(
                f"Будет создано {n} файлов в {EVERGREEN_DIR}. Продолжить? [y/N] "
            ).strip().lower()
            if reply != "y":
                print("[skip] отменено пользователем")
                return 0
        created = 0
        for cand in cands[:n]:
            if cand.score < args.threshold:
                break
            out = write_evergreen(cand)
            created += 1
            if args.verbose:
                print(f"[evergreen] {out}")
        print(f"[done] создано evergreen-нот: {created}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
