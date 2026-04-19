"""Extract assistant responses + build causal chains from Claude Code JSONL."""
import json, re, os, sys
from datetime import datetime
from pathlib import Path

SRC = Path(r"C:/Users/filat/.claude/projects/C--Users-filat-dash/725bfdb8-55f0-45ec-a166-df2c4a389210.jsonl")
BASE = Path(r"C:/Users/filat/Documents/Obsidian/delete not delete/AEMR/70-Chat")
OUT_RESP = BASE / "responses"
OUT_CHAIN = BASE / "chains"
MSG_DIR = BASE / "messages"
OUT_RESP.mkdir(parents=True, exist_ok=True)
OUT_CHAIN.mkdir(parents=True, exist_ok=True)

TODAY = '2026-04-15'

# ── translit / slug (reused) ──
TRANSLIT = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z',
    'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
    'с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch',
    'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
}
def translit(s):
    out=[]
    for ch in s.lower():
        if ch in TRANSLIT: out.append(TRANSLIT[ch])
        elif ch.isalnum() or ch in ' -': out.append(ch)
        else: out.append(' ')
    return ''.join(out)

def slugify(text, maxlen=50):
    words = text.strip().split()[:6]
    s = translit(' '.join(words))
    s = re.sub(r'[^a-z0-9]+','-',s).strip('-')
    if not s: s='resp'
    return s[:maxlen].rstrip('-')

# ── text extractors ──
def extract_assistant_text(content):
    """Return assistant prose; skip tool_use, keep text/thinking summaries."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for it in content:
            if not isinstance(it, dict): continue
            t = it.get('type')
            if t == 'text':
                parts.append(it.get('text',''))
            # skip tool_use, skip thinking (internal reasoning, not visible)
        return '\n'.join(p for p in parts if p)
    return ''

def extract_user_text(content):
    if isinstance(content, str):
        if content.startswith('<command-') or content.startswith('<local-command'): return ''
        if '[Request interrupted' in content: return ''
        if 'caveat: the messages do not contain' in content.lower(): return ''
        return content
    if isinstance(content, list):
        parts = []
        for it in content:
            if not isinstance(it, dict): continue
            if it.get('type') == 'tool_result': return ''
            if it.get('type') == 'text':
                parts.append(it.get('text',''))
        return '\n'.join(parts)
    return ''

# ── kind classifier ──
PLAN_PAT = [r'\bплан\b', r'\bфаз[аы]\b', r'\bэтап', r'\bшаг\s*\d', r'\bphase\b']
DECISION_PAT = [r'\bрешение\b', r'\bвыбираю\b', r'\bвыбрал\b', r'\bпредлагаю\b', r'\bрекоменду']
ANALYSIS_PAT = [r'\bанализ\b', r'\bаудит\b', r'\bразбор\b', r'\bпроверил\b', r'\bнайден']
REPORT_PAT = [r'\bготово\b', r'\bвыполнил\b', r'\bсделал\b', r'\bзакомм', r'\bсоздал\b']
CONCLUSION_PAT = [r'\bитог', r'\bвывод', r'\bзначит\b', r'\bследовательно\b']

def kind_of(text):
    t = text.lower()
    def hit(pats): return any(re.search(p, t) for p in pats)
    if hit(ANALYSIS_PAT): return 'анализ'
    if hit(PLAN_PAT): return 'план'
    if hit(DECISION_PAT): return 'решение'
    if hit(REPORT_PAT): return 'отчёт'
    if hit(CONCLUSION_PAT): return 'вывод'
    return 'ответ'

# ── scoring ──
TRIVIAL_PREFIX = (
    'ok','ok.','ok!','done','done.','got it','understood','sure','yes','yeah',
    'хорошо','ок','окей','понял','готово','принял','ясно','да','нет'
)
def is_trivial(text):
    t = text.strip().lower()
    if len(t) < 60: return True
    first = t.split('\n')[0].strip(' .,!')
    if first in TRIVIAL_PREFIX and len(t) < 200: return True
    return False

def score_resp(text):
    t = text.lower().strip()
    if not t: return -100
    s = 0
    L = len(t)
    s += min(L // 80, 30)
    if L > 300: s += 5
    if L > 800: s += 8
    if L > 2000: s += 8
    for p in ANALYSIS_PAT:
        if re.search(p, t): s += 6
    for p in PLAN_PAT:
        if re.search(p, t): s += 5
    for p in DECISION_PAT:
        if re.search(p, t): s += 5
    for p in REPORT_PAT:
        if re.search(p, t): s += 3
    # list/structure bonus
    if re.search(r'^\s*[-*]\s', text, re.M): s += 3
    if re.search(r'^#{1,3}\s', text, re.M): s += 3
    if re.search(r'```', text): s += 2
    return s

# ── strip code blocks & tool noise for "summary" display ──
def strip_for_summary(text, limit=1100):
    # remove fenced code blocks
    t = re.sub(r'```.*?```', '[…код…]', text, flags=re.S)
    # collapse repeated blank lines
    t = re.sub(r'\n{3,}', '\n\n', t)
    t = t.strip()
    if len(t) > limit:
        t = t[:limit].rstrip() + '…'
    return t

def quote_block(text, max_lines=18):
    lines = text.splitlines()
    if len(lines) > max_lines:
        lines = lines[:max_lines] + ['…']
    lines = [(ln if len(ln) <= 240 else ln[:240] + '…') for ln in lines]
    return '\n'.join('> ' + ln if ln else '> ' for ln in lines)

# ── detect actions mentioned in response ──
ACTION_PATTERNS = [
    (r'созда[лв]\s+(?:файл\s+)?[`"\']?([^\s`"\']+\.[a-z]{2,4})', 'создал'),
    (r'измен[иеё][лв]\s+(?:файл\s+)?[`"\']?([^\s`"\']+\.[a-z]{2,4})', 'изменил'),
    (r'удалил\s+[`"\']?([^\s`"\']+\.[a-z]{2,4})', 'удалил'),
    (r'(?:commit|коммит)[^\n]{0,60}?([0-9a-f]{7,40})', 'коммит'),
    (r'запусти[лв]\s+([a-z0-9_\-./]+)', 'запустил'),
]
def extract_actions(text):
    out = []
    for pat, verb in ACTION_PATTERNS:
        for m in re.finditer(pat, text, flags=re.I):
            out.append(f'{verb}: `{m.group(1)}`')
    # dedupe preserve order
    seen, res = set(), []
    for a in out:
        if a in seen: continue
        seen.add(a); res.append(a)
        if len(res) >= 8: break
    return res

# ─────────────────────────────────────
# Pass 1: collect all user+assistant events
# ─────────────────────────────────────
events = []  # list of dicts: {role, ts, text, session, idx, uuid, parent}
idx_counter = 0
with SRC.open(encoding='utf-8') as f:
    for line in f:
        try: o = json.loads(line)
        except Exception: continue
        typ = o.get('type')
        if typ not in ('user','assistant'): continue
        msg = o.get('message') or {}
        role = msg.get('role')
        if role not in ('user','assistant'): continue
        if role == 'user':
            text = extract_user_text(msg.get('content'))
        else:
            text = extract_assistant_text(msg.get('content'))
        text = (text or '').strip()
        if not text: continue
        events.append({
            'role': role,
            'ts': o.get('timestamp') or '',
            'text': text,
            'session': o.get('sessionId') or '',
            'idx': idx_counter,
            'uuid': o.get('uuid') or '',
            'parent': o.get('parentUuid') or '',
        })
        idx_counter += 1

print(f"TOTAL_EVENTS={len(events)}")
user_count = sum(1 for e in events if e['role']=='user')
asst_count = sum(1 for e in events if e['role']=='assistant')
print(f"USER={user_count} ASSISTANT={asst_count}")

# ─────────────────────────────────────
# Pass 2: pair each assistant with the immediately preceding user (same session)
# ─────────────────────────────────────
pairs = []  # (user_event_or_None, assistant_event)
last_user_per_session = {}
for e in events:
    sess = e['session']
    if e['role'] == 'user':
        last_user_per_session[sess] = e
    else:
        u = last_user_per_session.get(sess)
        pairs.append((u, e))

# ─────────────────────────────────────
# Pass 3: collapse consecutive assistant events to same user
# (so each user message -> single merged assistant response per chunk)
# Actually: keep each assistant event separately but mark same-user group.
# ─────────────────────────────────────

# ─────────────────────────────────────
# Pass 4: score, pick top ~120
# ─────────────────────────────────────
scored = []
for i, (u, a) in enumerate(pairs):
    if is_trivial(a['text']): continue
    sc = score_resp(a['text'])
    scored.append((sc, i, u, a))

scored.sort(key=lambda x: (-x[0], x[1]))
KEEP = 120
chosen = scored[:KEEP]
chosen.sort(key=lambda x: x[3]['ts'])  # chronological

# ─────────────────────────────────────
# Helper: find user-message filename slug from MSG_DIR by timestamp
# ─────────────────────────────────────
# Build an index: filename -> (date, hhmm, slug)
msg_files = []
if MSG_DIR.exists():
    for p in MSG_DIR.iterdir():
        if p.suffix == '.md':
            m = re.match(r'(\d{4}-\d{2}-\d{2})-(\d{4})-(.+)\.md$', p.name)
            if m:
                msg_files.append((m.group(1), m.group(2), m.group(3), p.stem))

def find_user_note_stem(u_event):
    if not u_event: return None
    try:
        dt = datetime.fromisoformat(u_event['ts'].replace('Z','+00:00'))
    except Exception:
        return None
    date_s = dt.strftime('%Y-%m-%d')
    hhmm = dt.strftime('%H%M')
    # exact match first
    for d, h, s, stem in msg_files:
        if d == date_s and h == hhmm:
            return stem
    # near match ±2 min
    target = dt.hour * 60 + dt.minute
    best = None; best_d = 999
    for d, h, s, stem in msg_files:
        if d != date_s: continue
        try:
            mh = int(h[:2]); mm = int(h[2:])
        except Exception: continue
        diff = abs(mh*60+mm - target)
        if diff < best_d:
            best_d = diff; best = stem
    if best_d <= 3: return best
    return None

# ─────────────────────────────────────
# Pass 5: write response notes
# ─────────────────────────────────────
written_resp = []
kind_counts = {}
for sc, idx, u, a in chosen:
    try:
        dt = datetime.fromisoformat(a['ts'].replace('Z','+00:00'))
    except Exception:
        dt = datetime.utcnow()
    date_s = dt.strftime('%Y-%m-%d')
    time_s = dt.strftime('%H%M')
    text = a['text']
    # title from first non-empty sentence or line
    first_line = next((ln for ln in text.splitlines() if ln.strip() and not ln.strip().startswith('#')), text[:80])
    first_line = re.sub(r'[*`_#>]', '', first_line).strip()
    title = first_line[:70] + ('…' if len(first_line) > 70 else '')
    slug = slugify(first_line)
    fname = f"{date_s}-{time_s}-{slug}.md"
    fpath = OUT_RESP / fname
    n = 2
    while fpath.exists():
        fpath = OUT_RESP / f"{date_s}-{time_s}-{slug}-{n}.md"
        n += 1

    kind = kind_of(text)
    kind_counts[kind] = kind_counts.get(kind, 0) + 1
    user_stem = find_user_note_stem(u)
    responds_to = f"[[70-Chat/messages/{user_stem}]]" if user_stem else '"—"'

    summary = strip_for_summary(text, 1100)
    actions = extract_actions(text)

    fm = (
        "---\n"
        "type: response\n"
        "tags: [\"#источник/ассистент\"]\n"
        f"created: {date_s}\n"
        f"updated: {TODAY}\n"
        "status: active\n"
        f"timestamp: \"{a['ts']}\"\n"
        f"session: \"{a['session']}\"\n"
        f"responds_to: {responds_to if responds_to.startswith('[[') else responds_to}\n"
        f"length: {len(text)}\n"
        f"kind: {kind}\n"
        "related: []\n"
        "---\n\n"
    )
    body = (
        f"# {date_s} {dt.strftime('%H:%M')} — {title}\n\n"
        f"> [!note] Тип: {kind}\n\n"
        "## На что отвечает\n"
        f"{responds_to if responds_to.startswith('[[') else '—'}\n\n"
        "## Содержание (сокращение)\n"
        f"{quote_block(summary)}\n\n"
        "## Что сделал (действия упомянутые)\n"
        + ('\n'.join(f'- {a}' for a in actions) if actions else '- —')
        + '\n'
    )
    fpath.write_text(fm + body, encoding='utf-8')
    written_resp.append((fpath.stem, a, u, kind))

print(f"RESPONSES_WRITTEN={len(written_resp)}")
print(f"KINDS={json.dumps(kind_counts, ensure_ascii=False)}")

# ─────────────────────────────────────
# Pass 6: CAUSAL CHAINS
# Heuristic: find user messages that contain pivot triggers and are followed
# by a substantial assistant response (>500 chars); then include the next
# user reaction (if any) to close the loop.
# ─────────────────────────────────────
PIVOT = [
    r'\bне\s+так\b', r'\bстоп\b', r'\bотмени', r'\bперекрой',
    r'\bпересмотри', r'\bпеределай', r'\bперепиши', r'\bне\s+надо',
    r'\bпарадигма\b', r'\bпринцип\b', r'\bметодология\b', r'\bмиксер\b',
    r'\bпереосмыс', r'\bсмысл\b', r'\bидея\b', r'\bконцепция\b',
    r'\bфилософия\b', r'\bподход\b', r'\bна\s+самом\s+деле',
    r'\bдолжен\b', r'\bобязательно\b', r'\bвсегда\b', r'\bникогда\b',
]

def is_pivot(text):
    t = text.lower()
    return any(re.search(p, t) for p in PIVOT)

# find pivot triples
triples = []  # (pivot_user_event, assistant_event, next_user_event or None, score)
for i, (u, a) in enumerate(pairs):
    if not u: continue
    if not is_pivot(u['text']): continue
    if len(a['text']) < 500: continue
    # next user message in same session after assistant
    next_user = None
    for j in range(i+1, len(pairs)):
        u2, _ = pairs[j]
        if u2 and u2['session'] == u['session'] and u2['idx'] > a['idx']:
            next_user = u2
            break
    # score: user length + pivot hits + assistant length
    s = len(u['text']) + len(a['text']) // 3
    for p in PIVOT:
        if re.search(p, u['text'].lower()): s += 50
    # bonus if next_user is a reaction (praise/complaint/correction)
    if next_user:
        nt = next_user['text'].lower()
        if any(re.search(p, nt) for p in [r'\bне\b', r'\bплохо\b', r'\bхорошо\b', r'\bотлично\b', r'\bда\b', r'\bнет\b']):
            s += 100
    triples.append((s, i, u, a, next_user))

triples.sort(key=lambda x: -x[0])
# deduplicate by user timestamp (avoid near-identical)
seen_ts = set()
top_triples = []
for t in triples:
    ts = t[2]['ts'][:16]
    if ts in seen_ts: continue
    seen_ts.add(ts)
    top_triples.append(t)
    if len(top_triples) >= 20: break

top_triples.sort(key=lambda x: x[2]['ts'])

# Lookup table response stem by uuid/timestamp
resp_stem_by_asst_uuid = {}
for stem, a_ev, u_ev, kind in written_resp:
    resp_stem_by_asst_uuid[a_ev['uuid']] = stem

def find_written_resp(a_event):
    return resp_stem_by_asst_uuid.get(a_event['uuid'])

# write chains
chain_themes = []
for s, i, u, a, nu in top_triples:
    try:
        dt = datetime.fromisoformat(u['ts'].replace('Z','+00:00'))
    except Exception:
        dt = datetime.utcnow()
    date_s = dt.strftime('%Y-%m-%d')
    # theme from first meaningful pivot keyword
    theme_text = u['text']
    theme_slug = slugify(theme_text, maxlen=45)
    fname = f"chain-{date_s}-{theme_slug}.md"
    fpath = OUT_CHAIN / fname
    n = 2
    while fpath.exists():
        fpath = OUT_CHAIN / f"chain-{date_s}-{theme_slug}-{n}.md"
        n += 1

    user_stem = find_user_note_stem(u)
    asst_stem = find_written_resp(a)
    next_user_stem = find_user_note_stem(nu) if nu else None

    user_quote = u['text'].strip().replace('\n',' ')[:220]
    asst_quote = strip_for_summary(a['text'], 400).replace('\n',' ')[:320]
    next_user_quote = nu['text'].strip().replace('\n',' ')[:200] if nu else None

    # summary description: first 80 chars of user pivot
    desc = u['text'].strip().splitlines()[0][:120]
    chain_themes.append(desc)

    try:
        dt_a = datetime.fromisoformat(a['ts'].replace('Z','+00:00'))
    except Exception:
        dt_a = dt

    steps_count = 2 + (1 if nu else 0) + 1  # user, assistant, (next_user), result

    lines = []
    lines.append("---")
    lines.append("type: chain")
    lines.append("tags: [причинно-следственная]")
    lines.append(f"created: {TODAY}")
    lines.append("status: active")
    safe_desc = desc.replace('"', "'")
    lines.append(f'description: "{safe_desc}"')
    lines.append(f"steps_count: {steps_count}")
    lines.append("---\n")
    lines.append(f"# Цепочка: {desc[:80]}\n")
    abstract = (
        f"Пользователь задал разворот ({dt.strftime('%Y-%m-%d %H:%M')}); "
        f"ассистент развернул ответ на {len(a['text'])} симв.; "
        + ("последовала реакция пользователя." if nu else "прямого ответа-реакции в том же окне не найдено.")
    )
    lines.append(f"> [!abstract] Короткая история")
    lines.append(f"> {abstract}\n")
    lines.append("## Шаги\n")

    step = 1
    user_link = f"[[70-Chat/messages/{user_stem}]]" if user_stem else "_(без привязки к messages/)_"
    lines.append(f"{step}. **{user_link}** ({dt.strftime('%Y-%m-%d %H:%M')}) — пользователь сказал: \"{user_quote}\"")
    step += 1
    asst_link = f"[[70-Chat/responses/{asst_stem}]]" if asst_stem else "_(ответ ассистента, не в топ-120)_"
    lines.append(f"{step}. **{asst_link}** ({dt_a.strftime('%Y-%m-%d %H:%M')}) — ассистент ответил: \"{asst_quote}\"")
    step += 1
    # consequence guess
    cons_hints = []
    actions = extract_actions(a['text'])
    if actions:
        cons_hints.append('действия в ответе: ' + '; '.join(actions[:4]))
    t = a['text'].lower()
    if 'memory' in t or 'feedback_' in t or 'design_' in t:
        cons_hints.append('возможный артефакт в [[memory/]] (feedback_*/design_*)')
    if 'commit' in t or re.search(r'[0-9a-f]{7,40}', a['text']):
        cons_hints.append('возможный git-коммит')
    if not cons_hints:
        cons_hints.append('прямого артефакта не зафиксировано — смотреть по теме')
    lines.append(f"{step}. **Результат** — " + '; '.join(cons_hints))
    step += 1
    if nu:
        try:
            dt_n = datetime.fromisoformat(nu['ts'].replace('Z','+00:00'))
        except Exception:
            dt_n = dt_a
        nu_link = f"[[70-Chat/messages/{next_user_stem}]]" if next_user_stem else "_(без привязки)_"
        lines.append(f"{step}. **{nu_link}** ({dt_n.strftime('%Y-%m-%d %H:%M')}) — пользователь сказал: \"{next_user_quote}\"")
    lines.append("")
    lines.append("## Вывод")
    conclusion = (
        "Цепочка фиксирует момент поворота: пользователь задал новую рамку/правку, "
        "ассистент развернул ответ, далее (если есть) реакция пользователя закрепляет или отвергает."
    )
    lines.append(conclusion)
    lines.append("")

    fpath.write_text('\n'.join(lines), encoding='utf-8')

print(f"CHAINS_WRITTEN={len(top_triples)}")
print("TOP_CHAIN_THEMES=" + json.dumps(chain_themes[:6], ensure_ascii=False))

# summary sample
print("SAMPLE_RESP=" + json.dumps([w[0] for w in written_resp[:3]], ensure_ascii=False))
