"""
drive_sheet_digest.py — компактный дайджест из выгрузки Google Sheets,
сделанной через Drive MCP read_file_content (она падает в tool-results/*.txt
как JSON {"fileContent": "<natural-language text of the sheet>"}).

Назначение: НЕ читать сырые 37k-токенов в контекст агента, а извлечь:
  1. Список секций/листов (по маркерам).
  2. Только строки с ключевыми метриками 44-ФЗ (ИТОГО/план/факт/ЕП/экономия/Trust).
  3. Базовую статистику (длина, число строк, число листов).

Usage:
  python scripts/drive_sheet_digest.py <dump.txt> [--metrics-only] [--sheets-only] [--max N]

Reusable субагентами: после read_file_content(fileId) → берёшь путь из ответа →
python scripts/drive_sheet_digest.py <path>.
"""
import sys, json, re
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

if len(sys.argv) < 2:
    print("usage: drive_sheet_digest.py <dump.txt> [--metrics-only|--sheets-only] [--max N]")
    sys.exit(1)

path = Path(sys.argv[1])
metrics_only = '--metrics-only' in sys.argv
sheets_only = '--sheets-only' in sys.argv
max_lines = 80
if '--max' in sys.argv:
    try: max_lines = int(sys.argv[sys.argv.index('--max')+1])
    except: pass

raw = path.read_text(encoding='utf-8', errors='replace')
# Try JSON parse; fallback to raw text
try:
    data = json.loads(raw)
    text = data.get('fileContent', raw) if isinstance(data, dict) else raw
except Exception:
    text = raw

lines = text.split('\n')
print(f"=== DIGEST {path.name} ===")
print(f"chars={len(text)} lines={len(lines)}")

# Sheet/section markers — Google export typically prints a sheet title line,
# often ALLCAPS or followed by colon, or a 'Sheet:'/'Лист' token.
sheet_re = re.compile(r'(?:^|\b)(?:Sheet|Лист|Tab|Таблица)\b', re.I)
# Heuristic: short line (<60 chars), mostly cyrillic/latin caps, no digits-heavy
section_candidates = []
for i, ln in enumerate(lines):
    s = ln.strip()
    if not s:
        continue
    if sheet_re.search(s):
        section_candidates.append((i, s[:80]))
    # ALLCAPS-ish short header
    elif len(s) < 50 and s == s.upper() and re.search(r'[А-ЯA-Z]', s) and not re.search(r'\d{3,}', s):
        section_candidates.append((i, s[:80]))

if not sheets_only:
    print(f"\n--- SECTION/SHEET MARKERS ({len(section_candidates)}) ---")
    for i, s in section_candidates[:60]:
        print(f"  L{i}: {s}")

if sheets_only:
    sys.exit(0)

# Key metric lines
metric_re = re.compile(
    r'ИТОГО|ВСЕГО|план|факт|эконом|\bЕП\b|\bЕД\b|доля|Trust|траст|довер|'
    r'СГОЗ|НМЦ|снято|резерв|исполн|закуп|контракт|процедур|млн|тыс\.?руб|₽',
    re.I)
metric_lines = [(i, ln.strip()) for i, ln in enumerate(lines) if metric_re.search(ln) and ln.strip()]
print(f"\n--- METRIC LINES ({len(metric_lines)}, showing ≤{max_lines}) ---")
for i, ln in metric_lines[:max_lines]:
    print(f"  L{i}: {ln[:160]}")

if not metrics_only and not metric_lines:
    print("\n--- HEAD (no metric lines matched, showing first 40) ---")
    for i, ln in enumerate(lines[:40]):
        if ln.strip():
            print(f"  L{i}: {ln.strip()[:160]}")
