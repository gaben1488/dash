# -*- coding: utf-8 -*-
"""
recon_census.py — перепись остатка сверки (спека §17 шаги 1-2).

ЧТЕНИЕ через API (dev-сервер на localhost:3000). Код продукта НЕ трогается.

Дёргает три сверки по годам ['2026','2025','all']:
  * GET /api/reconciliation            — сверка управлений (год, СВОД ТД-ПМ vs CalcEngine)
  * GET /api/reconciliation/monthly     — помесячная сверка (лист «СВОД с месяцами» vs CalcEngine)
  * GET /api/svod/unified               — сверка единой сетки (срез ВСЕ vs ячейки СВОД ТД-ПМ)

Собирает ВСЕ строки со статусом ≠ ok, на каждую даёт предварительную категорию
(знак / пусто в листе / округление / требует разбора) и пишет отчёт в
docs/superpowers/qa/recon-census-2026-07-13.md (UTF-8).

Соглашение о знаке: Δ = официальное − расчётное (offic − calc). API отдаёт
delta как (расч − offic); здесь Δ пересчитывается независимо из значений.

Windows-дисциплина кодировок: кириллица НЕ печатается в консоль (только UTF-8
файл). В консоль — ASCII-прогресс.
"""

import io
import os
import json
import urllib.request
import urllib.error
from collections import Counter, OrderedDict

BASE = "http://localhost:3000"
YEARS = ["2026", "2025", "all"]

# Отчёт кладём рядом с репо-корнем независимо от cwd (script в scripts/).
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
OUT_PATH = REPO_ROOT + "/docs/superpowers/qa/recon-census-2026-07-13.md"

# Порог отсева float-шума для сверки управлений (значения в тыс. ₽).
NOISE_ABS = 0.01

# Ярлыки помесячных ячеек.
MONTHLY_CELL_LABELS = {
    "compPlan": "КП план (мес)",
    "compFact": "КП факт (мес)",
    "compPlanTotal": "КП план (накопл)",
    "compFactTotal": "КП факт (накопл)",
    "epPlan": "ЕП план (мес)",
    "epFact": "ЕП факт (мес)",
    "epPlanTotal": "ЕП план (накопл)",
    "epFactTotal": "ЕП факт (накопл)",
}
MONTHLY_BASE_CELLS = list(MONTHLY_CELL_LABELS.keys())

schema_report = []  # список (endpoint, year, ok:bool, note)


def fetch(path):
    """GET → распарсенный JSON, или ('__ERROR__', сообщение)."""
    url = BASE + path
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
        return json.loads(raw)
    except urllib.error.HTTPError as e:
        return {"__ERROR__": "HTTP %s %s" % (e.code, e.reason)}
    except urllib.error.URLError as e:
        return {"__ERROR__": "URL error: %s" % (e.reason,)}
    except json.JSONDecodeError as e:
        return {"__ERROR__": "JSON decode error: %s" % (e,)}
    except Exception as e:  # noqa: BLE001
        return {"__ERROR__": "unexpected: %s" % (e,)}


def year_query(year):
    return "?year=" + year


def num(x):
    """Приводит к float или None."""
    if x is None:
        return None
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    return None


def compute_delta_pct(official, calc):
    """Δ = offic − calc; Δ% = Δ / offic * 100 (None если offic пусто/0)."""
    if official is None or calc is None:
        return None, None
    delta = official - calc
    if official == 0:
        return delta, None
    return delta, (delta / official) * 100.0


def categorize(official, calc, delta_pct):
    """
    Предварительная категория расхождения (спека §17):
      знак           — оба значения ненулевые, знаки противоположны, |величины| близки;
      пусто в листе  — официальное 0/пусто/None (в листе нет значения);
      округление     — |Δ%| < 1%;
      требует разбора— остальное.
    """
    o = official
    c = calc
    # знак: расч ≈ −offic (та же величина, обратный знак)
    if o is not None and c is not None and o != 0 and c != 0 and ((o > 0) != (c > 0)):
        rel = abs(abs(c) - abs(o)) / max(abs(o), 1e-9)
        if rel < 0.01:
            return "знак"
    # пусто в листе
    if o is None or o == 0:
        return "пусто в листе"
    # округление
    if delta_pct is not None and abs(delta_pct) < 1.0:
        return "округление"
    return "требует разбора"


def add_discrepancy(rows, sverka, year, grbs, metric, official, calc):
    delta, delta_pct = compute_delta_pct(official, calc)
    cat = categorize(official, calc, delta_pct)
    rows.append(
        OrderedDict(
            sverka=sverka,
            year=year,
            grbs=grbs,
            metric=metric,
            official=official,
            calc=calc,
            delta=delta,
            delta_pct=delta_pct,
            category=cat,
        )
    )


# ── Сборщики по каждому типу сверки ─────────────────────────────────

def collect_reconciliation(data, year, rows):
    """Сверка управлений: /api/reconciliation."""
    ep = "reconciliation"
    if not isinstance(data, dict) or "__ERROR__" in data:
        schema_report.append((ep, year, False, str(data.get("__ERROR__") if isinstance(data, dict) else data)))
        return False
    recon = data.get("reconciliation")
    if not isinstance(recon, dict) or not isinstance(recon.get("rows"), list):
        schema_report.append((ep, year, False, "нет reconciliation.rows"))
        return False
    sample = recon["rows"][0] if recon["rows"] else None
    if sample is not None and not (
        "department" in sample and "assessment" in sample and isinstance(sample.get("assessment"), dict)
    ):
        schema_report.append((ep, year, False, "строка без department/assessment"))
        return False
    schema_report.append((ep, year, True, "rows=%d, counts=%s" % (len(recon["rows"]), recon.get("counts"))))

    triples = [
        ("план (год)", "fullPlanOfficial", "fullPlanCalculated"),
        ("факт (год)", "fullFactOfficial", "fullFactCalculated"),
        ("экономия (год)", "ecoTotalOfficial", "ecoTotalCalculated"),
    ]
    for row in recon["rows"]:
        assessment = row.get("assessment") or {}
        kind = assessment.get("kind")
        if kind == "ok":
            continue  # согласовано
        dept = row.get("department", "?")
        emitted = 0
        for label, off_key, calc_key in triples:
            off = num(row.get(off_key))
            cal = num(row.get(calc_key))
            if off is None and cal is None:
                continue
            delta = (off or 0.0) - (cal or 0.0)
            if abs(delta) < NOISE_ABS:
                continue
            add_discrepancy(rows, "recon", year, dept, label, off, cal)
            emitted += 1
        if emitted == 0:
            # флаг стоит, но подметрики — шум: фиксируем строку как агрегат
            add_discrepancy(
                rows, "recon", year, dept,
                "строка (агрегат: %s)" % assessment.get("status", ""),
                num(row.get("fullPlanOfficial")), num(row.get("fullPlanCalculated")),
            )
    return True


def _monthly_cells(row):
    """[(label, cell)] для одной помесячной строки."""
    out = []
    for k in MONTHLY_BASE_CELLS:
        c = row.get(k)
        if isinstance(c, dict):
            out.append((MONTHLY_CELL_LABELS[k], c))
    for bk, prefix in (("compBudget", "КП"), ("epBudget", "ЕП")):
        b = row.get(bk)
        if isinstance(b, dict):
            for kk, vv in b.items():
                if isinstance(vv, dict):
                    out.append(("%s %s" % (prefix, kk), vv))
    return out


def collect_monthly(data, year, rows):
    """Помесячная сверка: /api/reconciliation/monthly."""
    ep = "monthly"
    if not isinstance(data, dict) or "__ERROR__" in data:
        schema_report.append((ep, year, False, str(data.get("__ERROR__") if isinstance(data, dict) else data)))
        return False
    if not isinstance(data.get("rows"), list) or not isinstance(data.get("counts"), dict):
        schema_report.append((ep, year, False, "нет rows/counts"))
        return False
    if not data["rows"]:
        note = "нет строк (%s)" % (data.get("overallStatus") or data.get("warning") or "пусто")
        schema_report.append((ep, year, True, note))
        return True
    sample = data["rows"][0]
    if not ("deptName" in sample and "month" in sample):
        schema_report.append((ep, year, False, "строка без deptName/month"))
        return False
    schema_report.append((ep, year, True, "rows=%d, counts=%s" % (len(data["rows"]), data.get("counts"))))

    for row in data["rows"]:
        dept = row.get("deptName") or row.get("deptId") or "?"
        month = row.get("month")
        for label, cell in _monthly_cells(row):
            status = cell.get("status")
            if status in ("ok", "empty"):
                continue  # согласовано либо обе стороны пусты
            off = num(cell.get("shdyu"))   # официальный слой = лист ШДЮ/СВОД-с-месяцами
            cal = num(cell.get("calc"))
            metric = "%s · м%s" % (label, month)
            add_discrepancy(rows, "monthly", year, dept, metric, off, cal)
    return True


def collect_svod(data, year, rows):
    """Сверка единой сетки: /api/svod/unified."""
    ep = "svod"
    if not isinstance(data, dict) or "__ERROR__" in data:
        schema_report.append((ep, year, False, str(data.get("__ERROR__") if isinstance(data, dict) else data)))
        return False
    recon = data.get("reconciliation")
    if not isinstance(recon, list):
        schema_report.append((ep, year, False, "нет reconciliation[]"))
        return False
    if recon:
        s0 = recon[0]
        if not ("key" in s0 and "calc" in s0 and "official" in s0 and "status" in s0):
            schema_report.append((ep, year, False, "строка без key/calc/official/status"))
            return False
    schema_report.append((ep, year, True, "reconciliation=%d" % len(recon)))

    for item in recon:
        if item.get("status") == "ok":
            continue
        off = num(item.get("official"))
        cal = num(item.get("calc"))
        add_discrepancy(rows, "svod", year, "ВСЕ (агрегат)", item.get("key", "?"), off, cal)
    return True


# ── Форматирование отчёта ───────────────────────────────────────────

def fmt_num(x):
    if x is None:
        return "—"
    if abs(x - round(x)) < 1e-9:
        s = "{:,.0f}".format(x)
    else:
        s = "{:,.2f}".format(x)
    return s.replace(",", " ")


def fmt_pct(x):
    if x is None:
        return "—"
    return "{:+.2f}%".format(x)


def write_report(rows):
    schema_ok = all(ok for (_, _, ok, _) in schema_report)
    by_cat = Counter(r["category"] for r in rows)
    by_grbs = Counter(r["grbs"] for r in rows)
    by_sverka = Counter(r["sverka"] for r in rows)
    by_year = Counter(r["year"] for r in rows)

    # calc==0 при непустом official — системный «расчётный слой пуст»
    calc_empty = sum(
        1 for r in rows
        if (r["calc"] in (0, 0.0)) and (r["official"] not in (None, 0, 0.0))
    )

    L = []
    L.append("# Перепись остатка сверки — 2026-07-13")
    L.append("")
    L.append("> Автогенерация: `scripts/recon_census.py` (T9, спека §17 шаги 1-2). "
             "Только чтение через API `%s`; код продукта не менялся." % BASE)
    L.append("")
    L.append("**Соглашение о знаке.** Δ = официальное − расчётное. "
             "API отдаёт delta как (расч − offic); здесь Δ пересчитан независимо из значений. "
             "Δ% = Δ / официальное · 100 (— если официальное пусто/0).")
    L.append("")
    L.append("**Категории (предварительные).** "
             "*знак* — оба значения ненулевые, знаки противоположны, |величины| близки; "
             "*пусто в листе* — официальное 0/пусто; "
             "*округление* — |Δ%| < 1%; "
             "*требует разбора* — остальное.")
    L.append("")
    L.append("**Охват.** Годы: %s. Сверки: reconciliation (управления), monthly (помесячная), "
             "svod (единая сетка, срез ВСЕ)." % ", ".join(YEARS))
    L.append("")

    # ── Самопроверка схемы
    L.append("## 0. Самопроверка схемы ответов")
    L.append("")
    L.append("| Сверка | Год | Схема | Примечание |")
    L.append("|---|---|---|---|")
    for ep, yr, ok, note in schema_report:
        L.append("| %s | %s | %s | %s |" % (ep, yr, "OK" if ok else "MISMATCH", note))
    L.append("")
    if not schema_ok:
        L.append("> **SCHEMA MISMATCH:** хотя бы один ответ пришёл не в ожидаемой форме — "
                 "см. строки MISMATCH выше. Перепись по этим срезам неполна.")
        L.append("")

    # ── Итог
    L.append("## Итог")
    L.append("")
    L.append("**%d расхождений всего** (строк со статусом ≠ ok по всем сверкам и годам)." % len(rows))
    L.append("")
    if calc_empty:
        L.append("> Системная нота: у %d из %d расхождений расчётное значение = 0 при непустом "
                 "официальном. Это признак того, что расчётный слой (снапшот CalcEngine) не "
                 "содержит данных за соответствующий год/срез, а не поячеечная ошибка. "
                 "Такие строки попадают в категорию «требует разбора» и доминируют в срезе 2025." %
                 (calc_empty, len(rows)))
        L.append("")

    # ── Счётчики
    L.append("## 2. Счётчики по категориям")
    L.append("")
    L.append("| Категория | Кол-во |")
    L.append("|---|---:|")
    for cat, cnt in by_cat.most_common():
        L.append("| %s | %d |" % (cat, cnt))
    L.append("| **Итого** | **%d** |" % len(rows))
    L.append("")

    L.append("## 3. Счётчики по ГРБС")
    L.append("")
    L.append("| ГРБС | Кол-во |")
    L.append("|---|---:|")
    for grbs, cnt in by_grbs.most_common():
        L.append("| %s | %d |" % (grbs, cnt))
    L.append("")

    L.append("## 4. Счётчики по типу сверки")
    L.append("")
    L.append("| Сверка | Кол-во |")
    L.append("|---|---:|")
    for sv, cnt in by_sverka.most_common():
        L.append("| %s | %d |" % (sv, cnt))
    L.append("")
    L.append("Дополнительно — по годам:")
    L.append("")
    L.append("| Год | Кол-во |")
    L.append("|---|---:|")
    for yr in YEARS:
        L.append("| %s | %d |" % (yr, by_year.get(yr, 0)))
    L.append("")

    # ── Сводная таблица всех расхождений (сорт: год, сверка, |Δ| убыв)
    L.append("## 1. Сводная таблица всех расхождений")
    L.append("")
    if not rows:
        L.append("_Расхождений не обнаружено: все сверки за все годы согласованы (статус ok)._")
    else:
        order_year = {y: i for i, y in enumerate(YEARS)}
        order_sv = {"recon": 0, "monthly": 1, "svod": 2}

        def sort_key(r):
            d = r["delta"]
            return (
                order_year.get(r["year"], 99),
                order_sv.get(r["sverka"], 99),
                -(abs(d) if d is not None else 0.0),
            )

        srows = sorted(rows, key=sort_key)
        L.append("| # | Сверка | Год | ГРБС | Метрика/ячейка | Официальное | Расчётное | Δ (offic−расч) | Δ% | Категория |")
        L.append("|---:|---|---|---|---|---:|---:|---:|---:|---|")
        for i, r in enumerate(srows, 1):
            L.append("| %d | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
                i, r["sverka"], r["year"], r["grbs"], r["metric"],
                fmt_num(r["official"]), fmt_num(r["calc"]), fmt_num(r["delta"]),
                fmt_pct(r["delta_pct"]), r["category"],
            ))
    L.append("")

    with io.open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(L))
        f.write("\n")


# ── main ────────────────────────────────────────────────────────────

def main():
    rows = []
    for year in YEARS:
        print("fetching year=%s ..." % year)
        q = year_query(year)
        collect_reconciliation(fetch("/api/reconciliation" + q), year, rows)
        collect_monthly(fetch("/api/reconciliation/monthly" + q), year, rows)
        collect_svod(fetch("/api/svod/unified" + q), year, rows)
        print("  year=%s done, running total discrepancies=%d" % (year, len(rows)))

    schema_ok = all(ok for (_, _, ok, _) in schema_report)
    if not schema_ok:
        print("SCHEMA MISMATCH")  # ASCII, без кириллицы

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    write_report(rows)
    print("census done: %d discrepancies -> %s" % (len(rows), OUT_PATH))


if __name__ == "__main__":
    main()
