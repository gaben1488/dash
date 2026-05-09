"""
transcripts_pattern_analyzer.py — выискивает в jsonl-транскриптах паттерны
where user пришлось переделывать / поправлять / не понимать.

Output:
  reports/transcripts_patterns_2026-05-09.md

Что собирает:
  1. User messages с триггерами «не так», «переделай», «не понял»,
     «ничего не понял», «исправь», «заново», «забудь», «не туда»
  2. Контекст моего предыдущего ответа (что я сделал)
  3. User-corrections (фактические правки моих утверждений)
  4. Моменты где user явно просил какой skill/MCP

Используется на последних 30 транскриптах (свежее = релевантнее).
"""
import json, sys, re
from pathlib import Path
from collections import Counter
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

TRANSCRIPTS = Path(r'C:\Users\filat\.claude\projects\C--Users-filat-dash')
REPORTS = Path(r'C:\Users\filat\dash\reports')
REPORTS.mkdir(exist_ok=True)

# Триггеры — рекомендации к переделке от user
REDO_PATTERNS = [
    r'\bне\s*так\b',
    r'\bпереде(л|лай)',
    r'\bне\s*понял\b',
    r'\bничего\s*не\s*понял\b',
    r'\bисправ',
    r'\bзаново\b',
    r'\bзабудь\b',
    r'\bне\s*туда\b',
    r'\bты\s*ошиб',
    r'\bпредпис',
    r'\bне\s*оч\b',
    r'\bне\s*правильно\b',
    r'\bты\s*не\s*то\b',
    r'\bхалтур',
    r'\bне\s*работа',
    r'\b502\b',  # частая ошибка про сервер
    r'\bне\s*смог',
    r'\bошибка\s+',
    r'\bглюч',
    r'\bвыдают?\s*ошибку\b',
]

# Триггеры — user указывает на skill/tool
SKILL_HINT_PATTERNS = [
    r'\b(impeccable|caveman|graphify|playwright|figma|cognee|distill|lint|humanizer|brainstorm|design-extract|browser-harness|open-design)\b',
    r'\bskill\s+(\w+)',
    r'\bMCP\s+(\w+)',
    r'\b/(\w+)',  # slash-command
]

def collect_jsonl(limit=30):
    """Берёт последние N jsonl-файлов сессий."""
    files = sorted(TRANSCRIPTS.glob('*.jsonl'), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:limit]

def extract_user_msgs(jsonl_path: Path):
    """Возвращает список (timestamp, content, prev_assistant_excerpt)."""
    msgs = []
    prev_assistant = ''
    try:
        with jsonl_path.open('r', encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                role = rec.get('type') or rec.get('role')
                # User msg
                if rec.get('type') == 'user' and rec.get('message', {}).get('role') == 'user':
                    content = rec['message'].get('content', '')
                    if isinstance(content, list):
                        # collect только текстовые части
                        text_parts = [p.get('text', '') for p in content if isinstance(p, dict) and p.get('type') == 'text']
                        content = ' '.join(text_parts)
                    if isinstance(content, str) and content.strip():
                        ts = rec.get('timestamp', '')
                        msgs.append((ts, content[:600], prev_assistant[:400]))
                # Assistant msg — для prev_assistant
                elif rec.get('type') == 'assistant':
                    a_content = rec.get('message', {}).get('content', [])
                    if isinstance(a_content, list):
                        text = ' '.join([p.get('text', '') for p in a_content if isinstance(p, dict) and p.get('type') == 'text'])
                        if text:
                            prev_assistant = text
    except Exception as e:
        print(f'[warn] skipped {jsonl_path.name}: {e}')
    return msgs

def find_patterns(msgs):
    """Находит user-сообщения с redo / skill-hint триггерами."""
    redo_re = re.compile('|'.join(REDO_PATTERNS), re.IGNORECASE)
    skill_re = re.compile('|'.join(SKILL_HINT_PATTERNS), re.IGNORECASE)

    redo_hits = []
    skill_hits = []

    for ts, content, prev in msgs:
        # фильтруем системный шум — система-reminder hooks начинаются с "<system-reminder>"
        if content.strip().startswith('<system-reminder>') or 'UserPromptSubmit hook' in content:
            continue
        # пропустим pulse-вставки (они длинные, не user)
        if 'loop_strength' in content or 'Сила петли' in content:
            continue

        if redo_re.search(content):
            # вытащим matched fragment
            m = redo_re.search(content)
            redo_hits.append({
                'ts': ts,
                'trigger': content[max(0, m.start()-30):m.end()+50].replace('\n', ' '),
                'msg_excerpt': content[:300].replace('\n', ' '),
                'prev_assistant_excerpt': prev[:200].replace('\n', ' '),
            })

        for hit in skill_re.finditer(content):
            skill_hits.append({
                'ts': ts,
                'mention': hit.group(),
                'msg_excerpt': content[:200].replace('\n', ' '),
            })

    return redo_hits, skill_hits

# ---- main ----
print('[transcripts] collecting jsonl files...')
jsonl_files = collect_jsonl(limit=30)
print(f'  found {len(jsonl_files)} files')

all_redo = []
all_skill = []
counters = Counter()

for jf in jsonl_files:
    msgs = extract_user_msgs(jf)
    redo, skill = find_patterns(msgs)
    counters[jf.name] = (len(msgs), len(redo))
    all_redo.extend(redo)
    all_skill.extend(skill)

print(f'\n  total user messages scanned: {sum(c[0] for c in counters.values())}')
print(f'  redo/correction hits: {len(all_redo)}')
print(f'  skill/tool mentions: {len(all_skill)}')

# Markdown отчёт
md = ['# Transcripts pattern analysis — 2026-05-09', '']
md.append(f'Просмотрено: **{len(jsonl_files)}** последних jsonl-сессий, **{sum(c[0] for c in counters.values())}** user-сообщений.')
md.append('')
md.append(f'**Redo/correction hits**: {len(all_redo)}')
md.append(f'**Skill/tool mentions**: {len(all_skill)}')
md.append('')
md.append('## Top-30 моментов «переделай / не так / не понял»')
md.append('')
md.append('| Когда | Триггер (в контексте) | Что писал user | Что я отвечал перед этим |')
md.append('|---|---|---|---|')

# Сортируем по timestamp DESC и берём топ-50
all_redo.sort(key=lambda x: x.get('ts', ''), reverse=True)
for h in all_redo[:30]:
    ts = (h['ts'] or '')[:10]
    trig = h['trigger'].replace('|', '\\|')[:80]
    msg = h['msg_excerpt'].replace('|', '\\|')[:200]
    prev = h['prev_assistant_excerpt'].replace('|', '\\|')[:150]
    md.append(f'| {ts} | `{trig}` | {msg} | {prev} |')

md.append('')
md.append('## Counter упоминаний skills/tools (от user)')
md.append('')
mentions = Counter(s['mention'].lower() for s in all_skill)
md.append('| Skill/tool | Упоминаний |')
md.append('|---|---:|')
for k, v in mentions.most_common(30):
    md.append(f'| {k} | {v} |')

out = REPORTS / 'transcripts_patterns_2026-05-09.md'
out.write_text('\n'.join(md), encoding='utf-8')
print(f'\n[OK] wrote {out}')
