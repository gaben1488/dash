"""Извлечение трёх сторон тройной сверки из дампов книг (потоково, ijson).

Зачем. Тройная сверка (требование владельца 21.08.2026) сводит одну и ту же
закупку из трёх независимых записей: строки книги ГРБС, строки листа
управления книги «Ежедневный мониторинг» и строки переходящего реестра
«25-26». Считать сверку должен продуктовый код на TypeScript — тот же, что
работает в сервисе; этот скрипт только достаёт из многогигабайтных дампов
нужные листы и кладёт их компактной сеткой в один JSON.

Как пользоваться:
    python scripts/triple_check_extract.py --out grids.json

Дампы лежат в E:/aemr-dumps/book-dumps. Книга УО весит 2 ГБ, поэтому
json.load даёт MemoryError: разбор построчный, событиями ijson, в память
попадает одна ячейка за раз.

Печать в консоль — только ASCII: консоль Windows кириллицу не принимает.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from typing import Dict, List

try:
    import ijson
except ImportError:  # pragma: no cover
    print('need: pip install ijson', file=sys.stderr)
    raise SystemExit(2)

DUMPS = 'E:/aemr-dumps/book-dumps'

# Книга ГРБС -> канонический ид управления в продукте.
GRBS_BOOKS = {
    'grbs-UER.json': 'UER',
    'grbs-UKSiMP.json': 'UKSiMP',
    'grbs-UIO.json': 'UIO',
    'grbs-UAGZO.json': 'UAGZO',
    'grbs-UDTH.json': 'UDTH',
    'grbs-UD.json': 'UD',
    'grbs-UFBP.json': 'UFBP',
    'grbs-UO.json': 'UO',
}

# Служебные листы книг ГРБС: данные лежат на единственном листе управления.
GRBS_SERVICE_SHEETS = {
    '_Настройки', '_ChangeLog', 'Settings', 'GOOGLE_ФОРМУЛЫ', 'Контроль',
    'СВОД', 'Свод', '_Справочники', 'Лист1',
}

# Листы книги мониторинга, которые читает продукт.
MON_SHEETS = [
    '1. УЭР', '2. УКСиМП', '3. УИО', '4. УАГиЗО',
    '5. УДТХиРКИ', '6. УД', '7. УФБП', '8. УО',
    '25-26',
]

# Ширина среза: AH книги ГРБС — индекс 33, дальше данных сверки нет.
MAX_COLS = 34


def read_grid(path: str, wanted: set | None) -> Dict[str, List[List[object]]]:
    """Сетки листов книги: имя листа -> строки -> ячейки (formattedValue).

    Разбор событиями: сетка растёт построчно, в памяти держатся только
    выбранные листы. wanted=None означает «все листы, кроме служебных»:
    иначе журнал правок книги УО (сотни мегабайт) поедет в память заодно
    с данными. Хвостовые пустые строки отбрасываются.
    """
    grids: Dict[str, List[List[str]]] = {}
    title = ''
    keep = False
    rows: List[List[object]] = []
    row: List[object] = []
    col = -1
    # Продукт читает книги как UNFORMATTED_VALUE (см. server/src/services/
    # google-sheets.ts): число берётся полной точности, а не в том виде, в
    # каком его округлил формат ячейки. Дамп обязан отдать то же самое, иначе
    # сверка поймает не расхождение книг, а собственное округление. Поэтому
    # ниже приоритет у effectiveValue.numberValue, и только когда числа нет —
    # у formattedValue (текстовая ячейка: предмет, номер процедуры).
    numeric = False
    with open(path, 'rb') as fh:
        for prefix, event, value in ijson.parse(fh, use_float=True):
            if prefix == 'spreadsheet.sheets.item.properties.title':
                # Предыдущий лист дочитан — сохраняем.
                if keep and title:
                    grids[title] = rows
                title = str(value)
                keep = (
                    title in wanted if wanted is not None
                    else title not in GRBS_SERVICE_SHEETS and not title.startswith('_')
                )
                rows = []
            elif not keep:
                continue
            elif prefix == 'spreadsheet.sheets.item.data.item.rowData.item' and event == 'start_map':
                row = []
                col = -1
                rows.append(row)
            elif prefix == 'spreadsheet.sheets.item.data.item.rowData.item.values.item' and event == 'start_map':
                col += 1
                numeric = False
                while len(row) <= col and len(row) < MAX_COLS:
                    row.append('')
            elif prefix == 'spreadsheet.sheets.item.data.item.rowData.item.values.item.effectiveValue.numberValue':
                if 0 <= col < MAX_COLS:
                    row[col] = float(value)
                    numeric = True
            elif prefix == 'spreadsheet.sheets.item.data.item.rowData.item.values.item.formattedValue':
                if 0 <= col < MAX_COLS and not numeric:
                    row[col] = str(value)
    if keep and title:
        grids[title] = rows
    for name, grid in grids.items():
        while grid and not any(str(c).strip() for c in grid[-1]):
            grid.pop()
    return grids


def pick_data_sheet(grids: Dict[str, List[List[object]]]) -> str:
    """Единственный лист данных книги ГРБС: не служебный, самый длинный."""
    best = ''
    best_len = -1
    for name, grid in grids.items():
        if name in GRBS_SERVICE_SHEETS or name.startswith('_'):
            continue
        if len(grid) > best_len:
            best, best_len = name, len(grid)
    return best


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--dumps', default=DUMPS)
    # Снимок мониторинга берётся самый свежий: сверка обязана называть момент
    # чтения, а не молча считать по позавчерашнему файлу.
    ap.add_argument('--mon', default='monitoring-21-08.json')
    args = ap.parse_args()

    payload: Dict[str, object] = {'books': {}, 'monitoring': {}}

    mon_path = os.path.join(args.dumps, args.mon)
    print('reading monitoring...', flush=True)
    mon = read_grid(mon_path, set(MON_SHEETS))
    payload['monitoring'] = mon
    for name in MON_SHEETS:
        print('  %-14s rows=%d' % (name.encode('ascii', 'replace').decode(), len(mon.get(name, []))), flush=True)

    books: Dict[str, object] = {}
    for filename, dept in GRBS_BOOKS.items():
        path = os.path.join(args.dumps, filename)
        if not os.path.exists(path):
            print('missing: %s' % filename, flush=True)
            continue
        print('reading %s ...' % filename, flush=True)
        grids = read_grid(path, None)
        sheet = pick_data_sheet(grids)
        grid = grids.get(sheet, [])
        books[dept] = {'sheet': sheet, 'rows': grid}
        print('  dept=%s rows=%d' % (dept, len(grid)), flush=True)
    payload['books'] = books

    with io.open(args.out, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False)
    print('written: %s' % args.out, flush=True)


if __name__ == '__main__':
    main()
