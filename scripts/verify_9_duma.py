"""Verify 9th ГРБС «Дума» в Отчет на 01.03.2026.xlsb.

Цель: определить содержит ли лист '9 Дума' реальные plan-graph atoms
(закупки с dept × sub × method × activity × budget × period), или только
бумажная отчётность без закупочных процедур.

Из NOW.md:
> Отчет на 01.03.2026.xlsb — 15 листов, 9 ГРБС с Думой как 9-м.
> Наш GRBS_REGISTRY имеет только 8. Требуется верификация: читает ли
> лист '9 Дума' реальные plan-graph atoms или это только бумажная
> отчётность без закупок.

Output: JSON отчёт в reports/9_duma_verification.json с метриками
non-empty rows, unique subjects, методы, суммы — чтобы принять решение
о расширении GRBS_REGISTRY с 8 до 9.

Hardware-aware: one-pass чтение (не грузит модель эмбеддингов,
CPU-friendly).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from pyxlsb import open_workbook
except ImportError:
    print("ERROR: pip install pyxlsb", file=sys.stderr)
    sys.exit(2)

XLSB_PATH = Path(r"C:/Users/filat/Documents/Отчет на 01.03.2026.xlsb")
REPORT_PATH = Path(r"C:/Users/filat/dash/reports/9_duma_verification.json")
SHEET_NAME = "9 Дума"

# 33 колонки dept-листа A..AG (из data/spreadsheet-anatomy.md §I)
EXPECTED_COLUMN_HEADERS = [
    "№ п/п", "Наименование управления", "Наименование подведомственного учреждения",
    "Наименование программы", "Пункт и наименование подпрограммы",
    "Программное мероприятие/текущая деятельность",
    "Наименование мероприятия/предмета контракта",
    "ФБ 1", "КБ 1", "МБ 1", "ИТОГО 1",
    "Способ определения поставщика (ЭА/ЕП)", "Причина выбора способа",
    "Планируемый (дата)", "Квартал (план)", "Год (план)",
    "Фактический (дата / Х)", "Квартал (факт)", "Год (факт)",
    "Отклонение, дни", "Причина отклонения",
    "ФБ 2", "КБ 2", "МБ 2", "ИТОГО 2",
    "ФБ 3", "КБ 3", "МБ 3", "ИТОГО 3",
    "Учитывать в расчете экономии да/нет",
    "Комментарий ГРБСа", "Комментарий УЭР АЕМР", "Комментарий УФБП АЕМР",
]


def verify():
    sys.stdout.reconfigure(encoding="utf-8")

    if not XLSB_PATH.exists():
        print(f"ERROR: {XLSB_PATH} not found", file=sys.stderr)
        sys.exit(1)

    print(f"[verify] open {XLSB_PATH.name}")
    with open_workbook(str(XLSB_PATH)) as wb:
        sheet_names = wb.sheets
        print(f"[verify] sheets: {sheet_names}")

        if SHEET_NAME not in sheet_names:
            print(f"ERROR: sheet '{SHEET_NAME}' not found. Available: {sheet_names}", file=sys.stderr)
            sys.exit(1)

        with wb.get_sheet(SHEET_NAME) as sheet:
            rows = []
            for row in sheet.rows():
                rows.append([cell.v for cell in row])

    total_rows = len(rows)
    print(f"[verify] total rows: {total_rows}")

    if total_rows < 4:
        print("[verify] sheet пуст или только шапка — не-plan-graph")
        report = {"sheet": SHEET_NAME, "verdict": "empty", "total_rows": total_rows}
        REPORT_PATH.parent.mkdir(exist_ok=True)
        REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    # Header на 3 строке (index 2), данные с 4 (index 3)
    header = rows[2] if total_rows > 2 else []
    data_rows = rows[3:] if total_rows > 3 else []

    print(f"[verify] header ({len(header)} cols): {header[:5]}...")

    # Фильтруем пустые строки (где колонка A = № п/п пустая или None)
    non_empty = [r for r in data_rows if r and r[0] is not None and str(r[0]).strip()]
    print(f"[verify] non-empty data rows: {len(non_empty)}")

    if len(non_empty) == 0:
        verdict = "empty"
    elif len(non_empty) < 10:
        verdict = "sparse"  # 1-9 строк — возможно бумажная отчётность
    else:
        verdict = "has_data"

    # Метрики — только если есть данные
    unique_subjects = set()
    method_counts = {"ЭА": 0, "ЕП": 0, "ЭЗК": 0, "ЭК": 0, "other": 0, "empty": 0}
    activity_counts = {"Программное мероприятие": 0, "Текущая деятельность": 0, "other": 0}
    plan_sum = 0.0
    fact_sum = 0.0
    rows_with_fact = 0

    # Индексы колонок: G=6 (subject), L=11 (method), F=5 (activity),
    # K=10 (plan total), Y=24 (fact total), Q=16 (fact date)
    for r in non_empty:
        if len(r) > 6 and r[6]:
            unique_subjects.add(str(r[6])[:80])

        method = str(r[11]).strip() if len(r) > 11 and r[11] else ""
        if method in method_counts:
            method_counts[method] += 1
        elif method:
            method_counts["other"] += 1
        else:
            method_counts["empty"] += 1

        activity = str(r[5]).strip() if len(r) > 5 and r[5] else ""
        if activity in activity_counts:
            activity_counts[activity] += 1
        elif activity:
            activity_counts["other"] += 1

        try:
            plan_val = float(r[10]) if len(r) > 10 and r[10] else 0
            plan_sum += plan_val
        except (ValueError, TypeError):
            pass
        try:
            fact_val = float(r[24]) if len(r) > 24 and r[24] else 0
            fact_sum += fact_val
            if fact_val > 0:
                rows_with_fact += 1
        except (ValueError, TypeError):
            pass

    report = {
        "sheet": SHEET_NAME,
        "verdict": verdict,
        "total_rows_in_sheet": total_rows,
        "non_empty_data_rows": len(non_empty),
        "unique_subjects_sample": len(unique_subjects),
        "subjects_preview": list(unique_subjects)[:10],
        "method_counts": method_counts,
        "activity_counts": activity_counts,
        "plan_total_rubles": plan_sum,
        "fact_total_rubles": fact_sum,
        "rows_with_fact": rows_with_fact,
        "header_columns_count": len(header),
        "header_sample": [str(h) for h in header[:12]] if header else [],
        "recommendation": {
            "empty": "НЕ расширять GRBS_REGISTRY — Дума в xlsb = только бумажная форма без закупок.",
            "sparse": "Ручная проверка (1-9 строк): посмотреть preview subjects. Если реальные закупки — расширить до 9 с оговоркой низкого volume.",
            "has_data": "РАСШИРИТЬ GRBS_REGISTRY 8→9. Добавить Дума в grbs-registry.ts с правильным alias + обновить BASELINES + parity test.",
        }.get(verdict, ""),
    }

    REPORT_PATH.parent.mkdir(exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[verify] wrote {REPORT_PATH}")
    print()
    print(f"=== VERDICT: {verdict} ===")
    print(f"non-empty rows: {len(non_empty)}")
    print(f"unique subjects: {len(unique_subjects)}")
    print(f"methods: {method_counts}")
    print(f"activities: {activity_counts}")
    print(f"plan total: {plan_sum:,.2f} ₽")
    print(f"fact total: {fact_sum:,.2f} ₽")
    print(f"rows with fact: {rows_with_fact}")
    print()
    print(f"RECOMMENDATION: {report['recommendation']}")


if __name__ == "__main__":
    verify()
