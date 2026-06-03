"""
xlsx_metadata_map.py — вытаскивает из xlsx слой МЕТАДАННЫХ, который не виден
в значениях ячеек: data validation (выпадающие списки / допустимые значения),
условное форматирование, защита листа, именованные диапазоны.

Зачем: «проверки/защиты/условное форматирование» в Google Sheets частично
переживают экспорт в xlsx. Data validation на столбце «Способ закупки» —
это и есть список допустимых вариантов (ответ на загадку валидатора УИО).
Кастомные счётчики («Неверный способ = 49») — это Apps Script custom functions
(в xlsx видны как #NAME?), их логика в procurement_report.gs.

Usage:
  python scripts/xlsx_metadata_map.py <dir-or-file> [--out report.md] [--validations-only]

Читает все *.xlsx рекурсивно. Компактный markdown-вывод.
"""
import sys, os, glob
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
try:
    from openpyxl import load_workbook
except ImportError:
    print("need: pip install openpyxl"); sys.exit(1)

args = sys.argv[1:]
if not args:
    print("usage: xlsx_metadata_map.py <dir-or-file> [--out file] [--validations-only]"); sys.exit(1)
target = args[0]
out_path = None
if '--out' in args:
    out_path = args[args.index('--out')+1]
val_only = '--validations-only' in args

files = []
if os.path.isdir(target):
    files = sorted(glob.glob(os.path.join(target, '**', '*.xlsx'), recursive=True))
elif target.endswith('.xlsx'):
    files = [target]
print(f"[xlsx_metadata_map] {len(files)} файлов")

lines = ['# XLSX metadata map — проверки / защита / условное форматирование', '']

for f in files:
    rel = os.path.basename(f)
    lines.append(f'## {rel}')
    try:
        wb = load_workbook(f, data_only=False)
    except Exception as e:
        lines.append(f'  ОШИБКА загрузки: {e}'); continue
    # named ranges (workbook)
    try:
        dn = list(wb.defined_names.keys()) if hasattr(wb.defined_names, 'keys') else [d.name for d in wb.defined_names.definedName]
        if dn:
            lines.append(f'- именованные диапазоны ({len(dn)}): {", ".join(dn[:20])}')
    except Exception:
        pass
    for ws in wb.worksheets:
        seg = [f'### лист «{ws.title}» [{ws.dimensions}]']
        # data validations — КЛЮЧЕВОЕ (допустимые значения)
        try:
            dvs = list(ws.data_validations.dataValidation)
        except Exception:
            dvs = []
        if dvs:
            seg.append(f'  data validation ({len(dvs)}):')
            for dv in dvs[:25]:
                f1 = (dv.formula1 or '')
                f1s = str(f1)[:160].replace('\n', ' ')
                seg.append(f'    - тип={dv.type} диапазон={dv.sqref} допустимо="{f1s}" пусто={dv.allow_blank}')
        if val_only:
            if dvs:
                lines.append('\n'.join(seg))
            continue
        # conditional formatting
        try:
            cf_ranges = list(ws.conditional_formatting)
        except Exception:
            cf_ranges = []
        if cf_ranges:
            seg.append(f'  условное форматирование ({len(cf_ranges)} диапазонов):')
            for cf in cf_ranges[:15]:
                try:
                    rules = cf.rules
                    rtypes = [f'{r.type}:{(str(r.formula[0])[:40] if getattr(r,"formula",None) else r.operator or "")}' for r in rules]
                    seg.append(f'    - {cf.sqref}: {"; ".join(rtypes[:6])}')
                except Exception as e:
                    seg.append(f'    - {getattr(cf,"sqref","?")}: <{e}>')
        # protection
        try:
            if ws.protection and ws.protection.sheet:
                seg.append(f'  защита: лист защищён (sheet=True)')
        except Exception:
            pass
        if len(seg) > 1:
            lines.append('\n'.join(seg))
    lines.append('')

out_text = '\n'.join(lines)
if out_path:
    Path(out_path).write_text(out_text, encoding='utf-8')
    print(f'[OK] {out_path} ({len(out_text)} chars)')
else:
    print(out_text[:6000])
