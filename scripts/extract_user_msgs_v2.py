"""v2: Keep ALL user-record entries, but tag them by source so we can distinguish:
 - source: user-verbatim    (real typed text, primary signal)
 - source: session-continuation  (Claude's own compactions — evidence of stuck-points, KEEP!)
 - source: system-injected  (system-reminder / command blocks — metadata)

User 2026-04-15: "пусть они тоже будут по ним потом находить косяки и эволюционировать проще будет".
Session-continuations are kept as a DIFFERENT atom class — they reveal where tasks got stuck.
"""
import json, re, sys
from datetime import datetime
from pathlib import Path

SRC = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/725bfdb8-55f0-45ec-a166-df2c4a389210.jsonl")
OUT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/70-Chat/messages")
RAW = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/70-Chat/raw-verbatim")
OUT.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)

# --- filter: session-continuation & system-generated markers ---
NOISE_MARKERS = [
    "This session is being continued from",
    "Caveat: The messages below",
    "<command-name>", "<command-message>", "<command-args>",
    "<local-command-stdout>", "<local-command-stderr>",
    "[Continuation from",
    "<system-reminder>",
    "[Request interrupted",
    "caveat: the messages do not contain",
]

SESSION_CONT_MARKERS = [
    "This session is being continued from",
    "Caveat: The messages below",
    "[Continuation from",
]
SYSTEM_MARKERS = [
    "<command-name>", "<command-message>", "<command-args>",
    "<local-command-stdout>", "<local-command-stderr>",
    "<system-reminder>",
    "[Request interrupted",
    "caveat: the messages do not contain",
]

def classify_source(text: str) -> str:
    """Return 'user-verbatim' | 'session-continuation' | 'system-injected' | 'empty'."""
    if not text or len(text.strip()) < 3:
        return 'empty'
    low = text.lower()
    head = low[:500]
    for m in SESSION_CONT_MARKERS:
        if m.lower() in head:
            return 'session-continuation'
    for m in SYSTEM_MARKERS:
        if m.lower() in head:
            return 'system-injected'
    stripped = text.strip()
    if stripped.startswith('<') and stripped.endswith('>') and '\n' not in stripped[:80]:
        return 'system-injected'
    if stripped.startswith('{') and '"tool_use_id"' in stripped[:200]:
        return 'system-injected'
    return 'user-verbatim'

TRANSLIT = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z',
    'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
    'с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch',
    'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
}
def translit(s):
    return ''.join(TRANSLIT.get(c, c if c.isalnum() or c in ' -' else ' ') for c in s.lower())
def slugify(t, maxlen=50):
    s = translit(' '.join(t.strip().split()[:6]))
    s = re.sub(r'[^a-z0-9]+','-',s).strip('-') or 'msg'
    return s[:maxlen].rstrip('-')

CORRECTION = [r'\bне\s+так\b', r'\bне\s+это\b', r'\bпересмотри\b', r'\bпеределай\b',
              r'\bошибка\b', r'\bневерно\b', r'\bне\s+правильн', r'\bперепиши\b',
              r'\bотмени\b', r'\bнапоминаю\b', r'\bя\s+уже\s+говорил']
RULE = [r'\bвсегда\b', r'\bникогда\b', r'\bдолжен\b', r'\bобязательно\b',
        r'\bправило\b', r'\bпринцип\b', r'\bне\s+делай\b']
CONCEPT = [r'\bидея\b', r'\bпарадигма\b', r'\bконцепция\b', r'\bподход\b',
           r'\bметодология\b', r'\bфилософия\b', r'\bмозг\b']
PRAISE = [r'\bхорошо\b', r'\bотлично\b', r'\bклассно\b', r'\bкруто\b', r'\bнаконец-то\b']
COMPLAINT = [r'\bплохо\b', r'\bужас', r'\bбесит', r'\bраздража', r'\bне\s+то\b', r'\bустал\b']
DECISION = [r'\bрешил\b', r'\bвыбираем\b', r'\bберем\b', r'\bдавай\s+так\b']
INSIGHT = [r'\bпонял\b', r'\bосознал\b', r'\bкстати\b']
QUESTION = [r'\?', r'\bпочему\b', r'\bкак\b', r'\bчто\b', r'\bзачем\b']

def msg_type(t):
    tl = t.lower()
    for tag, pats in [('коррекция',CORRECTION),('правило',RULE),('концепция',CONCEPT),
                      ('решение',DECISION),('жалоба',COMPLAINT),('похвала',PRAISE),
                      ('инсайт',INSIGHT),('вопрос',QUESTION)]:
        if any(re.search(p, tl) for p in pats): return tag
    return 'запрос'

TRIVIAL = {'ok','ок','окей','да','нет','yes','no','продолжай','continue','go',
           'хорошо','спасибо','thanks','thx','+','-','.','...','ага','угу','готово'}

def score(t):
    tl = t.lower().strip()
    if not tl: return -100
    if tl in TRIVIAL: return -50
    if len(tl) < 20: return -10
    s = min(len(tl)//60, 25)
    for pats, w in [(RULE,8),(CORRECTION,9),(CONCEPT,7),(DECISION,4),(COMPLAINT,5),(INSIGHT,3)]:
        for p in pats:
            if re.search(p, tl): s += w
    if len(tl) > 300: s += 5
    if len(tl) > 800: s += 7
    if len(tl) > 1500: s += 7
    return s

def extract_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for it in content:
            if not isinstance(it, dict): continue
            if it.get('type') == 'tool_result':
                return ''  # reject entirely
            if it.get('type') == 'text':
                parts.append(it.get('text',''))
        return '\n'.join(parts)
    return ''

def quote_block(text, max_lines=20):
    lines = text.splitlines()
    if len(lines) > max_lines:
        lines = lines[:max_lines] + ['…']
    lines = [(ln if len(ln) <= 240 else ln[:240] + '…') for ln in lines]
    return '\n'.join('> ' + ln for ln in lines)

def short_title(t):
    first = (t.strip().splitlines() or ['сообщение'])[0]
    return (first[:67] + '…') if len(first) > 70 else first

# --- pass 1: collect ALL, classified by source ---
by_source = {'user-verbatim': [], 'session-continuation': [], 'system-injected': []}
total_user = 0

with SRC.open(encoding='utf-8') as f:
    for line in f:
        try: o = json.loads(line)
        except Exception: continue
        if o.get('type') != 'user': continue
        msg = o.get('message') or {}
        if msg.get('role') != 'user': continue
        text = (extract_text(msg.get('content')) or '').strip()
        if not text: continue
        total_user += 1
        src = classify_source(text)
        if src == 'empty': continue
        by_source[src].append((o.get('timestamp',''), text))

real_msgs = by_source['user-verbatim']
cont_msgs = by_source['session-continuation']
sys_msgs  = by_source['system-injected']

print(f"TOTAL_USER_RECORDS={total_user}")
print(f"USER_VERBATIM={len(real_msgs)}")
print(f"SESSION_CONTINUATIONS={len(cont_msgs)}")
print(f"SYSTEM_INJECTED={len(sys_msgs)}")

# --- pass 2: clean existing OUT dir ---
for p in OUT.glob("*.md"):
    p.unlink()
print(f"CLEARED_OLD_MESSAGES=ok")

# separate output dirs
CONT_OUT = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/70-Chat/session-continuations")
SYS_OUT  = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/70-Chat/system-injected")
CONT_OUT.mkdir(parents=True, exist_ok=True)
SYS_OUT.mkdir(parents=True, exist_ok=True)
for p in CONT_OUT.glob("*.md"): p.unlink()
for p in SYS_OUT.glob("*.md"): p.unlink()

dates = []
type_counts = {}
written = 0
TODAY = datetime.utcnow().strftime("%Y-%m-%d")

# raw verbatim dump — 1 file per real message, no atomization
for idx, (ts, text) in enumerate(real_msgs, 1):
    try: dt = datetime.fromisoformat(ts.replace('Z','+00:00'))
    except Exception: dt = datetime.utcnow()
    date_s = dt.strftime('%Y-%m-%d'); time_s = dt.strftime('%H%M%S')
    fname = f"{date_s}-{time_s}-{idx:04d}.md"
    (RAW / fname).write_text(text, encoding='utf-8')

# session-continuations — evidence of stuck-points, kept for analysis
for idx, (ts, text) in enumerate(cont_msgs, 1):
    try: dt = datetime.fromisoformat(ts.replace('Z','+00:00'))
    except Exception: dt = datetime.utcnow()
    date_s = dt.strftime('%Y-%m-%d'); time_s = dt.strftime('%H%M%S')
    fp = CONT_OUT / f"{date_s}-{time_s}-{idx:04d}.md"
    preview = text[:300].replace('\n', ' ')
    fm = ("---\n"
          "type: session-continuation\n"
          "tags: [\"#источник/claude-компакция\", \"#анализ/затык\"]\n"
          f"created: {date_s}\n"
          f"updated: {TODAY}\n"
          f"timestamp: {ts}\n"
          f"length: {len(text)}\n"
          "source: claude-auto-compaction\n"
          "purpose: stuck-point-analysis\n"
          "related: []\n"
          "---\n\n"
          f"# Session-continuation {date_s} {dt.strftime('%H:%M')}\n\n"
          f"> [!note] Это auto-компакция Claude, НЕ сообщение пользователя\n"
          f"> Сохранено для анализа: где мы застряли, какой контекст терялся.\n"
          f"> Первые 300 симв: {preview}\n\n"
          f"## Полный текст компакции\n\n"
          f"```\n{text[:5000]}\n```\n"
          + ("\n…(truncated, длина " + str(len(text)) + ")\n" if len(text) > 5000 else ""))
    fp.write_text(fm, encoding='utf-8')

# system-injected — metadata (hooks, slash commands)
for idx, (ts, text) in enumerate(sys_msgs, 1):
    try: dt = datetime.fromisoformat(ts.replace('Z','+00:00'))
    except Exception: dt = datetime.utcnow()
    date_s = dt.strftime('%Y-%m-%d'); time_s = dt.strftime('%H%M%S')
    fp = SYS_OUT / f"{date_s}-{time_s}-{idx:04d}.md"
    fm = ("---\n"
          "type: system-injected\n"
          "tags: [\"#источник/система\"]\n"
          f"created: {date_s}\n"
          f"timestamp: {ts}\n"
          f"length: {len(text)}\n"
          "---\n\n"
          f"```\n{text[:3000]}\n```\n")
    fp.write_text(fm, encoding='utf-8')

# scored atomization for enrichment
scored = [(score(t), i, ts, t) for i,(ts,t) in enumerate(real_msgs)]
scored.sort(key=lambda x: (-x[0], x[1]))
KEEP = min(200, len(scored))
chosen = scored[:KEEP]
chosen.sort(key=lambda x: x[2])

for sc, _i, ts, text in chosen:
    try: dt = datetime.fromisoformat(ts.replace('Z','+00:00'))
    except Exception: dt = datetime.utcnow()
    date_s = dt.strftime('%Y-%m-%d'); time_s = dt.strftime('%H%M')
    dates.append(date_s)
    mt = msg_type(text)
    type_counts[mt] = type_counts.get(mt,0)+1
    slug = slugify(text)
    fp = OUT / f"{date_s}-{time_s}-{slug}.md"
    n = 2
    while fp.exists():
        fp = OUT / f"{date_s}-{time_s}-{slug}-{n}.md"; n += 1
    title = short_title(text)
    fm = ("---\n"
          "type: message\n"
          f"tags: [\"#источник/пользователь-verbatim\", \"#msg/{mt}\"]\n"
          f"created: {date_s}\n"
          f"updated: {TODAY}\n"
          "status: active\n"
          f"msg_type: {mt}\n"
          f"timestamp: {ts}\n"
          f"raw_length: {len(text)}\n"
          f"score: {sc}\n"
          "source: jsonl-verbatim\n"
          "verified: true\n"
          "related: []\n"
          "---\n\n")
    body = (f"# {date_s} {dt.strftime('%H:%M')} — {title}\n\n"
            f"> [!quote] Дословный текст пользователя (проверено против JSONL)\n"
            f"{quote_block(text)}\n\n"
            f"## Тип\n{mt}\n\n"
            f"## Метаданные\n- длина: {len(text)} симв\n- score: {sc}\n- timestamp: {ts}\n- verbatim source: `70-Chat/raw-verbatim/`\n")
    fp.write_text(fm + body, encoding='utf-8')
    written += 1

print(f"KEPT_ATOMIZED={written}")
print(f"VERBATIM_DUMPED={len(real_msgs)}")
if dates:
    print(f"DATE_RANGE={min(dates)} .. {max(dates)}")
print("TYPE_COUNTS=" + json.dumps(type_counts, ensure_ascii=False))

# --- extraction report (keeps all classes, for stuck-point analysis) ---
report_fp = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/40-Active/extraction-report.md")
report_fp.parent.mkdir(parents=True, exist_ok=True)
with report_fp.open('w', encoding='utf-8') as f:
    f.write("---\ntype: audit\ntags: [meta, extraction, chat-history]\n")
    f.write(f"created: {TODAY}\nstatus: active\n")
    f.write(f"total_user_records: {total_user}\n")
    f.write(f"user_verbatim: {len(real_msgs)}\n")
    f.write(f"session_continuations: {len(cont_msgs)}\n")
    f.write(f"system_injected: {len(sys_msgs)}\n---\n\n")
    f.write("# Отчёт: экстракция истории чата (v2, 3 класса)\n\n")
    f.write(f"- Всего user-записей в JSONL: **{total_user}**\n")
    f.write(f"- Реальных сообщений пользователя (verbatim): **{len(real_msgs)}** — в `70-Chat/messages/` + `70-Chat/raw-verbatim/`\n")
    f.write(f"- Session-continuations (Claude-компакции, затыки): **{len(cont_msgs)}** — в `70-Chat/session-continuations/`\n")
    f.write(f"- System-injected (reminders, commands): **{len(sys_msgs)}** — в `70-Chat/system-injected/`\n\n")
    f.write("## Почему session-continuations сохранены\n\n")
    f.write("> Пользователь 2026-04-15: «пусть они тоже будут по ним потом находить косяки и эволюционировать проще будет и анализировать наши затыки в задачах»\n\n")
    f.write("Каждая компакция = маркер того, что диалог упирался в контекстное окно. Анализ плотности компакций по датам покажет самые тяжёлые эпизоды.\n\n")
    f.write("## Распределение типов user-verbatim\n\n")
    for t, c in sorted(type_counts.items(), key=lambda x:-x[1]):
        f.write(f"- `{t}`: {c}\n")
print(f"REPORT={report_fp}")
