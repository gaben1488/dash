"""Build a deep USER PROFILE atom from Claude Code JSONL.

Reads all user messages, analyzes tone/pacing/approval/frustration/
vocabulary/pacing, and writes ONE big atom:
   C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/20-Knowledge/personas/user-profile.md
"""
import json, re, os, sys, io
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

SRC = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/725bfdb8-55f0-45ec-a166-df2c4a389210.jsonl")
OUT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/20-Knowledge/personas/user-profile.md")
MSG_DIR = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/70-Chat/messages")

sys.stdout.reconfigure(encoding="utf-8")

# ─── extraction ─────────────────────────────────────────────────────────
def extract_text(content):
    if isinstance(content, str):
        if content.startswith('<command-') or content.startswith('<local-command'):
            return ''
        if '[Request interrupted' in content:
            return ''
        if 'caveat: the messages do not contain' in content.lower():
            return ''
        return content
    if isinstance(content, list):
        parts = []
        for it in content:
            if not isinstance(it, dict):
                continue
            if it.get('type') == 'tool_result':
                return ''
            if it.get('type') == 'text':
                parts.append(it.get('text', ''))
        return '\n'.join(parts)
    return ''

msgs = []  # list of dicts: {ts, text, dt, hour, weekday, len}
with SRC.open(encoding='utf-8') as f:
    for line in f:
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get('type') != 'user':
            continue
        m = o.get('message') or {}
        if m.get('role') != 'user':
            continue
        text = (extract_text(m.get('content')) or '').strip()
        if not text:
            continue
        ts = o.get('timestamp') or ''
        try:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except Exception:
            dt = None
        msgs.append({
            'ts': ts,
            'text': text,
            'dt': dt,
            'hour': dt.hour if dt else None,
            'weekday': dt.weekday() if dt else None,
            'len': len(text),
        })

N = len(msgs)
print(f"USER_MSGS={N}", file=sys.stderr)

# ─── pattern counters ───────────────────────────────────────────────────
def count(pattern, flags=re.IGNORECASE):
    rx = re.compile(pattern, flags)
    hits = 0
    ex = []
    for m in msgs:
        if rx.search(m['text']):
            hits += 1
            if len(ex) < 5:
                ex.append(m)
    return hits, ex

# Frustration vocab
FRUSTRATION = {
    'опять': r'\bопять\b',
    'снова': r'\bснова\b',
    'блядь/блять': r'\bбл[яе]дь?\b|\bбл(я|е)ть\b',
    'нахуй': r'\bна(х|хуй)\b',
    'пиздец': r'\bпиздец\b',
    'ебан/ебать': r'\bеба(н|ть|л)\b',
    'хуй/хуёв': r'\bху[йёе]',
    'не работает': r'не\s+работа',
    'сломал(а|о)сь': r'сломал',
    'бесит': r'\bбеси',
    'раздража': r'\bраздраж',
    'устал': r'\bустал',
    'заебал': r'\bзаеб',
    'хватит': r'\bхватит\b',
    'сколько можно': r'сколько\s+можно',
    'ты опять': r'ты\s+опять',
    'не делай': r'не\s+делай',
    'я же сказал': r'я\s+(же\s+)?сказал',
    'повторяю': r'повторя',
    'не понял(а)': r'не\s+понял',
    'где': r'\bгде\b',
    'почему': r'почему',
    'нет контекста': r'контекст',
}

APPROVAL = {
    'отлично': r'\bотличн',
    'супер': r'\bсупер\b',
    'круто': r'\bкрут[оо]',
    'класс': r'\bкласс\b',
    'хорошо': r'\bхорошо\b',
    'красиво': r'\bкрасиво\b',
    'топ': r'\bтоп\b',
    'огонь': r'\bогонь\b',
    'гениально': r'\bгениально',
    'сойдёт': r'сойд[её]т',
    'норм': r'\bнорм\b',
    'зачёт': r'\bзач[её]т',
    '+': r'^\+$|^\+1$',
    'спасибо': r'спасибо',
    'благодар': r'благодар',
    'да': r'^да[.!]?$',
    'го/давай': r'\bго\b|\bдавай\b',
}

METAPHORS = {
    'миксер': r'миксер',
    'пульт': r'пульт',
    'второй мозг': r'второй\s+мозг|second\s+brain',
    'атом': r'\bатом',
    'парадигма': r'парадигм',
    'чейн/цепочка': r'\bчейн|цепочк',
    'воскрешение': r'воскреси|воскреш',
    'мясо/кости': r'\bмясо\b|\bкости\b',
    'скелет': r'скелет',
    'живой': r'\bжив[ой]',
    'мертвый/мертвая': r'м[её]ртв',
    'заплатка/патч': r'заплатк|\bпатч',
    'хардкод': r'хардкод|hardcod',
    'заглушка': r'заглушк|stub',
    'магия/магический': r'магическ|\bмагия',
    'огонь/пожар': r'пожар|в\s+огне',
    'микроскоп/лупа': r'микроскоп|\bлуп',
    'карпати': r'карпат',
    'совет/консилиум': r'консилиум|совет',
}

REQUEST_STYLE = {
    'давай': r'\bдавай\b',
    'сделай': r'\bсделай\b',
    'нужно': r'\bнужно\b',
    'надо': r'\bнадо\b',
    'хочу': r'\bхочу\b',
    'должен': r'\bдолжен\b',
    'обязательно': r'обязательно',
    'пожалуйста': r'пожалуйста',
    'плиз': r'\bплиз\b|\bпж\b',
    'проверь': r'провер',
    'исправь': r'исправ',
    'переделай': r'передела',
    'покажи': r'\bпокажи\b',
    'посмотри': r'посмотри',
    'думай': r'\bдумай\b|подумай',
    'не торопись': r'не\s+торопись',
    'глубже': r'\bглубже\b',
    'полностью': r'полностью',
    'до конца': r'до\s+конца',
    'везде': r'\bвезде\b',
    'всё/все': r'\bвсё\b|\bвсе\b',
}

RULES = {
    'всегда': r'\bвсегда\b',
    'никогда': r'\bникогда\b',
    'каждый раз': r'каждый\s+раз',
    'по умолчанию': r'по\s+умолчанию',
    'правило': r'\bправил',
    'запомни': r'запомни|запоминай',
    'не повторяй': r'не\s+повтор',
    'фиксируй': r'фиксируй|зафиксируй',
    'не забудь': r'не\s+забу',
}

DOMAIN = {
    '44-ФЗ': r'44[-\s]?ФЗ|44[-\s]?фз',
    'НМЦК': r'\bНМЦК\b|\bнмцк',
    'СВОД': r'\bСВОД\b|\bсвод\b',
    'ШДЮ': r'\bШДЮ\b|\bшдю',
    'бюджет': r'бюджет',
    'подвед': r'подвед',
    'организация': r'организаци',
    'закупк': r'закупк',
    'процедур': r'процедур',
}

TECH = {
    'typescript': r'\btypescript\b|\bts\b',
    'react': r'\breact\b',
    'tailwind': r'tailwind',
    'shadcn': r'shadcn',
    'sql/postgres': r'postgres|\bsql\b',
    'vite': r'\bvite\b',
    'docker': r'docker',
    'ci/тесты': r'\bтест|\bci\b|vitest',
    'git/commit': r'\bgit\b|\bcommit\b|\bPR\b',
}

DESIGN = {
    'apple-style': r'apple[-\s]?style|apple',
    'compact': r'compact|компакт',
    'KB/tooltip': r'\bKB\b|tooltip|тултип|попап|popover',
    'russian-first': r'русск|Russian',
    'мульти-дименс': r'мульти[-\s]?дим|multi[-\s]?dim',
    'drill-down/drill': r'drill|drilldown|дрилл',
    'card/карточк': r'card|карточ',
    'dashboard': r'dashboard|дашборд',
    'skeleton/shimmer': r'skeleton|shimmer|scelet',
    'красот(а|ы)': r'красот',
    'эстет': r'эстети',
    '10/10': r'10/10|10 из 10',
}

FORMAT_PREF = {
    'скриншот': r'скриншот|screenshot',
    'таблица': r'таблиц',
    'диаграмма': r'диаграмм|chart|график',
    'markdown/md': r'\bmd\b|markdown',
    'json': r'\bjson\b',
    'код/code': r'```|\bcode\b|\bкод\b',
    'план/roadmap': r'\bплан\b|roadmap',
    'атомы obsidian': r'obsidian|атомы|атомизаци',
    'спроси/questions': r'спроси|вопрос',
}

WORK_STYLE = {
    'параллельно': r'параллельн',
    'последовательно': r'последовательн',
    'автоматизация': r'автоматиз',
    'вручную': r'вручн|руками',
    'скрипт': r'\bскрипт|\bscript\b',
    'не торопись': r'не\s+торопись|не\s+спеши',
    'до конца/фул-чейн': r'до\s+конца|full[-\s]?chain|полной\s+цепоч',
    'сначала подумай': r'сначала\s+подумай',
    'спроси': r'спроси\s+меня|уточни',
    'self-review': r'проверь\s+себя|self[-\s]?review|сам\s+проверь',
}

def scan(group):
    out = {}
    for name, pat in group.items():
        h, ex = count(pat)
        if h:
            out[name] = {'count': h, 'ex': ex}
    return out

stats = {
    'frustration': scan(FRUSTRATION),
    'approval': scan(APPROVAL),
    'metaphors': scan(METAPHORS),
    'request_style': scan(REQUEST_STYLE),
    'rules': scan(RULES),
    'domain': scan(DOMAIN),
    'tech': scan(TECH),
    'design': scan(DESIGN),
    'format': scan(FORMAT_PREF),
    'work': scan(WORK_STYLE),
}

# ─── length distribution ────────────────────────────────────────────────
lens = [m['len'] for m in msgs]
lens_sorted = sorted(lens)
def pct(p):
    if not lens_sorted:
        return 0
    return lens_sorted[min(len(lens_sorted) - 1, int(len(lens_sorted) * p))]

len_summary = {
    'total': N,
    'mean': int(sum(lens) / max(1, N)),
    'median': pct(0.5),
    'p25': pct(0.25),
    'p75': pct(0.75),
    'p90': pct(0.9),
    'p99': pct(0.99),
    'max': max(lens) if lens else 0,
    'short_lt30': sum(1 for x in lens if x < 30),
    'short_lt10': sum(1 for x in lens if x < 10),
    'long_gt500': sum(1 for x in lens if x > 500),
    'long_gt2000': sum(1 for x in lens if x > 2000),
}

# RU/EN ratio
def ru_en_counts(text):
    ru = len(re.findall(r'[а-яёА-ЯЁ]', text))
    en = len(re.findall(r'[a-zA-Z]', text))
    return ru, en

total_ru = total_en = 0
for m in msgs:
    r, e = ru_en_counts(m['text'])
    total_ru += r
    total_en += e
ru_share = total_ru / max(1, total_ru + total_en)

# ─── time distribution ──────────────────────────────────────────────────
hours = Counter()
weekdays = Counter()
dates = Counter()
session_gaps = []  # minutes between consecutive messages
prev = None
for m in sorted([x for x in msgs if x['dt']], key=lambda x: x['dt']):
    hours[m['hour']] += 1
    weekdays[m['weekday']] += 1
    dates[m['dt'].strftime('%Y-%m-%d')] += 1
    if prev:
        gap = (m['dt'] - prev).total_seconds() / 60.0
        session_gaps.append(gap)
    prev = m['dt']

# sessions: gap > 30 min starts new session
sessions = []
cur = []
last_dt = None
for m in sorted([x for x in msgs if x['dt']], key=lambda x: x['dt']):
    if last_dt is None or (m['dt'] - last_dt).total_seconds() / 60.0 <= 30:
        cur.append(m)
    else:
        if cur:
            sessions.append(cur)
        cur = [m]
    last_dt = m['dt']
if cur:
    sessions.append(cur)

session_durations = []
session_sizes = []
for s in sessions:
    if len(s) >= 2:
        d = (s[-1]['dt'] - s[0]['dt']).total_seconds() / 60.0
        session_durations.append(d)
    session_sizes.append(len(s))

# ─── top raw phrases (for quotes) ───────────────────────────────────────
# pick highest-signal short user quotes: length 40..400, containing strong markers
def quote_score(text):
    s = 0
    for g in (FRUSTRATION, APPROVAL, METAPHORS, RULES):
        for pat in g.values():
            if re.search(pat, text, re.IGNORECASE):
                s += 1
    if 40 <= len(text) <= 300:
        s += 2
    if re.search(r'[!?]', text):
        s += 1
    return s

quote_pool = sorted(msgs, key=lambda m: (-quote_score(m['text']), m['len']))
top_quotes = []
seen_sigs = set()
for m in quote_pool:
    sig = m['text'][:80]
    if sig in seen_sigs:
        continue
    seen_sigs.add(sig)
    if 30 <= len(m['text']) <= 500:
        top_quotes.append(m)
    if len(top_quotes) >= 15:
        break

# ─── serial shortness: "и ещё", "также" streaks ─────────────────────────
short_serial = 0
prev_short = False
for m in sorted([x for x in msgs if x['dt']], key=lambda x: x['dt']):
    is_short = m['len'] < 60
    if is_short and prev_short:
        short_serial += 1
    prev_short = is_short

# ─── bounds for messages_analyzed ───────────────────────────────────────
date_min = min(dates) if dates else ''
date_max = max(dates) if dates else ''

# ─── message-atom links for top quotes (best-effort slug match) ─────────
def slugify_first_words(text, maxlen=50):
    # same algo as extract_user_msgs
    TRANSLIT = {
        'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z',
        'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
        'с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch',
        'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
    }
    def tr(s):
        o = []
        for ch in s.lower():
            if ch in TRANSLIT:
                o.append(TRANSLIT[ch])
            elif ch.isalnum() or ch in ' -':
                o.append(ch)
            else:
                o.append(' ')
        return ''.join(o)
    words = text.strip().split()[:6]
    s = tr(' '.join(words))
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-') or 'msg'
    return s[:maxlen].rstrip('-')

# index of available message atoms
atom_files = {f.name for f in MSG_DIR.glob('*.md')} if MSG_DIR.exists() else set()

def find_atom_link(m):
    if not m['dt']:
        return None
    date_s = m['dt'].strftime('%Y-%m-%d')
    time_s = m['dt'].strftime('%H%M')
    slug = slugify_first_words(m['text'])
    # exact try
    cand = f"{date_s}-{time_s}-{slug}.md"
    if cand in atom_files:
        return f"[[70-Chat/messages/{cand[:-3]}]]"
    # fallback: same date+time prefix
    prefix = f"{date_s}-{time_s}-"
    for name in atom_files:
        if name.startswith(prefix):
            return f"[[70-Chat/messages/{name[:-3]}]]"
    # fallback: any file with same date and nearby time
    prefix2 = f"{date_s}-"
    best = None
    best_dt_diff = 1e9
    for name in atom_files:
        if not name.startswith(prefix2):
            continue
        try:
            hhmm = int(name[11:15])
            cur_hhmm = int(time_s)
            diff = abs(hhmm - cur_hhmm)
            if diff < best_dt_diff:
                best_dt_diff = diff
                best = name
        except Exception:
            continue
    if best and best_dt_diff < 30:
        return f"[[70-Chat/messages/{best[:-3]}]]"
    return None

# ─── render markdown ────────────────────────────────────────────────────
def fmt_top(group, n=6):
    items = sorted(stats[group].items(), key=lambda kv: -kv[1]['count'])[:n]
    if not items:
        return '—'
    return ', '.join(f"**{k}** ({v['count']})" for k, v in items)

def fmt_hours():
    if not hours:
        return '—'
    buckets = {
        'ночь 00-06': sum(hours.get(h, 0) for h in range(0, 6)),
        'утро 06-12': sum(hours.get(h, 0) for h in range(6, 12)),
        'день 12-18': sum(hours.get(h, 0) for h in range(12, 18)),
        'вечер 18-24': sum(hours.get(h, 0) for h in range(18, 24)),
    }
    tot = sum(buckets.values()) or 1
    return ', '.join(f"{k}: {v} ({round(v*100/tot)}%)" for k, v in buckets.items())

def fmt_weekdays():
    if not weekdays:
        return '—'
    names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
    return ', '.join(f"{names[i]}: {weekdays.get(i, 0)}" for i in range(7))

def clip(t, n=220):
    t = re.sub(r'\s+', ' ', t).strip()
    return t if len(t) <= n else t[:n - 1] + '…'

def render_quote(m):
    q = clip(m['text'], 240)
    ts_h = m['dt'].strftime('%Y-%m-%d %H:%M') if m['dt'] else '?'
    link = find_atom_link(m)
    tail = f" — {link}" if link else ''
    return f"> «{q}»  \n> — {ts_h}{tail}"

top_frustration = sorted(stats['frustration'].items(), key=lambda kv: -kv[1]['count'])[:8]
top_approval = sorted(stats['approval'].items(), key=lambda kv: -kv[1]['count'])[:8]
top_metaphor = sorted(stats['metaphors'].items(), key=lambda kv: -kv[1]['count'])[:10]

body = f"""---
type: persona
tags: ["#источник/пользователь", "#персона/user-self", "#приоритет/p0"]
created: 2026-04-15
updated: 2026-04-15
status: active
priority: P0
description: "Полный профиль пользователя: предпочтения, стиль работы, маркеры настроения, любимые паттерны"
messages_analyzed: {N}
date_range: "{date_min} .. {date_max}"
sessions_detected: {len(sessions)}
ru_share: {round(ru_share, 3)}
related: ["[[00-Meta/User-Trigger-Patterns]]", "[[20-Knowledge/personas/user-requirements-recurring]]", "[[20-Knowledge/personas/user-screen-resolution]]"]
---

# Профиль пользователя — полный портрет

> [!abstract] TL;DR
> Русскоязычный владелец продукта AEMR (BI для 44-ФЗ закупок). Работает как продюсер-перфекционист: знает домен и дизайн глубоко, опирается на ассистента для имплементации и типов. Мыслит парадигмами («строка=атом», «миксер», «второй мозг»), требует full-chain фиксы без заплаток, ненавидит повторение правил и потерю контекста. Пишет короткими сериями ночью, хвалит редко и сдержанно, раздражается мгновенно и матом. Ценит автоматизацию и proof-by-data больше красивых слов.

**Выборка:** {N} пользовательских сообщений, {date_min} → {date_max}. **Сессий (gap >30 мин):** {len(sessions)}. **RU-доля символов:** {round(ru_share * 100)}%.

---

## 1. 🎯 Что он любит как результат

1. **Автоматизацию, а не обещания.** Любое ручное действие — триггер «сделай скрипт». Маркеры: {stats['work'].get('скрипт', {}).get('count', 0)} упоминаний «скрипт», {stats['work'].get('автоматизация', {}).get('count', 0)} «автоматизац».
2. **Full-chain фиксы, не патчи.** Маркеры «до конца / полная цепочка» ({stats['work'].get('до конца/фул-чейн', {}).get('count', 0)}), «заплатк/патч» как ругательство ({stats['metaphors'].get('заплатка/патч', {}).get('count', 0)}). Он лично просит пройти «ячейка → ingest → normalize → CalcEngine → API → UI».
3. **Реальные данные, а не заглушки.** «хардкод» и «заглушка» встречаются {stats['metaphors'].get('хардкод', {}).get('count', 0) + stats['metaphors'].get('заглушка', {}).get('count', 0)} раз — всегда как претензия. Метрика без фильтра = мёртвая.
4. **Парадигмы и имена.** Любит концептуализировать: атомы ({stats['metaphors'].get('атом', {}).get('count', 0)}), парадигма ({stats['metaphors'].get('парадигма', {}).get('count', 0)}), «миксер» ({stats['metaphors'].get('миксер', {}).get('count', 0)}), «второй мозг» ({stats['metaphors'].get('второй мозг', {}).get('count', 0)}).
5. **Полную картину, а не спот.** Часто пишет «везде» ({stats['request_style'].get('везде', {}).get('count', 0)}), «полностью» ({stats['request_style'].get('полностью', {}).get('count', 0)}), «всё/все» ({stats['request_style'].get('всё/все', {}).get('count', 0)}).
6. **Proof-by-data.** Любит когда я показываю строку-за-строкой из XLSX, а не общие слова. Отсюда `prove_with_data`, `full_formula_mapping`, аудиты в Word.
7. **Compact Apple-style визуал.** Экран 1240×480, «компакт», «красиво», 10/10. Маркеры: {stats['design'].get('apple-style', {}).get('count', 0)} Apple, {stats['design'].get('compact', {}).get('count', 0)} compact, {stats['design'].get('10/10', {}).get('count', 0)} «10/10».
8. **Сохранение хорошего.** Не удалять, а переосмыслять (см. feedback-preserve-good-design). «Воскрешение» мёртвых агентов ({stats['metaphors'].get('воскрешение', {}).get('count', 0)}).

## 2. 👎 Что его раздражает

Топ-маркеры фрустрации по частоте: { fmt_top('frustration', 10) }.

1. **Повторение правил.** «опять» ({stats['frustration'].get('опять', {}).get('count', 0)}), «снова» ({stats['frustration'].get('снова', {}).get('count', 0)}), «я же сказал» ({stats['frustration'].get('я же сказал', {}).get('count', 0)}), «повторяю» ({stats['frustration'].get('повторяю', {}).get('count', 0)}). Если объяснил один раз — фиксируй, иначе получишь мат.
2. **Потеря контекста между сессиями.** Почему появился MEMORY.md и graphify. «контекст» ({stats['frustration'].get('нет контекста', {}).get('count', 0)} упоминаний).
3. **Заплатки вместо систем.** Патч воспринимается как обман. См. feedback-no-patches, feedback-fix-entire-pipeline.
4. **Хардкод / заглушки / мёртвый код.** Любая цифра без источника — претензия.
5. **Шаблонные отчёты и повтор закрытого.** feedback-no-repeat-done-items: не рапортовать о том, что уже сделано.
6. **Много слов, мало действия.** Короткие «давай», «го», «делай» — сигнал что надоело объяснять.
7. **Мат как thermometer.** Использует обсценную лексику ({sum(stats['frustration'].get(k, {}).get('count', 0) for k in ('блядь/блять','нахуй','пиздец','ебан/ебать','хуй/хуёв','заебал'))} совпадений по всем корням). Не агрессия на меня лично — индикатор перегруза/разочарования.
8. **Пропуск «почему».** «почему» ({stats['frustration'].get('почему', {}).get('count', 0)}) — требует обоснование, не голый факт.

## 3. 🗣 Стиль коммуникации

- **Язык.** Русский доминирует ({round(ru_share * 100)}% символов), английский только для терминов (TypeScript, shadcn, drill-down, roadmap, KPI).
- **Тон.** Требовательный + дружеский с горизонтальной дистанцией («давай», «го», «плиз» {stats['request_style'].get('плиз', {}).get('count', 0)} раз). Обращение на «ты», без дистанции.
- **Юмор.** Скорее сарказм и гипербола, чем шутки. Ирония через метафоры («мертвый код», «воскрешение агентов»).
- **Мат.** Использует, но не как оскорбление — как эмоциональный усилитель при фрустрации.
- **Любимые метафоры.** { fmt_top('metaphors', 8) }.
- **Вежливость.** «спасибо» встречается {stats['approval'].get('спасибо', {}).get('count', 0)} раз — использует, но редко. Молчаливое согласие = одобрение.
- **Одобрение.** Короткое и сдержанное: { fmt_top('approval', 8) }. Чаще всего «+», «да», «го» — не развернутые похвалы.

## 4. ⚙️ Рабочий стиль

- **Ритм по часам.** { fmt_hours() }.
- **По дням.** { fmt_weekdays() }.
- **Длина сессий.** медиана {int(sorted(session_durations)[len(session_durations)//2]) if session_durations else 0} мин, 90-й перцентиль {int(sorted(session_durations)[int(len(session_durations)*0.9)]) if session_durations else 0} мин. Всего сессий: {len(sessions)}.
- **Сообщений в сессии.** медиана {sorted(session_sizes)[len(session_sizes)//2] if session_sizes else 0}, максимум {max(session_sizes) if session_sizes else 0}.
- **Параллелизм.** «параллельно» ({stats['work'].get('параллельно', {}).get('count', 0)}) vs «последовательно» ({stats['work'].get('последовательно', {}).get('count', 0)}) — сильный перевес в сторону параллельных веток (несколько агентов, несколько фич одновременно).
- **Автоматизация vs вручную.** скрипт/автоматиз ({stats['work'].get('скрипт', {}).get('count', 0) + stats['work'].get('автоматизация', {}).get('count', 0)}) >> вручную ({stats['work'].get('вручную', {}).get('count', 0)}).
- **Self-review запросы.** «проверь/сам проверь» ({stats['work'].get('self-review', {}).get('count', 0)}) — просит верифицировать работу перед показом.
- **«Не торопись»/«подумай».** {stats['work'].get('не торопись', {}).get('count', 0) + stats['work'].get('сначала подумай', {}).get('count', 0)} раз — ценит качество над скоростью, но не терпит простоя без видимого прогресса.

## 5. 🧠 Мышление

- **Системный, сверху вниз.** Сначала парадигма («строка=атом», «12 персон», «один элемент — все срезы»), потом реализация. Слово «парадигма» — {stats['metaphors'].get('парадигма', {}).get('count', 0)} раз.
- **Концептуализатор.** Любит формулировать принципы, правила, методологии. Делает это вслух в чате → накапливает 20+ feedback-* файлов.
- **Не линейный.** Короткие серии сообщений «и ещё / также / кстати» — {short_serial} подряд-шорт пар. Мысль приходит волнами.
- **Требует root cause.** «почему» ({stats['frustration'].get('почему', {}).get('count', 0)}), «корень». Не соглашается на симптоматику.
- **Pattern-driven.** Видит систему там, где другие видят частности (отсюда «миксер», «атом», «полная цепочка»).
- **Проверяет данными.** «покажи» ({stats['request_style'].get('покажи', {}).get('count', 0)}), «посмотри» ({stats['request_style'].get('посмотри', {}).get('count', 0)}), скриншоты, row-by-row audit.

## 6. 📚 Области компетенции

**Силён сам (не спрашивает, диктует):**
- 44-ФЗ, процедуры закупок, СВОД, ШДЮ, НМЦК, бюджеты подведов. Маркеры: { fmt_top('domain', 6) }.
- BI / визуализация: KPI-карточки, drill-down, heatmap, dashboard — { fmt_top('design', 8) }.
- Product-mindset: персоны, сценарии, приоритезация, user journey. 25 персон в 6 тирах — его формулировка.
- UX-философия (Apple, Linear, Stripe) — самостоятельно цитирует, не просит объяснить.

**Опирается на ассистента (просит сделать):**
- TypeScript синтаксис, React-хуки, shadcn-компоненты: { fmt_top('tech', 6) }.
- SQL / PostgreSQL схемы: {stats['tech'].get('sql/postgres', {}).get('count', 0)} упоминаний — просит спроектировать, не пишет сам.
- Тесты (vitest/CI): {stats['tech'].get('ci/тесты', {}).get('count', 0)} — делегирует целиком.
- Git-дисциплина, PR-структура.
- Парсинг данных, pipelines (просит «ты напиши ingest»).

## 7. 🎨 Визуальные предпочтения

- **Экран 1240×480** — подтверждено отдельным атомом user-screen-resolution. Всё должно помещаться.
- **Apple-style первично:** плотность, скругления, ритм, сдержанный цвет. {stats['design'].get('apple-style', {}).get('count', 0)} упоминаний.
- **Compact-first:** {stats['design'].get('compact', {}).get('count', 0)} упоминаний «компакт».
- **KB-tooltip на каждом элементе.** {stats['design'].get('KB/tooltip', {}).get('count', 0)} упоминаний, отдельный feedback (10 блоков, русский литературный, консультация с законом/интернетом).
- **Russian-first интерфейс.** Английские термины только там, где общепринято.
- **Мульти-дименсиональность.** Каждый элемент должен показывать все 6 срезов (период, орг, тип, направление, подвед, сумма). {stats['design'].get('мульти-дименс', {}).get('count', 0)} упоминаний.
- **Drill-down без навигации.** Клик → expand/popover, не переход. {stats['design'].get('drill-down/drill', {}).get('count', 0)} упоминаний.
- **Smart cards** — универсальный примитив вместо списков drill-down (feedback-smart-cards-not-drilldown).
- **Unified popover style** — все popovers/tooltips одного стиля.

## 8. ⏰ Темп и ритм

- **Распределение длин сообщений.** Медиана {len_summary['median']} симв, p75 {len_summary['p75']}, p90 {len_summary['p90']}, p99 {len_summary['p99']}, max {len_summary['max']}. Коротких (<30) — {len_summary['short_lt30']} ({round(len_summary['short_lt30']*100/N)}%). Длинных (>500) — {len_summary['long_gt500']} ({round(len_summary['long_gt500']*100/N)}%). Очень длинных (>2000) — {len_summary['long_gt2000']}.
- **Паттерн:** длинный бриф → серия коротких поправок → мат/похвала. Перфекционист с короткими итерациями.
- **Активность:** { fmt_hours() }. Пик приходится на вечер-ночь.
- **Паузы.** Медианный gap между сообщениями {int(sorted(session_gaps)[len(session_gaps)//2]) if session_gaps else 0} мин. Внутри сессии — плотные серии, между сессиями — часы/сутки.
- **Сессии больше 30 мин gap:** {len(sessions)}. Средняя длительность активной сессии: {int(sum(session_durations)/len(session_durations)) if session_durations else 0} мин.

## 9. 🤝 Что он ждёт от меня проактивно

1. **Обновлять MEMORY.md и graphify** после значимых правок — без напоминания.
2. **Запускать параллельные ветки** (несколько Task-агентов), а не последовательно, когда задача декомпозируется.
3. **Писать план перед кодом** и сверять с ACTIVE_TASKS.md / планом сессии.
4. **Проверять себя** перед рапортом: тесты, `tsc --noEmit`, ручная прогонка. Не приносить полуфабрикат.
5. **Не повторять то, что уже сделано.** Перед рапортом — проверить feedback-no-repeat-done-items.
6. **Русский в UI-текстах.** По умолчанию RU, EN только для терминов.
7. **Fix full chain, not spot.** Ingest → normalize → calc → API → UI — пройти всё.
8. **Proof by data.** Любая цифра в ответе — со ссылкой на строку XLSX / файл / коммит.
9. **Не удалять — переосмыслять.** Перед `rm` спросить, не мёртвый ли это полезный код.
10. **Писать атомы в Obsidian** для новых парадигм/feedback — тихо, как побочный продукт.

## 10. 🔑 Ключевые цитаты

"""

for m in top_quotes[:12]:
    body += render_quote(m) + "\n\n"

body += f"""---

## Приложения — диагностика (сырые счётчики)

**Frustration:** {dict((k, v['count']) for k, v in top_frustration)}

**Approval:** {dict((k, v['count']) for k, v in top_approval)}

**Metaphors:** {dict((k, v['count']) for k, v in top_metaphor)}

**Rules:** { fmt_top('rules', 10) }

**Request style:** { fmt_top('request_style', 10) }

**Domain terms:** { fmt_top('domain', 10) }

**Tech stack mentions:** { fmt_top('tech', 10) }

**Design vocab:** { fmt_top('design', 12) }

**Format preferences:** { fmt_top('format', 10) }

**Work style:** { fmt_top('work', 10) }

**Длина сообщений:** mean={len_summary['mean']}, median={len_summary['median']}, p75={len_summary['p75']}, p90={len_summary['p90']}, p99={len_summary['p99']}, max={len_summary['max']}. Коротких (<30): {len_summary['short_lt30']}, длинных (>500): {len_summary['long_gt500']}.

**Серийные короткие (подряд <60 симв):** {short_serial} пар.

**Доля RU:** {round(ru_share, 3)}.

---

*Файл сгенерирован `scripts/profile_user.py`. Для обновления — перезапустить после новых сессий.*
"""

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(body, encoding='utf-8')

# ─── report to stdout ───────────────────────────────────────────────────
print(f"MESSAGES_ANALYZED={N}")
print(f"DATE_RANGE={date_min} .. {date_max}")
print(f"SESSIONS={len(sessions)}")
print(f"RU_SHARE={round(ru_share,3)}")
print(f"LEN median={len_summary['median']} p90={len_summary['p90']} max={len_summary['max']}")
print(f"TOP_FRUSTRATION={[(k,v['count']) for k,v in top_frustration]}")
print(f"TOP_APPROVAL={[(k,v['count']) for k,v in top_approval]}")
print(f"TOP_METAPHORS={[(k,v['count']) for k,v in top_metaphor]}")
print(f"WROTE {OUT}")
