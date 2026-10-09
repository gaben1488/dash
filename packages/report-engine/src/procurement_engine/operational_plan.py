"""Evidence-bound operational briefing following the 02.10.2026 DE memo.

The approved reference supplies the editorial order, not a source of current
values. All figures, procedures and comments are projected from the same
verified ReportModel and the frozen working-procedure registry.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from decimal import Decimal

from .document_plan import (
    GRAY, ORANGE, DocumentPlan, _add_weekly_review, _budget_text,
    _internal_annotation, _money, _paragraph, _pct, _position_word, section_rule,
)
from .normalize import parse_date
from .operational_casework import (
    build_case_index, describe_linked_procedure,
    procedure_candidate_sentence, unlinked_procedure_candidates,
)
from .renderer_guard import assert_renderer_inputs


def _focus_quarter(model):
    """The October reference still focuses on the just-closed third quarter."""
    day = date.fromisoformat(parse_date(model["snapshot"]["report_date"]))
    current = int(model["headline"]["current_quarter"])
    if (current > 1 and day.month in {4, 7, 10} and day.day <= 14
            and current == (day.month - 1) // 3 + 1):
        return current - 1
    return current


def _roman(quarter):
    return ("I", "II", "III", "IV")[quarter - 1]


def _relevant_comment(detail):
    """Source assertion, not evidence that a contract or payment occurred."""
    for key in ("deviation_reason", "grbs_comment", "necessity_reason"):
        value = str(detail.get(key) or "").strip()
        if not value or value.casefold() in {"x", "х", "—", "-"}:
            continue
        if _internal_annotation(value) or value.lower().startswith("[сверка кодов]"):
            continue
        if len(value) > 245:
            cut = value[:245].rfind(". ")
            value = value[:cut + 1] if cut > 110 else value[:242].rstrip() + "…"
        return value
    return ""


def _money_group(rows):
    return sum((Decimal(str(r["amount_thousand_decimal"])) for r in rows), Decimal(0))


def _groups(rows):
    """Only identical names within the SAME GRBS, never speculative mergers."""
    grouped = defaultdict(list)
    for item in rows:
        subject = re.sub(r"\s+", " ", str(item["subject"]).strip())
        grouped[subject.casefold()].append(item)
    return sorted(grouped.values(), key=lambda group: (-_money_group(group), group[0]["subject"].casefold()))


def _date_ru(day):
    return ".".join(reversed(day.split("-"))) if day else "не указана"


def _budget_group(details):
    amounts = {b: sum((Decimal(str(d.get("plan_" + b) or 0)) for d in details
                       if d), Decimal(0)) for b in ("fb", "kb", "mb")}
    return " (" + "; ".join(
        f"{k} — {_money(amounts[b])} тыс. руб."
        for k, b in (("ФБ", "fb"), ("КБ", "kb"), ("МБ", "mb")) if amounts[b]
    ) + ")" if any(amounts.values()) else ""


def _compact_case(doc, grbs, group, *, source_rows, index, period):
    details = [source_rows.get(r["source_row_key"]) for r in group]
    subject = group[0]["subject"].strip()
    total = _money(_money_group(group))
    heading = (f"{grbs}: {len(group)} позиции с одинаковым предметом — {subject}"
               if len(group) > 1 else f"{grbs}: {subject}")
    dates = sorted({d["planned_date"] for d in details if d and d.get("planned_date")})
    text = f"• {heading} — {total} тыс. руб.{_budget_group(details)}."
    if dates:
        show = ", ".join(_date_ru(day) for day in dates[:3])
        text += f" Плановое заключение: {show}"
        if len(dates) > 3:
            text += " и другие даты"
        text += "."
    else:
        text += " Плановая дата заключения не указана."
    report_day = parse_date(doc.model["snapshot"]["report_date"])
    if any(d and d.get("planned_date") and d["planned_date"] < report_day for d in details):
        text += " Плановый срок прошёл; дата заключения не отражена."
    with doc.binding("DOC.OPERATIONAL_CASE", [doc.path(x) for x in group]):
        _paragraph(doc, text, size=9, first_line_mm=3, source=group[0])
        # Never combine unrelated procedure evidence merely because the subject matches.
        for item in details[:3]:
            if not item:
                continue
            summary, uncertainty = describe_linked_procedure(item, index)
            if summary:
                _paragraph(doc, "  " + summary, size=8, color=GRAY, source=item, first_line_mm=4)
            if uncertainty:
                _paragraph(doc, "  Нужно уточнить: " + uncertainty, size=8,
                           color=ORANGE, italic=True, source=item, first_line_mm=4)
        comments = list(dict.fromkeys(
            _relevant_comment(item) for item in details if item and _relevant_comment(item)))
        for note in comments[:1]:
            _paragraph(doc, "  По информации управления: " + note,
                       size=8, source=group[0], first_line_mm=4)
        if len(details) > 3:
            _paragraph(doc, "  Остальные позиции с тем же предметом показаны в основном отчёте.",
                       size=8, color=GRAY, source=group[0])


@section_rule("DOC.OPERATIONAL_QUARTER", roots=["report_content"])
def _add_quarter_overview(doc, model, quarter):
    blocks = model["report_content"]
    current = blocks["global"]["comp"][f"q{quarter}"]
    prefix = f"Исполнение по {_roman(quarter)} кварталу"
    _paragraph(doc, prefix, size=9, bold=True, keep_with_next=True)
    _paragraph(doc, f"По данным планов-реестров на дату отчёта заключение отражено "
               f"по {current['fact_count']} из {current['plan_count']} конкурентных закупок — "
               f"{_pct(current['execution_pct'])}.",
               source=current, size=9)
    _paragraph(doc, f"В остатке {_roman(quarter)} квартала — "
               f"{current['remain_count']} {_position_word(current['remain_count'])} "
               f"на {_money(current['remain_amount'])} тыс. руб. "
               f"{_budget_text(current, 'remain')}.",
               source=current, size=9, bold=bool(current["remain_count"]))
    previous = []
    for earlier in range(1, quarter):
        q = blocks["global"]["comp"][f"q{earlier}"]
        if q["plan_count"] and q["fact_count"] == q["plan_count"]:
            previous.append(f"{_roman(earlier)} — {q['fact_count']} из {q['plan_count']}")
    if previous:
        _paragraph(doc, "Полностью закрытые предыдущие кварталы: " + "; ".join(previous) + ".",
                   size=8)
    _paragraph(doc, f"Исполнение плана {_roman(quarter)} квартала по ГРБС:", size=9,
               keep_with_next=True)
    rows = []
    for grbs in model["grbs_order"]:
        q = blocks["by_grbs"][grbs]["comp"][f"q{quarter}"]
        annual = blocks["by_grbs"][grbs]["comp"]["year"]
        rows.append((grbs, q, annual))
    rows.sort(key=lambda item: (
        item[1]["plan_count"] == 0,
        (item[1]["fact_count"] / item[1]["plan_count"]) if item[1]["plan_count"] else 2,
        item[0]))
    for grbs, q, annual in rows:
        if not q["plan_count"]:
            sentence = f"{grbs} — закупок с плановым заключением в {_roman(quarter)} квартале нет."
        else:
            sentence = (f"{grbs} — {_pct(q['execution_pct'])} "
                        f"({q['fact_count']} из {q['plan_count']}, "
                        f"годовой план — {annual['plan_count']}); "
                        f"остаток — {q['remain_count']}.")
        _paragraph(doc, sentence, size=9, sources=(q, annual))


def _all_remainders(model, period, quarter):
    source = model["report_content"]["remaining"]
    result = []
    for grbs in model["grbs_order"]:
        for row in source[grbs]["comp"][f"q{quarter}" if period == "quarter" else "year"]:
            result.append((grbs, row))
    return result


@section_rule("DOC.OPERATIONAL_QUARTER_CASES", roots=["report_content", "details", "operational_procedure_evidence"])
def _add_quarter_cases(doc, model, quarter, index):
    _paragraph(doc, f"Остаток {_roman(quarter)} квартала", bold=True, size=9, keep_with_next=True)
    rows = _all_remainders(model, "quarter", quarter)
    if not rows:
        _paragraph(doc, "Незакрытых плановых позиций не отражено.", size=9)
        return
    by_grbs = defaultdict(list)
    for grbs, item in rows:
        by_grbs[grbs].append(item)
    cases = [(grbs, group) for grbs, items in by_grbs.items() for group in _groups(items)]
    cases.sort(key=lambda x: (-_money_group(x[1]), x[0], x[1][0]["subject"]))
    source_rows = {row["physical_row_key"]: row for row in model.get("details", [])}
    for grbs, group in cases[:12]:
        _compact_case(doc, grbs, group, source_rows=source_rows, index=index, period="quarter")
    if len(cases) > 12:
        _paragraph(doc, f"Ещё {len(cases)-12} групп незакрытых позиций "
                   "приведены в основном отчёте; из суммы выше они не исключены.",
                   size=8, color=GRAY)


@section_rule("DOC.OPERATIONAL_ANNUAL", roots=["report_content"])
def _add_annual_overview(doc, model):
    c = model["report_content"]
    year = c["global"]["comp"]["year"]
    _paragraph(doc, "Годовое исполнение и остатки", bold=True, size=9, keep_with_next=True)
    _paragraph(doc, f"По конкурентным закупкам с плановым заключением в "
               f"{model['snapshot']['report_year']} году: {year['fact_count']} из "
               f"{year['plan_count']} — {_pct(year['execution_pct'])}. "
               f"Остаток — {year['remain_count']} на {_money(year['remain_amount'])} тыс. руб. "
               f"{_budget_text(year, 'remain')}.",
               size=9, source=year)


@section_rule("DOC.OPERATIONAL_ANNUAL_CASES", roots=["report_content", "details", "operational_procedure_evidence"])
def _add_annual_cases(doc, model, index):
    source = model["report_content"]
    details = {row["physical_row_key"]: row for row in model.get("details", [])}
    grbs_metrics = [(grbs, source["by_grbs"][grbs]["comp"]["year"])
                    for grbs in model["grbs_order"]]
    grbs_metrics.sort(key=lambda x: (
        x[1]["remain_count"] == 0,
        (x[1]["fact_count"] / x[1]["plan_count"]) if x[1]["plan_count"] else 2, x[0]))
    used_groups = 0
    omitted_groups = 0
    for grbs, summary in grbs_metrics:
        total = summary["plan_count"]
        if total:
            label = (f"{grbs} — {_pct(summary['execution_pct'])} "
                     f"({summary['fact_count']} из {total}; остаток {summary['remain_count']}).")
        else:
            label = f"{grbs} — конкурентных позиций в годовом плане нет."
        _paragraph(doc, label, size=9, bold=True, source=summary, keep_with_next=bool(summary["remain_count"]))
        rows = source["remaining"][grbs]["comp"]["year"]
        groups = _groups(rows)
        # Two largest examples per administration, then optional third when
        # needed for traceable significant purchases, bounded as a short memo.
        size = min(len(groups), 3 if len(groups) <= 3 else 2)
        if used_groups + size > 20:
            size = max(0, 20 - used_groups)
        for group in groups[:size]:
            _compact_case(doc, grbs, group, source_rows=details, index=index, period="year")
        used_groups += size
        if len(groups) > size:
            omitted_groups += len(groups) - size
            if size:
                _paragraph(doc, f"Остальные {len(groups)-size} групп позиций {grbs} "
                           "приведены в основном отчёте.", size=8, source=summary, color=GRAY)
    if omitted_groups:
        _paragraph(doc, "Сведения по всем незакрытым позициям учтены в годовых итогах; "
                   "полный перечень приведён в основном отчёте.", size=8, color=GRAY)


@section_rule("DOC.OPERATIONAL_UNLINKED", roots=["operational_procedure_evidence", "details"])
def _add_unlinked_procedures(doc, model, index):
    _paragraph(doc, "Процедуры, требующие отдельной сверки с планами",
               bold=True, size=9, keep_with_next=True)
    cases, omitted = unlinked_procedure_candidates(index, year=model["snapshot"]["report_year"], limit=5)
    if not cases:
        _paragraph(doc, "Среди действующих процедур не выявлено новых случаев без "
                   "указанного в планах точного кода. Это не доказывает полноту "
                   "всех исторических связей.", size=8)
        return
    for item in cases:
        _paragraph(doc, "• " + procedure_candidate_sentence(item), size=9, source=item, first_line_mm=3)
    if omitted:
        _paragraph(doc, f"Ещё {omitted} процедур с неподтверждёнными кодовыми связями "
                   "доступны в рабочем реестре. Отсутствие ссылки не означает отсутствия плана.",
                   size=8, color=ORANGE)


@section_rule("DOC.OPERATIONAL_ECONOMY", roots=["snapshot"])
def _add_economy(doc, model):
    _paragraph(doc, "Экономия — оперативный лист", size=9, bold=True, keep_with_next=True)
    _paragraph(doc, "Требует уточнения: подтверждённые свободные остатки средств "
               "из оперативного листа «Экономия» не включены в этот выпуск. "
               "Сумма в этом разделе не подставляется из расчётной экономии торгов.",
               size=9, color=ORANGE, italic=True)


@section_rule("DOC.OPERATIONAL_ACTIONS", roots=["report_content", "operational_procedure_evidence"])
def _add_actions(doc, model, quarter, index):
    _paragraph(doc, "Важное!", size=9, bold=True, keep_with_next=True)
    q = model["report_content"]["global"]["comp"][f"q{quarter}"]
    if q["remain_count"]:
        _paragraph(doc, f"По {q['remain_count']} незакрытым позициям "
                   f"{_roman(quarter)} квартала следует проверить дату заключения "
                   "в планах-реестрах. Завершение торгов само по себе не подтверждает заключение контракта.",
                   size=9, source=q)
    else:
        _paragraph(doc, f"По всем позициям {_roman(quarter)} квартала в планах указаны "
                   "даты заключения. Это не является подтверждением исполнения или оплаты.",
                   size=9, source=q)
    pending, omitted = unlinked_procedure_candidates(index, year=model["snapshot"]["report_year"])
    if pending or omitted:
        _paragraph(doc, "По процедурам без подтверждённой кодовой связи необходимо "
                   "уточнить соответствующие плановые строки. Повторные и переоформленные "
                   "процедуры нельзя автоматически считать новыми потребностями.",
                   size=9, source=model["operational_procedure_evidence"])


@section_rule("DOC.OPERATIONAL_EP", roots=["report_content"])
def _add_ep(doc, model):
    ep = model["report_content"]["global"]["ep"]["year"]
    _paragraph(doc, "Справочно. Единственный поставщик",
               bold=True, size=9, keep_with_next=True)
    _paragraph(doc, f"На {model['snapshot']['report_year']} год в плане — "
               f"{ep['plan_count']} {_position_word(ep['plan_count'])} "
               f"на {_money(ep['plan_amount'])} тыс. руб. {_budget_text(ep, 'plan')}. "
               f"Дата заключения отражена по {ep['fact_count']} на "
               f"{_money(ep['fact_amount'])} тыс. руб. {_budget_text(ep, 'fact')}. "
               f"Исполнение по количеству — {_pct(ep['execution_pct'])}; "
               f"остаток — {ep['remain_count']} {_position_word(ep['remain_count'])}.",
               size=9, source=ep)


def build_operational_plan(report_model: dict):
    assert_renderer_inputs(report_model=report_model)
    contracts = report_model.get("contract") or {}
    if contracts.get("operational_document_contract") != "operational-report-v1":
        raise ValueError("OPERATIONAL_DOCUMENT_CONTRACT_MISSING")
    if contracts.get("operational_procedure_contract") != "operational-procedure-evidence-v1":
        raise ValueError("OPERATIONAL_PROCEDURE_CONTRACT_MISSING")
    doc = DocumentPlan(report_model, "operational", "RECORDED_EXECUTIVE")
    model = doc.model
    day = parse_date(model["snapshot"]["report_date"])
    when = _date_ru(day)
    quarter = _focus_quarter(model)
    index = build_case_index(model["operational_procedure_evidence"], model.get("details", []),
                             year=model["snapshot"]["report_year"])
    _paragraph(doc, "К комиссии по МП для Дмитрия Евгеньевича", size=9, italic=True)
    _paragraph(doc, f"Оперативный отчёт. По состоянию на {when}.", size=9, italic=True)
    if quarter != model["headline"]["current_quarter"]:
        _paragraph(doc, f"Контроль итогов завершённого {_roman(quarter)} квартала. "
                   "Показатели следующего квартала приведены в основном отчёте.",
                   size=8, color=GRAY, italic=True)
    _add_quarter_overview(doc, model, quarter)
    _add_quarter_cases(doc, model, quarter, index)
    _add_annual_overview(doc, model)
    _add_annual_cases(doc, model, index)
    _add_unlinked_procedures(doc, model, index)
    _add_economy(doc, model)
    _add_actions(doc, model, quarter, index)
    _add_weekly_review(doc, model, detailed=False)
    _add_ep(doc, model)
    return doc.export()
