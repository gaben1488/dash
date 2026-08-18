"""Сравнение двух снимков книги Google Sheets: что изменилось между ними.

Зачем. Правки в книгах делают люди — исполнители управлений и специалисты
УЭР. Чтобы разговор об этих правках был предметным («вы поправили вот эти
двенадцать ячеек, шесть замечаний закрылись, два остались»), нужен разбор
«было — стало» по ячейкам, а не ощущение.

Как пользоваться:
    python scripts/book_diff.py БЫЛО.json СТАЛО.json --out отчёт.md
    python scripts/book_diff.py БЫЛО.json СТАЛО.json --sheet "6. УД"

Снимки — это дампы `spreadsheets.get` с сеткой (тот же формат, что лежит в
E:/aemr-dumps/book-dumps). Отчёт пишется в файл в кодировке UTF-8: печатать
кириллицу в консоль Windows нельзя, консоль её не принимает.

Разбор потоковый (ijson): книги весят сотни мегабайт, целиком в память не
влезают.
"""
from __future__ import annotations

import argparse
import io
import sys
from typing import Dict, Iterator, Tuple

try:
    import ijson
except ImportError:  # pragma: no cover - подсказка вместо падения
    print('need: pip install ijson', file=sys.stderr)
    raise SystemExit(2)

Cell = Tuple[str, str]  # (значение, формула)
Sheet = Dict[str, Cell]  # адрес A1 -> ячейка


def col_letter(idx: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA."""
    out = ''
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        out = chr(65 + rem) + out
    return out


def read_book(path: str, only_sheet: str | None = None) -> Iterator[Tuple[str, Sheet]]:
    """Отдаёт пары «имя листа — карта ячеек». Пустые ячейки пропускаются."""
    with open(path, 'rb') as fh:
        for sheet in ijson.items(fh, 'spreadsheet.sheets.item'):
            title = sheet.get('properties', {}).get('title', '')
            if only_sheet and title != only_sheet:
                continue
            cells: Sheet = {}
            data = (sheet.get('data') or [{}])[0].get('rowData') or []
            for row_idx, row in enumerate(data, start=1):
                for col_idx, cell in enumerate(row.get('values') or []):
                    value = cell.get('formattedValue') or ''
                    formula = (cell.get('userEnteredValue') or {}).get('formulaValue') or ''
                    if value == '' and formula == '':
                        continue
                    cells[f'{col_letter(col_idx)}{row_idx}'] = (str(value), str(formula))
            yield title, cells


def diff_sheets(before: Sheet, after: Sheet) -> Dict[str, list]:
    """Три класса изменений: правка, заполнение пустой, очистка."""
    changed, filled, cleared = [], [], []
    for addr, (val_b, f_b) in before.items():
        if addr not in after:
            cleared.append((addr, val_b, f_b, '', ''))
            continue
        val_a, f_a = after[addr]
        if (val_b, f_b) != (val_a, f_a):
            changed.append((addr, val_b, f_b, val_a, f_a))
    for addr, (val_a, f_a) in after.items():
        if addr not in before:
            filled.append((addr, '', '', val_a, f_a))
    key = lambda item: (int(''.join(c for c in item[0] if c.isdigit()) or 0), item[0])
    return {
        'changed': sorted(changed, key=key),
        'filled': sorted(filled, key=key),
        'cleared': sorted(cleared, key=key),
    }


def formula_note(f_before: str, f_after: str) -> str:
    """Отдельно называем судьбу формулы: её потеря — отдельный класс дефекта."""
    if f_before and not f_after:
        return ' — ФОРМУЛА СТЁРТА'
    if not f_before and f_after:
        return ' — формула восстановлена'
    if f_before and f_after and f_before != f_after:
        return ' — формула изменена'
    return ''


def main() -> int:
    ap = argparse.ArgumentParser(description='Сравнение двух снимков книги.')
    ap.add_argument('before')
    ap.add_argument('after')
    ap.add_argument('--sheet', default=None, help='только один лист')
    ap.add_argument('--out', default='book-diff.md')
    ap.add_argument('--limit', type=int, default=200, help='строк на класс в отчёте')
    args = ap.parse_args()

    before_book = dict(read_book(args.before, args.sheet))
    total = {'changed': 0, 'filled': 0, 'cleared': 0, 'formulas_lost': 0}
    out = io.open(args.out, 'w', encoding='utf-8')
    out.write('# Что изменилось в книге\n\n')
    out.write(f'Было: `{args.before}`\nСтало: `{args.after}`\n\n')

    for title, after_cells in read_book(args.after, args.sheet):
        before_cells = before_book.pop(title, {})
        d = diff_sheets(before_cells, after_cells)
        if not any(d.values()):
            continue
        out.write(f'\n## Лист «{title}»\n\n')
        for kind, header in (
            ('changed', 'Изменённые ячейки'),
            ('filled', 'Заполненные (были пусты)'),
            ('cleared', 'Очищенные (были заполнены)'),
        ):
            items = d[kind]
            if not items:
                continue
            total[kind] += len(items)
            out.write(f'### {header}: {len(items)}\n\n')
            for addr, val_b, f_b, val_a, f_a in items[: args.limit]:
                note = formula_note(f_b, f_a)
                if note == ' — ФОРМУЛА СТЁРТА':
                    total['formulas_lost'] += 1
                out.write(f'- `{addr}`: «{val_b}» → «{val_a}»{note}\n')
            if len(items) > args.limit:
                out.write(f'- …и ещё {len(items) - args.limit}\n')
            out.write('\n')

    for title in before_book:
        out.write(f'\n## Лист «{title}» исчез из книги\n')

    out.write('\n## Итог\n\n')
    out.write(f'- изменено ячеек: {total["changed"]}\n')
    out.write(f'- заполнено пустых: {total["filled"]}\n')
    out.write(f'- очищено: {total["cleared"]}\n')
    if total['formulas_lost']:
        out.write(f'- **формул стёрто: {total["formulas_lost"]}** — проверить отдельно\n')
    out.close()
    print('changed', total['changed'], 'filled', total['filled'],
          'cleared', total['cleared'], 'formulas_lost', total['formulas_lost'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
