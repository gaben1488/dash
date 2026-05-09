"""
transcripts_action_triggers.py — анализирует мои собственные действия,
а не реплики user'а. Ищет паттерны где я ДЕЛАЛ что-то, для чего был skill,
но skill не использовал.

Логика: для каждого assistant-msg / tool_use смотрим:
  - какой инструмент применил
  - какой текст в ответе
  - какой skill ДОЛЖЕН был быть применён по триггеру
  - был ли он применён (Skill tool, Read of SKILL.md, etc.)

Output: reports/action_triggers_2026-05-09.md
"""
import json, sys, re
from pathlib import Path
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding='utf-8')

TRANSCRIPTS = Path(r'C:\Users\filat\.claude\projects\C--Users-filat-dash')
REPORTS = Path(r'C:\Users\filat\dash\reports')
REPORTS.mkdir(exist_ok=True)

# Action → expected skill mapping
ACTION_TRIGGERS = [
    # (regex_in_assistant_text_or_tool_input, expected_skill, why)
    (re.compile(r'\.xlsx?\b|\.xlsb\b', re.I), 'inventory-all-sheets (mx-9a5328)',
     'я читал xlsx/xlsb файл — должен был перечислить ВСЕ wb.sheetnames'),
    (re.compile(r'\b(done|готово|complete[d]?)\b', re.I), 'superpowers:verification-before-completion',
     'я сказал "done" — должен был сначала curl/test/verify'),
    (re.compile(r'\b(давай (?:обсудим|подумаем)|варианты|brainstorm|обсудить)\b', re.I), 'superpowers:brainstorming',
     'design-разговор — HARD-GATE: нельзя писать код до утверждения'),
    (re.compile(r'\b(не работает|упал|ошибка|fix|debug|сломал)', re.I), 'superpowers:systematic-debugging',
     'debugging без skill — root cause до фикса'),
    (re.compile(r'\b(миграц|выберем|выбираем|architecture|архитектур|ADR)\b', re.I),
     'ag-architecture-design-architecture-decision-records',
     'архитектурное решение без ADR — нарушение invariant'),
    (re.compile(r'\bимпортируем|новая зависимость|install|устанавливаем\b', re.I),
     'ADR + verification', 'новая зависимость без ADR + verify'),
    (re.compile(r'\.tsx?\b|компонент|страниц[ауы]|UI', re.I), 'impeccable-shape (план) → impeccable-impeccable (код)',
     'UI работа без impeccable-shape сначала'),
    (re.compile(r'\bSELECT\b|\bINSERT\b|\bUPDATE\b|query|aggregation', re.I),
     'data:explore-data → data:write-query или ag-data-analytics-sql-pro',
     'SQL без data-skill'),
    (re.compile(r'pnpm test|vitest|jest', re.I), 'superpowers:test-driven-development',
     'тестирование без TDD цикла'),
    (re.compile(r'parallel|агент[оа]в|swarm|одновременно', re.I), 'superpowers:dispatching-parallel-agents',
     'parallel work без skill — risk of context-explosion'),
    (re.compile(r'humanizer|prose|стиль|литературный', re.I), 'humanizer',
     'длинная проза без humanizer'),
    (re.compile(r'\bcaveman\b|\bbrief\b|\bкомпактн', re.I), 'caveman',
     'token-discipline без caveman'),
    (re.compile(r'\bml record\b'), 'mulch search FIRST (mx-c60216)',
     'ml record без предварительного mulch search — дубли'),
    (re.compile(r'browser|navigate|клик|открой страницу', re.I),
     'mcp__claude-in-chrome__* или browser-harness',
     'browser-операции — DOM-aware skill'),
    (re.compile(r'\bsupabase|postgres', re.I), 'postgres skill или mcp__e5427ac6_*',
     'PG/Supabase work без специализированного MCP'),
]

# What signals me ACTUALLY using a skill in this turn
USED_SKILL_PATTERNS = [
    re.compile(r'\bSkill\(["\']'),  # Skill tool call
    re.compile(r'subagent_type[\'"]?\s*[=:]'),  # Agent tool
    re.compile(r'mulch\s+search', re.I),
    re.compile(r'~/\.claude/skills/', re.I),
]

def collect_jsonl(limit=20):
    files = sorted(TRANSCRIPTS.glob('*.jsonl'), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:limit]

def extract_assistant_turns(jsonl_path):
    """Return list of (timestamp, text, tool_uses) for every assistant turn."""
    turns = []
    try:
        with jsonl_path.open('r', encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                if rec.get('type') != 'assistant':
                    continue
                msg = rec.get('message', {})
                content = msg.get('content', [])
                if not isinstance(content, list):
                    continue
                texts, tools = [], []
                for p in content:
                    if not isinstance(p, dict):
                        continue
                    if p.get('type') == 'text':
                        texts.append(p.get('text', ''))
                    elif p.get('type') == 'tool_use':
                        tools.append({
                            'name': p.get('name', ''),
                            'input': json.dumps(p.get('input', {}), ensure_ascii=False)[:500]
                        })
                turns.append({
                    'ts': rec.get('timestamp', ''),
                    'text': ' '.join(texts),
                    'tools': tools,
                })
    except Exception as e:
        print(f'[warn] {jsonl_path.name}: {e}')
    return turns

def detect_misses(turns):
    """For each turn, find triggered actions and check if appropriate skill used."""
    misses = []
    for t in turns:
        text = t['text']
        tools_str = ' '.join(t['name'] + ' ' + t['input'] for t in t['tools']) if t['tools'] else ''
        full_blob = text + ' ' + tools_str

        # Did I use skill in THIS turn?
        used_skill = False
        for sp in USED_SKILL_PATTERNS:
            if sp.search(full_blob):
                used_skill = True
                break

        # Did I invoke Skill tool name explicitly?
        for tool in t['tools']:
            if tool['name'] == 'Skill' or 'subagent_type' in tool['input']:
                used_skill = True

        # Triggers detected in this turn
        for pat, expected_skill, why in ACTION_TRIGGERS:
            if pat.search(text):
                misses.append({
                    'ts': t['ts'][:19] if t['ts'] else '',
                    'trigger': pat.pattern[:60],
                    'expected_skill': expected_skill,
                    'why': why,
                    'used_skill_in_turn': used_skill,
                    'snippet': text[max(0, pat.search(text).start()-50):pat.search(text).end()+100].replace('\n',' ')[:200],
                })
    return misses

# ---- main ----
print('[action-triggers] scanning last 20 jsonl-files')
files = collect_jsonl(20)
print(f'  {len(files)} files')

all_misses = []
total_turns = 0
for jf in files:
    turns = extract_assistant_turns(jf)
    total_turns += len(turns)
    all_misses.extend(detect_misses(turns))

print(f'  total assistant turns: {total_turns}')
print(f'  triggers fired: {len(all_misses)}')

# Group: skill-not-used in turn (real misses)
real_misses = [m for m in all_misses if not m['used_skill_in_turn']]
print(f'  REAL MISSES (trigger fired, skill NOT used): {len(real_misses)}')

# Stats by expected skill
miss_by_skill = Counter(m['expected_skill'] for m in real_misses)

# Markdown
md = ['# Action-trigger missed-skill analysis — 2026-05-09', '']
md.append(f'Сканировано **{len(files)}** последних jsonl-файлов, **{total_turns}** assistant-турнов.')
md.append('')
md.append(f'**Triggers fired total**: {len(all_misses)}')
md.append(f'**Real misses (skill NOT invoked в том же турне)**: {len(real_misses)}')
md.append('')
md.append('## Top пропущенных skills (где я делал X но не вызвал нужный skill)')
md.append('')
md.append('| Skill (expected) | Сколько раз пропустил |')
md.append('|---|---:|')
for k, v in miss_by_skill.most_common(20):
    md.append(f'| {k} | {v} |')

md.append('')
md.append('## Конкретные кейсы пропусков (последние 30)')
md.append('')
md.append('| Когда | Trigger | Должен был invoke | Почему | Snippet |')
md.append('|---|---|---|---|---|')
real_misses.sort(key=lambda x: x['ts'], reverse=True)
for m in real_misses[:30]:
    snippet = m['snippet'].replace('|','\\|')[:150]
    md.append(f'| {m["ts"][:10]} | `{m["trigger"][:30]}` | {m["expected_skill"][:40]} | {m["why"][:60]} | {snippet} |')

out = REPORTS / 'action_triggers_2026-05-09.md'
out.write_text('\n'.join(md), encoding='utf-8')
print(f'\n[OK] {out}')
