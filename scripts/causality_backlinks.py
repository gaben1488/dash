"""causality_backlinks.py — причинно-следственные backlink'и.

Отличие от `hub_backlinks.py` и `link_orphans_by_date.py`:

- `hub_backlinks.py` пишет ссылки **из хабов** на сирот (хаб тянет одеяло).
- `link_orphans_by_date.py` пишет ссылки **из сироты** на хабы той же даты
  (сирота получает outlinks, но всё равно остаётся без inlinks).
- `causality_backlinks.py` пишет ссылки **из артефакта** на породившие его
  user-сообщения в `70-Chat/raw-verbatim/`. Тогда у каждого chat-атома
  появляется обратная ссылка (Obsidian backlink), и он перестаёт быть сиротой.

Логика:
1. Скан vault.
2. Классификация каждой ноты: chat-message (`70-Chat/raw-verbatim/`) или artifact.
3. Для каждого артефакта (curated) находим chat-сообщения, которые с большой
   вероятностью его «породили»:
   - **дата близка** (mtime артефакта в окне +/- 48 часов от timestamp сообщения),
   - **общие токены** (>=2 редких токенов из имени/тела сообщения встречаются
     в имени/теле артефакта),
   - **тема в causality_map** (если AEMR_CAUSALITY_MAP.md содержит edge с этой
     датой и темой — добавляем отдельный сильный bonus).
4. Берём топ-3 на артефакт.
5. Пишем секцию `## Порождено сообщениями` в конец артефакта, обёрнутую
   маркерами `<!-- AUTO:causality:v1 START/END -->` для идемпотентности.

Запуск:
  python scripts/causality_backlinks.py                 # dry-run
  python scripts/causality_backlinks.py --apply         # писать
  python scripts/causality_backlinks.py --max-per 2     # не больше 2 на артефакт
  python scripts/causality_backlinks.py --window-hours 72
  python scripts/causality_backlinks.py --top 10        # печать топ-10 связей
"""
from __future__ import annotations
import argparse
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

VAULT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR")
CHAT_DIR = "70-Chat"  # сегмент пути, который помечает chat-message
SKIP_DIRS = {'.obsidian', '.trash', '.git', 'Attachments', 'Templates'}

CAUSALITY_MAP_PATH = Path(
    r"C:/Users/filat/.claude/projects/C--Users-filat-dash/memory/AEMR_CAUSALITY_MAP.md"
)

FM_RE = re.compile(r'^---\n(.*?)\n---\n', re.DOTALL)
WIKILINK_RE = re.compile(r'\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]')

# Имя chat-сообщения вида 2026-04-04-172308-0057.md
CHAT_NAME_RE = re.compile(r'(20\d\d)-(\d\d)-(\d\d)-(\d\d)(\d\d)(\d\d)-(\d{4})')

# Дата в имени (артефакт): 2026-04-13, 2026_04_13
ART_DATE_RE = re.compile(r'(20\d\d)[-_](\d\d)[-_](\d\d)')

MARKER = 'AUTO:causality:v1'
BLOCK_RE = re.compile(
    rf'\n?<!-- {MARKER} START -->.*?<!-- {MARKER} END -->\n?',
    re.DOTALL,
)

# Стоп-слова — не считаем их «значащими» при матчинге.
STOP_TOKENS = set("""
the and for with this that from into your also are has been but not all any one
two now new old via use used using same just such more less only than then
было быть его это эти этого этому этим эта тех там тут уже еще или но или
если когда чтобы как что-то что-нибудь как-то так-то ведь даже хоть хотя
сам сама само сами сейчас тогда тоже того этом этих такой такая такое такие
вот они ему ей нам вам вас нас нам мне мной тобой собой свой своя свои своё
один два три четыре пять весь все вся всё всех всем
md txt json ts tsx js jsx css scss html py md
""".split())

# Темы из AEMR_CAUSALITY_MAP §3 (грубо — для bonus'а).
# Ключ — нормализованный токен темы; значение — список (date, edge_id).
# Загружается лениво в `_load_causal_themes`.
_CAUSAL_THEMES_CACHE: dict[str, list[tuple[str, str]]] | None = None


def is_skipped(p: Path) -> bool:
    try:
        rel = p.relative_to(VAULT).parts
    except ValueError:
        return True
    return any(part in SKIP_DIRS for part in rel)


def is_chat_message(p: Path) -> bool:
    try:
        rel = p.relative_to(VAULT).parts
    except ValueError:
        return False
    return CHAT_DIR in rel


def parse_chat_timestamp(stem: str) -> datetime | None:
    m = CHAT_NAME_RE.search(stem)
    if not m:
        return None
    y, mo, d, h, mi, se, _seq = m.groups()
    try:
        return datetime(int(y), int(mo), int(d), int(h), int(mi), int(se))
    except ValueError:
        return None


def parse_artifact_date(p: Path, text: str) -> datetime | None:
    """Дата артефакта: имя > frontmatter date/created/updated > mtime."""
    m = ART_DATE_RE.search(p.stem)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    fm = FM_RE.match(text)
    if fm:
        for line in fm.group(1).split('\n'):
            ls = line.strip()
            for k in ('date:', 'created:', 'updated:', 'generated:'):
                if ls.startswith(k):
                    val = ls.partition(':')[2].strip().strip('"\'')
                    vm = ART_DATE_RE.search(val)
                    if vm:
                        try:
                            return datetime(int(vm.group(1)), int(vm.group(2)),
                                            int(vm.group(3)))
                        except ValueError:
                            pass
    try:
        return datetime.fromtimestamp(p.stat().st_mtime)
    except OSError:
        return None


def tokenize(text: str, limit: int = 4000) -> list[str]:
    """Извлечь нормализованные токены (>=4 символа, не stop-words)."""
    snippet = text[:limit].lower()
    raw = re.findall(r'[\w]{4,}', snippet, re.UNICODE)
    out = []
    for w in raw:
        if w in STOP_TOKENS:
            continue
        if w.isdigit():
            continue
        out.append(w)
    return out


def rare_tokens(tokens: list[str], doc_freq: Counter[str],
                total_docs: int, min_idf: float = 1.5) -> set[str]:
    """Оставить только редкие (доля документов где токен встречается < ~22%)."""
    import math
    rare = set()
    for t in set(tokens):
        df = doc_freq.get(t, 0)
        if df == 0:
            continue
        idf = math.log((total_docs + 1) / (df + 1))
        if idf >= min_idf:
            rare.add(t)
    return rare


def _load_causal_themes() -> dict[str, list[tuple[str, str]]]:
    """Загрузить «темы x даты» из AEMR_CAUSALITY_MAP §3.

    Эвристика: каждая строка таблицы вида `| N | дата | темы | ... |` —
    разрезаем темы по запятой, берём как list of theme tokens.
    """
    global _CAUSAL_THEMES_CACHE
    if _CAUSAL_THEMES_CACHE is not None:
        return _CAUSAL_THEMES_CACHE
    res: dict[str, list[tuple[str, str]]] = defaultdict(list)
    if not CAUSALITY_MAP_PATH.exists():
        _CAUSAL_THEMES_CACHE = res
        return res
    txt = CAUSALITY_MAP_PATH.read_text(encoding='utf-8', errors='replace')
    # Грубое выделение строк таблицы §3 (после "| # | user_turn ... |").
    in_table = False
    for line in txt.splitlines():
        if line.startswith('| # |') and 'user_turn' in line:
            in_table = True
            continue
        if in_table:
            if not line.startswith('|'):
                in_table = False
                continue
            cols = [c.strip() for c in line.strip('|').split('|')]
            if len(cols) < 4:
                continue
            ts_col = cols[1]
            theme_col = cols[2]
            dm = re.search(r'(20\d\d)-(\d\d)-(\d\d)', ts_col)
            if not dm:
                continue
            date = f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}"
            for theme in re.split(r'[,/]', theme_col):
                theme = theme.strip().lower()
                if not theme or theme.startswith('--'):
                    continue
                # темы вроде "Ф4 Dashboard" — разбиваем на токены и берём редкие.
                for tok in re.findall(r'[\w]{3,}', theme, re.UNICODE):
                    if tok in STOP_TOKENS:
                        continue
                    res[tok].append((date, f"edge-{cols[0]}"))
    _CAUSAL_THEMES_CACHE = res
    return res


def scan_vault():
    chat_msgs = []   # list of dicts (path, ts, tokens, text_head, label)
    artifacts = []   # list of dicts (path, dt, tokens, text_head)
    stem_to_path: dict[str, Path] = {}
    doc_freq: Counter[str] = Counter()

    for p in VAULT.rglob('*.md'):
        if is_skipped(p):
            continue
        try:
            txt = p.read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue
        stem_to_path[p.stem] = p
        toks = tokenize(p.stem.replace('-', ' ') + ' ' + txt)
        for t in set(toks):
            doc_freq[t] += 1

        if is_chat_message(p):
            ts = parse_chat_timestamp(p.stem)
            if ts is None:
                continue
            label = make_label(txt)
            chat_msgs.append({
                'path': p, 'ts': ts, 'tokens': toks,
                'label': label, 'text_head': txt[:600],
            })
        else:
            dt = parse_artifact_date(p, txt)
            artifacts.append({
                'path': p, 'dt': dt, 'tokens': toks,
                'text_head': txt[:600],
            })

    return chat_msgs, artifacts, stem_to_path, doc_freq


def make_label(text: str) -> str:
    """Короткая метка сообщения для отображения в backlink'е."""
    body = text
    fm = FM_RE.match(text)
    if fm:
        body = text[fm.end():]
    body = body.strip()
    # Берём первое содержательное предложение, до 80 символов.
    snippet = re.sub(r'\s+', ' ', body[:300]).strip()
    if not snippet:
        return 'сообщение'
    if len(snippet) > 80:
        snippet = snippet[:77].rstrip() + '...'
    return snippet


def build_inlink_count(chat_msgs, artifacts, stem_to_path) -> Counter[str]:
    cnt: Counter[str] = Counter()
    for n in chat_msgs + artifacts:
        try:
            txt = n['path'].read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue
        for m in WIKILINK_RE.finditer(txt):
            target = m.group(1).strip().split('/')[-1]
            cnt[target] += 1
    return cnt


def score_pair(art, msg, art_rare, msg_rare, themes,
               window_hours: int) -> tuple[int, list[str]]:
    """Вернуть (score, reasons). Требуется ≥2 сигнала."""
    reasons: list[str] = []
    score = 0

    # Сигнал 1: близость по дате (артефакт после сообщения, в окне).
    if art.get('dt') and msg.get('ts'):
        delta = art['dt'] - msg['ts']
        # Артефакт должен идти ПОСЛЕ сообщения (причина → следствие).
        if timedelta(hours=-2) <= delta <= timedelta(hours=window_hours):
            score += 5
            reasons.append(
                f"date Δ={delta.total_seconds()/3600:+.1f}h"
            )

    # Сигнал 2: общие редкие токены.
    common = art_rare & msg_rare
    if len(common) >= 2:
        score += 3 + min(len(common), 5)
        reasons.append(f"tokens={','.join(sorted(common)[:4])}")
    elif len(common) == 1:
        score += 1
        reasons.append(f"token={next(iter(common))}")

    # Сигнал 3: causal-map theme (если у сообщения есть тема, упомянутая
    # в AEMR_CAUSALITY_MAP, и артефакт того же дня).
    if art.get('dt') and msg.get('ts'):
        msg_date = msg['ts'].strftime('%Y-%m-%d')
        for tok in msg_rare:
            for theme_date, edge in themes.get(tok, []):
                if theme_date == msg_date:
                    score += 4
                    reasons.append(f"causal-map[{edge}/{tok}]")
                    break
            else:
                continue
            break

    return score, reasons


def render_block(picks: list[tuple[dict, int, list[str]]]) -> str:
    lines = [f'<!-- {MARKER} START -->', '## Порождено сообщениями', '']
    for msg, score, reasons in picks:
        rel = msg['path'].relative_to(VAULT).with_suffix('').as_posix()
        ts = msg['ts'].strftime('%Y-%m-%d %H:%M')
        label = msg['label'].replace('|', '/').replace(']', ')')
        # signal-tag в комментарий, чтобы не шумел в Obsidian-рендере.
        sig = '; '.join(reasons)
        lines.append(f"- **{ts}** · [[{rel}|{label}]] <!-- {sig} -->")
    lines.append(f'<!-- {MARKER} END -->')
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='Записать изменения')
    ap.add_argument('--max-per', type=int, default=3,
                    help='Макс. сообщений на артефакт')
    ap.add_argument('--window-hours', type=int, default=72,
                    help='Окно «сообщение → артефакт» в часах')
    ap.add_argument('--min-score', type=int, default=8,
                    help='Минимальный score, чтобы записать связь')
    ap.add_argument('--top', type=int, default=10,
                    help='Сколько топ-связей напечатать')
    args = ap.parse_args()

    print(f"Scanning {VAULT} ...")
    chat_msgs, artifacts, stem_to_path, doc_freq = scan_vault()
    total = len(chat_msgs) + len(artifacts)
    print(f"  chat messages : {len(chat_msgs)}")
    print(f"  artifacts     : {len(artifacts)}")

    inlink_cnt = build_inlink_count(chat_msgs, artifacts, stem_to_path)
    chat_orphans = [m for m in chat_msgs if inlink_cnt[m['path'].stem] < 2]
    print(f"  chat orphans  : {len(chat_orphans)}  (< 2 inlinks)")

    themes = _load_causal_themes()
    print(f"  causal themes : {len(themes)} токенов из causality map")

    # Пред-вычисление редких токенов.
    msg_rare = {m['path']: rare_tokens(m['tokens'], doc_freq, total)
                for m in chat_msgs}
    art_rare = {a['path']: rare_tokens(a['tokens'], doc_freq, total)
                for a in artifacts}

    # Индексация сообщений по дате (для быстрого окна).
    msgs_by_date: dict[str, list[dict]] = defaultdict(list)
    for m in chat_msgs:
        if m['ts']:
            msgs_by_date[m['ts'].strftime('%Y-%m-%d')].append(m)

    plans = []  # (artifact, [(msg, score, reasons)...])
    for art in artifacts:
        if not art.get('dt'):
            continue
        candidates: list[tuple[dict, int, list[str]]] = []
        # Окно сообщений: 5 дней до даты артефакта.
        for offset in range(0, 6):
            day = (art['dt'] - timedelta(days=offset)).strftime('%Y-%m-%d')
            for msg in msgs_by_date.get(day, []):
                s, r = score_pair(
                    art, msg, art_rare[art['path']], msg_rare[msg['path']],
                    themes, args.window_hours,
                )
                # Требуем ≥2 сигнала: либо date+tokens, либо date+causal-map,
                # либо tokens+causal-map. Минимальный score 8.
                if s >= args.min_score and len(r) >= 2:
                    candidates.append((msg, s, r))
        candidates.sort(key=lambda x: -x[1])
        if not candidates:
            continue
        picks = candidates[:args.max_per]
        plans.append((art, picks))

    # Метрика: сколько chat-orphan'ов получит хотя бы 1 inlink.
    orphans_will_get = set()
    for art, picks in plans:
        for msg, _, _ in picks:
            if inlink_cnt[msg['path'].stem] < 2:
                orphans_will_get.add(msg['path'])

    print(f"\n=== PLAN ===")
    print(f"  artifacts touched : {len(plans)}")
    print(f"  chat orphans that will get >=1 inlink: {len(orphans_will_get)} "
          f"of {len(chat_orphans)}")
    remaining = max(0, len(chat_orphans) - len(orphans_will_get))
    print(f"  estimated remaining chat-orphans: {remaining}")

    # Топ-связей для проверки.
    flat = [(art, msg, s, r) for art, picks in plans for (msg, s, r) in picks]
    flat.sort(key=lambda x: -x[2])
    print(f"\n=== TOP {args.top} STRONGEST CAUSAL LINKS ===")
    for art, msg, s, r in flat[:args.top]:
        ar = art['path'].relative_to(VAULT)
        mr = msg['path'].relative_to(VAULT)
        print(f"  score={s} · {ar}")
        print(f"            ← {mr}")
        print(f"            reasons: {'; '.join(r)}")

    # Apply.
    written = 0
    for art, picks in plans:
        block = render_block(picks)
        old = art['path'].read_text(encoding='utf-8', errors='replace')
        cleaned = BLOCK_RE.sub('\n', old)
        new = cleaned.rstrip() + '\n\n' + block + '\n'
        if new == old:
            continue
        written += 1
        if args.apply:
            art['path'].write_text(new, encoding='utf-8')

    print(f"\n=== {'APPLIED' if args.apply else 'DRY-RUN'} ===")
    print(f"  files {'written' if args.apply else 'would write'}: {written}")
    if not args.apply:
        print("  re-run with --apply to write.")


if __name__ == '__main__':
    main()
