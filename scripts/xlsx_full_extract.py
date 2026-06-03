"""
xlsx_full_extract.py — извлекает КАЖДУЮ ячейку с данными (не только формулы)
из xlsx + строит профиль каждого столбца (что реально лежит в колонке).

Цель: полное понимание «как таблица работает и какие данные даёт» — каждая
ячейка захвачена (CSV-дамп), каждый столбец проинтерпретирован (header, тип,
заполненность, распределение значений, примеры).

Раскладка dept-листов (из Candy33 GAS): строка 1 = заголовок, 2 = секции,
3 = названия столбцов, данные с 4. 33 столбца A..AG.

Usage:
  python scripts/xlsx_full_extract.py <dir-or-file> --csv-dir <dir> --out <profiles.md> [--data-start 4]
"""
import sys, os, glob, csv
from pathlib import Path
from collections import Counter

sys.stdout.reconfigure(encoding='utf-8')
from openpyxl import load_workbook

args = sys.argv[1:]
if not args:
    print("usage: xlsx_full_extract.py <dir|file> --csv-dir <d> --out <md> [--data-start N]"); sys.exit(1)
target = args[0]
csv_dir = args[args.index('--csv-dir')+1] if '--csv-dir' in args else None
out_md = args[args.index('--out')+1] if '--out' in args else None
data_start = int(args[args.index('--data-start')+1]) if '--data-start' in args else 4
if csv_dir: os.makedirs(csv_dir, exist_ok=True)

files = sorted(glob.glob(os.path.join(target, '**', '*.xlsx'), recursive=True)) if os.path.isdir(target) else [target]
print(f"[full_extract] {len(files)} файлов, data_start={data_start}")

def col_letter(n):
    s=''
    while n>0:
        n,r=divmod(n-1,26); s=chr(65+r)+s
    return s

prof = ['# XLSX full data extract — профиль каждого столбца', '']
for f in files:
    name = os.path.splitext(os.path.basename(f))[0]
    prof.append(f'## {name}.xlsx')
    try:
        wb = load_workbook(f, data_only=True, read_only=True)
    except Exception as e:
        prof.append(f'  ОШИБКА: {e}'); continue
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        nrows = len(rows)
        ncols = max((len(r) for r in rows), default=0)
        # CSV dump каждой ячейки
        if csv_dir:
            safe = f"{name}__{ws.title}".replace('/', '_').replace('\\', '_')[:120]
            try:
                with open(os.path.join(csv_dir, safe+'.csv'), 'w', newline='', encoding='utf-8') as cf:
                    w = csv.writer(cf)
                    for r in rows: w.writerow(['' if v is None else v for v in r])
            except Exception as e:
                prof.append(f'  [csv fail {ws.title}: {e}]')
        # header row 3 (index data_start-2) для основных листов, иначе первая непустая
        hdr_idx = data_start-2 if nrows >= data_start-1 else 0
        header = rows[hdr_idx] if hdr_idx < nrows else ()
        data = rows[data_start-1:] if nrows >= data_start else []
        nonempty_rows = sum(1 for r in data if any(v not in (None, '') for v in r))
        prof.append(f'### лист «{ws.title}» — {nrows} строк × {ncols} столбцов, данных-строк≈{nonempty_rows}')
        # профиль до 40 столбцов
        for ci in range(min(ncols, 40)):
            vals = [r[ci] for r in data if ci < len(r) and r[ci] not in (None, '')]
            if not vals: continue
            h = header[ci] if ci < len(header) and header[ci] not in (None,'') else '—'
            cnt = Counter(str(v)[:40] for v in vals)
            distinct = len(cnt)
            top = '; '.join(f'{k}×{n}' for k,n in cnt.most_common(5))
            numeric = sum(1 for v in vals if isinstance(v,(int,float)))
            kind = 'число' if numeric > len(vals)*0.7 else ('текст' if numeric==0 else 'смеш')
            prof.append(f'- [{col_letter(ci+1)}] «{str(h)[:45]}»: запол={len(vals)} уник={distinct} тип={kind} | топ: {top[:160]}')
        prof.append('')
    try: wb.close()
    except Exception: pass

text = '\n'.join(prof)
if out_md:
    Path(out_md).write_text(text, encoding='utf-8')
    print(f'[OK] {out_md} ({len(text)} chars)' + (f', csv → {csv_dir}' if csv_dir else ''))
else:
    print(text[:6000])
