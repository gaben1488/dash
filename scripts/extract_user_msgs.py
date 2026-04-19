"""Extract user messages from Claude Code JSONL into atomic Obsidian notes."""
import json, re, os, sys
from datetime import datetime
from pathlib import Path

SRC = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/725bfdb8-55f0-45ec-a166-df2c4a389210.jsonl")
OUT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/70-Chat/messages")
OUT.mkdir(parents=True, exist_ok=True)

# Cyrillic transliteration
TRANSLIT = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z',
    'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
    'с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch',
    'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
}
def translit(s: str) -> str:
    out=[]
    for ch in s.lower():
        if ch in TRANSLIT: out.append(TRANSLIT[ch])
        elif ch.isalnum() or ch in ' -': out.append(ch)
        else: out.append(' ')
    return ''.join(out)

def slugify(text: str, maxlen=50) -> str:
    words = text.strip().split()[:6]
    s = translit(' '.join(words))
    s = re.sub(r'[^a-z0-9]+','-',s).strip('-')
    if not s: s='msg'
    return s[:maxlen].rstrip('-')

# Triggers for typing & scoring
RULE_PATTERNS = [
    r'\bвсегда\b', r'\bникогда\b', r'\bдела(й|ть)\b', r'\bне\s+дел', r'\bдолжен\b',
    r'\bобязательно\b', r'\bправило\b', r'\bпринцип\b'
]
CORRECTION_PATTERNS = [
    r'\bне\s+так\b', r'\bне\s+это\b', r'\bпересмотри\b', r'\bпеределай\b',
    r'\bошибка\b', r'\bневерно\b', r'\bне\s+правильн', r'\bперепиши\b', r'\bотмени\b'
]
CONCEPT_PATTERNS = [
    r'\bидея\b', r'\bпарадигма\b', r'\bконцепция\b', r'\bподход\b',
    r'\bметодология\b', r'\bфилософия\b'
]
PRAISE_PATTERNS = [r'\bхорошо\b', r'\bотлично\b', r'\bкласс\b', r'\bсупер\b', r'\bкруто\b']
COMPLAINT_PATTERNS = [r'\bплохо\b', r'\bужас', r'\bне\s+то\b', r'\bбесит', r'\bраздража']
DECISION_PATTERNS = [r'\bрешил\b', r'\bвыбираем\b', r'\bберем\b', r'\bбудем\b', r'\bдавай\b']
INSIGHT_PATTERNS = [r'\bпонял\b', r'\bпонятно\b', r'\bкстати\b', r'\bосознал\b']
QUESTION_PATTERNS = [r'\?', r'\bпочему\b', r'\bкак\b', r'\bчто\b', r'\bзачем\b']

TRIVIAL = {
    'ok','ок','окей','да','нет','yes','no','продолжай','continue','go','давай',
    'хорошо','спасибо','thanks','thx','+','-','.','...','ага','угу','готово'
}

def msg_type(text: str) -> str:
    t = text.lower()
    if any(re.search(p, t) for p in CORRECTION_PATTERNS): return 'коррекция'
    if any(re.search(p, t) for p in RULE_PATTERNS): return 'правило'
    if any(re.search(p, t) for p in CONCEPT_PATTERNS): return 'концепция'
    if any(re.search(p, t) for p in DECISION_PATTERNS): return 'решение'
    if any(re.search(p, t) for p in COMPLAINT_PATTERNS): return 'жалоба'
    if any(re.search(p, t) for p in PRAISE_PATTERNS): return 'похвала'
    if any(re.search(p, t) for p in INSIGHT_PATTERNS): return 'инсайт'
    if any(re.search(p, t) for p in QUESTION_PATTERNS): return 'вопрос'
    return 'запрос'

def score(text: str) -> int:
    t = text.lower().strip()
    if not t: return -100
    if t in TRIVIAL: return -50
    if len(t) < 15: return -20
    s = 0
    s += min(len(t)//50, 20)  # length bonus
    for p in RULE_PATTERNS:
        if re.search(p, t): s += 8
    for p in CORRECTION_PATTERNS:
        if re.search(p, t): s += 9
    for p in CONCEPT_PATTERNS:
        if re.search(p, t): s += 7
    for p in DECISION_PATTERNS:
        if re.search(p, t): s += 4
    for p in COMPLAINT_PATTERNS:
        if re.search(p, t): s += 5
    if len(t) > 200: s += 5
    if len(t) > 500: s += 5
    if len(t) > 1000: s += 5
    return s

def extract_text(content) -> str:
    """Return user prose; '' if it's a tool_result or system-generated."""
    if isinstance(content, str):
        # Skip command-stdout / system blocks
        if content.startswith('<command-') or content.startswith('<local-command'): return ''
        if '[Request interrupted' in content: return ''
        if 'caveat: the messages do not contain' in content.lower(): return ''
        return content
    if isinstance(content, list):
        parts = []
        for it in content:
            if not isinstance(it, dict): continue
            if it.get('type') == 'tool_result': return ''  # skip entirely
            if it.get('type') == 'text':
                parts.append(it.get('text',''))
        return '\n'.join(parts)
    return ''

def keyword_tags(text: str) -> list:
    """Crude: pick a few salient nouns/verbs."""
    t = text.lower()
    words = re.findall(r'[а-яё]{4,}', t)
    seen, out = set(), []
    stop = {'этот','этого','этому','который','которая','которые','когда','тогда',
            'нужно','чтобы','можно','просто','потому','очень','будет','может',
            'надо','такой','такая','такие','тоже','снова','всегда','никогда',
            'ничего','всего','много','мало','сюда','туда','здесь','сейчас',
            'делать','сделать','хочу','хочешь','знаю','видишь'}
    for w in words:
        if w in stop or w in seen: continue
        seen.add(w); out.append(w)
        if len(out) >= 5: break
    return out

def quote_block(text: str, max_lines=15) -> str:
    lines = text.splitlines()
    if len(lines) > max_lines:
        lines = lines[:max_lines] + ['…']
    # truncate very long single lines
    lines = [(ln if len(ln) <= 200 else ln[:200] + '…') for ln in lines]
    return '\n'.join('> ' + ln for ln in lines)

def short_title(text: str) -> str:
    first = text.strip().splitlines()[0] if text.strip() else 'сообщение'
    if len(first) > 70: first = first[:67] + '…'
    return first

# ─── Pass 1: collect candidates ───
candidates = []  # (score, idx, ts, text)
total = 0
idx = 0
with SRC.open(encoding='utf-8') as f:
    for line in f:
        try: o = json.loads(line)
        except Exception: continue
        if o.get('type') != 'user': continue
        msg = o.get('message') or {}
        if msg.get('role') != 'user': continue
        text = extract_text(msg.get('content'))
        text = (text or '').strip()
        if not text: continue
        total += 1
        sc = score(text)
        ts = o.get('timestamp') or ''
        candidates.append((sc, idx, ts, text))
        idx += 1

candidates.sort(key=lambda x: (-x[0], x[1]))
KEEP = 150
chosen = candidates[:KEEP]
chosen.sort(key=lambda x: x[2])  # chronological

# ─── Pass 2: write notes ───
written = []
type_counts = {}
dates = []
TODAY = '2026-04-15'

for sc, _i, ts, text in chosen:
    try:
        dt = datetime.fromisoformat(ts.replace('Z','+00:00'))
    except Exception:
        dt = datetime.utcnow()
    date_s = dt.strftime('%Y-%m-%d')
    time_s = dt.strftime('%H%M')
    dates.append(date_s)
    mt = msg_type(text)
    type_counts[mt] = type_counts.get(mt, 0) + 1
    slug = slugify(text)
    fname = f"{date_s}-{time_s}-{slug}.md"
    fpath = OUT / fname
    # deduplicate
    n = 2
    while fpath.exists():
        fpath = OUT / f"{date_s}-{time_s}-{slug}-{n}.md"
        n += 1

    title = short_title(text)
    quoted = quote_block(text)
    tags = keyword_tags(text)

    # First-line summary as thesis
    first_sent = re.split(r'(?<=[.!?])\s+', text.strip(), maxsplit=2)
    theses = [s.strip() for s in first_sent if s.strip()][:3] or [title]

    fm = (
        "---\n"
        "type: message\n"
        f"tags: [\"#источник/пользователь\", \"#msg/{mt}\"]\n"
        f"created: {date_s}\n"
        f"updated: {TODAY}\n"
        "status: active\n"
        f"msg_type: {mt}\n"
        f"timestamp: {ts}\n"
        f"raw_length: {len(text)}\n"
        "related: []\n"
        "---\n\n"
    )
    body = (
        f"# {date_s} {dt.strftime('%H:%M')} — {title}\n\n"
        f"> [!quote] Оригинал\n{quoted}\n\n"
        f"## Тип\n{mt}\n\n"
        f"## Тезисы\n" + '\n'.join(f"{i+1}. {t}" for i,t in enumerate(theses)) + "\n\n"
        f"## Контекст\nСообщение пользователя из чата AEMR. Длина {len(text)} симв., тип «{mt}».\n\n"
        f"## Теги-идеи\n{', '.join(tags) if tags else '—'}\n"
    )
    fpath.write_text(fm + body, encoding='utf-8')
    written.append(fpath.name)

print(f"TOTAL_USER_MSGS={total}")
print(f"KEPT={len(written)}")
if dates:
    print(f"DATE_RANGE={min(dates)} .. {max(dates)}")
print("TYPE_COUNTS=" + json.dumps(type_counts, ensure_ascii=False))
print("SAMPLE=" + json.dumps(written[:3], ensure_ascii=False))
