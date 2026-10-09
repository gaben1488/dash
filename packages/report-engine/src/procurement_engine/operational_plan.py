"""Short evidence-based operational briefing for the municipal programme commission.

Reference: human notes for DE, 30 September–2 October 2026.
Calculations and the current state must come exclusively from the *same* verified
ReportModel that produced both other Word documents. The source text provides
historical genre, not today's business facts or new instructions.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
import re

from .document_plan import (
    BLUE, GRAY, ORANGE, DocumentPlan, _add_weekly_review, _budget_text,
    _internal_annotation, _money, _paragraph, _pct, _position_word, section_rule,
)
from .renderer_guard import assert_renderer_inputs
from .normalize import parse_date


def _focus_quarter(model):
    """In the first two weeks of a new quarter keep the just-closed quarter visible.

    This is the recorded pattern in DE briefings from 1–2 October. Do not
    silently select a different year at the January boundary.
    """
    day = date.fromisoformat(parse_date(model["snapshot"]["report_date"]))
    current = int(model["headline"]["current_quarter"])
    if current > 1 and day.month in {4, 7, 10} and day.day <= 14:
        if current == (day.month - 1) // 3 + 1:
            return current - 1
    return current


def _relevant_comment(detail):
    """Attributed business words; never show internal QA strings as facts."""
    for key in ("deviation_reason", "grbs_comment", "necessity_reason"):
        value = str(detail.get(key) or "").strip()
        if not value or value.casefold() in {"x", "х", "—", "-"}:
            continue
        if _internal_annotation(value) or value.lower().startswith("[сверка кодов]"):
            continue
        if len(value) > 330:
            cut = value[:330].rfind(". ")
            value = value[:cut + 1] if cut > 120 else value[:327].rstrip() + "…"
        return value
    return ""


def _money_group(rows):
    return sum((Decimal(str(r["amount_thousand_decimal"])) for r in rows), Decimal(0))


def _groups(rows):
    """Group only repeated exact subjects within one GRBS; no fuzzy merging."""
    groups = defaultdict(list)
    for item in rows:
        subject = re.sub(r"\s+", " ", str(item["subject"]).strip())
        groups[subject.casefold()].append(item)
    result = sorted(groups.values(), key=lambda group: (-_money_group(group), group[0]["subject"].casefold()))
    return result


@section_rule("DOC.OPERATIONAL_REMAINDER", roots=["report_content", "details"])
def _add_remainders(doc, model, *, quarter, max_quarter_groups=16, max_year_groups=16):
    content = model["report_content"]
    source_rows = {d["physical_row_key"]: d for d in model.get("details", [])}
    day = parse_date(model["snapshot"]["report_date"])
    all_quarter = []
    all_year = []
    for grbs in model["grbs_order"]:
        for item in content["remaining"][grbs]["comp"][f"q{quarter}"]:
            all_quarter.append((grbs, item))
        for item in content["remaining"][grbs]["comp"]["year"]:
            all_year.append((grbs, item))

    def print_groups(records, *, limit, header):
        _paragraph(doc, header, color=BLUE, bold=True, keep_with_next=True)
        if not records:
            _paragraph(doc, "Незакрытых плановых позиций в выбранном периоде нет.", size=9)
            return
        by_grbs = defaultdict(list)
        for grbs, row in records:
            by_grbs[grbs].append(row)
        compiled = [
            (grbs, group) for grbs, rows in by_grbs.items() for group in _groups(rows)
        ]
        def overdue(group):
            return any((d := source_rows.get(r["source_row_key"])) and d.get("planned_date")
                       and d["planned_date"] < day for r in group)
        compiled.sort(key=lambda part: (not overdue(part[1]), -_money_group(part[1]),
                                        part[0], part[1][0]["subject"]))
        visible = compiled[:limit]
        for grbs, group in visible:
            detail_refs = [source_rows.get(r["source_row_key"]) for r in group]
            with doc.binding("DOC.OPERATIONAL_REMAINDER", [doc.path(r) for r in group]):
                total = _money(_money_group(group))
                subject = group[0]["subject"].strip()
                prefix = f"{grbs}: "
                if len(group) > 1:
                    prefix += f"{len(group)} позиции — "
                text = f"{prefix}{subject} — {total} тыс. руб."
                planned = sorted({d["planned_date"] for d in detail_refs if d and d.get("planned_date")})
                if planned:
                    dates = [x.split("-")[::-1] for x in planned]
                    label = ", ".join(".".join(p) for p in dates[:3])
                    if len(dates) > 3:
                        label += " и другие даты"
                    text += f" Плановое заключение: {label}."
                else:
                    text += " Срок заключения в плане не указан."
                if overdue(group):
                    text += " Плановый срок прошёл, дата заключения не отражена."
                _paragraph(doc, text, size=8, first_line_mm=3, source=group[0])
                # Comments are attributed, not promoted to a concluded contract.
                comments = list(dict.fromkeys(
                    _relevant_comment(d) for d in detail_refs if d and _relevant_comment(d)))
                for note in comments[:1]:
                    _paragraph(doc, "По сведениям заказчика: " + note, size=8, color=GRAY,
                               italic=True, first_line_mm=4, source=group[0])
        hidden = len(compiled) - len(visible)
        if hidden:
            _paragraph(doc, f"Ещё {hidden} групп незакрытых позиций учтены в общей сумме "
                       "и подробно перечислены в основном отчёте.", size=8, color=GRAY)

    print_groups(all_quarter, limit=max_quarter_groups,
                 header=f"Что осталось заключить по плану {quarter} квартала")
    # Most important annual positions outside the focus quarter; no double-listing.
    quarter_refs = {row["source_row_key"] for _, row in all_quarter}
    remainder = [(grbs, row) for grbs, row in all_year if row["source_row_key"] not in quarter_refs]
    print_groups(remainder, limit=max_year_groups,
                 header="Крупные незакрытые позиции остальных кварталов")
    return


@section_rule("DOC.OPERATIONAL_PROCEDURES", roots=["procedures"])
def _add_active_procedures(doc, model):
    procedures = model.get("procedures") or []
    _paragraph(doc, "Процедуры в работе", bold=True, color=BLUE, keep_with_next=True)
    if not procedures:
        _paragraph(doc, "В рабочей очереди активных процедур не отражено.", size=8)
        return
    # Only dates and stages from the procedure queue; not a contract conclusion.
    for row in procedures[:10]:
        action = row.get("action") or ""
        if _internal_annotation(action):
            action = ""
        deadline = parse_date(row.get("deadline"))
        deadline = ".".join(reversed(deadline.split("-"))) if deadline else ""
        text = f"— {row['procedure_code']}: {row['subject']}. Стадия — {row['stage']}."
        if deadline:
            text += f" Ориентир — {deadline}."
        if action:
            text += " Следующее действие: " + str(action).rstrip(".") + "."
        _paragraph(doc, text, size=8, source=row, first_line_mm=3)
    if len(procedures) > 10:
        _paragraph(doc, f"Остальные {len(procedures) - 10} процедур перечислены в рабочем реестре.",
                   size=8, color=GRAY)


@section_rule("DOC.OPERATIONAL_EXECUTIVE", roots=["report_content", "recommendations", "snapshot"])
def _add_metrics(doc, model, *, quarter):
    content = model["report_content"]
    current = content["global"]["comp"][f"q{quarter}"]
    annual = content["global"]["comp"]["year"]
    title = f"Исполнение плана конкурентных закупок за {quarter} квартал"
    _paragraph(doc, title, size=11, bold=True, color=BLUE, keep_with_next=True)
    _paragraph(doc,
               f"В плане — {current['plan_count']} {_position_word(current['plan_count'])}, "
               f"дата заключения отражена по {current['fact_count']}. "
               f"Исполнение — {_pct(current['execution_pct'])}; "
               f"осталось {current['remain_count']} на {_money(current['remain_amount'])} тыс. руб. "
               f"{_budget_text(current, 'remain')}.",
               source=current, size=9)
    for prev in range(1, quarter):
        previous = content["global"]["comp"][f"q{prev}"]
        _paragraph(doc, f"{prev} квартал — {_pct(previous['execution_pct'])} "
                   f"({previous['fact_count']} из {previous['plan_count']}).",
                   size=8, source=previous)
    _paragraph(doc, "Исполнение по управлениям", bold=True, color=BLUE, keep_with_next=True)
    rows = []
    for grbs in model["grbs_order"]:
        q = content["by_grbs"][grbs]["comp"][f"q{quarter}"]
        y = content["by_grbs"][grbs]["comp"]["year"]
        rows.append((grbs, q, y))
    for grbs, q, y in sorted(rows, key=lambda r: (
            r[1]["plan_count"] == 0, 100 if not r[1]["plan_count"] else
            r[1]["fact_count"] / r[1]["plan_count"] * 100, r[0])):
        if not q["plan_count"]:
            text = f"{grbs} — конкурентных закупок с плановым заключением в {quarter} квартале нет."
        else:
            text = (f"{grbs} — {_pct(q['execution_pct'])}: {q['fact_count']} из {q['plan_count']}; "
                    f"остаток — {q['remain_count']}. В годовом плане — {y['plan_count']}.")
        _paragraph(doc, text, size=8, sources=(q, y), first_line_mm=3)
    _paragraph(doc, "Годовой итог", bold=True, color=BLUE, keep_with_next=True)
    _paragraph(doc, f"На {model['snapshot']['report_year']} год предусмотрено {annual['plan_count']} "
               f"{_position_word(annual['plan_count'])}; с датой факта — {annual['fact_count']}. "
               f"Исполнение — {_pct(annual['execution_pct'])}. "
               f"Остаток — {annual['remain_count']} на {_money(annual['remain_amount'])} тыс. руб. "
               f"{_budget_text(annual, 'remain')}.", size=9, source=annual)
    rec = model.get("recommendations") or {}
    if rec:
        _paragraph(doc, f"В накопительном реестре УЭР — {int(rec.get('active') or 0)} "
                   "действующих официальных рекомендаций. Оценки исполнения приводятся "
                   "только по подтверждённым сведениям.", size=8, source=rec)


@section_rule("DOC.OPERATIONAL_EP", roots=["report_content"])
def _add_ep(doc, model):
    ep = model["report_content"]["global"]["ep"]["year"]
    _paragraph(doc, "Справочно. Единственный поставщик", bold=True, color=BLUE, keep_with_next=True)
    _paragraph(doc, f"В плане — {ep['plan_count']} {_position_word(ep['plan_count'])} "
               f"на {_money(ep['plan_amount'])} тыс. руб. {_budget_text(ep, 'plan')}. "
               f"Дата заключения отражена по {ep['fact_count']} на {_money(ep['fact_amount'])} тыс. руб. "
               f"({_pct(ep['execution_pct'])}); осталось {ep['remain_count']} "
               f"на {_money(ep['remain_amount'])} тыс. руб.",
               size=8, source=ep)


def build_operational_plan(report_model: dict):
    """Third official artifact: concise recorded-state brief, not a technical QA dump."""
    assert_renderer_inputs(report_model=report_model)
    if (report_model.get("contract") or {}).get("operational_document_contract") != "operational-report-v1":
        raise ValueError("OPERATIONAL_DOCUMENT_CONTRACT_MISSING")
    doc = DocumentPlan(report_model, "operational", "RECORDED_EXECUTIVE")
    m = doc.model
    day = parse_date(m["snapshot"]["report_date"])
    when = ".".join(reversed(day.split("-")))
    focus = _focus_quarter(m)

    _paragraph(doc, "ОПЕРАТИВНЫЙ ОТЧЁТ ПО ЗАКУПКАМ", bold=True, size=12, align="center", color=BLUE)
    _paragraph(doc, "К комиссии по муниципальным программам. Для Дмитрия Евгеньевича.",
               size=9, align="center")
    _paragraph(doc, f"По состоянию на {when} (Камчатка).", size=9, bold=True, align="center")
    if focus != m["headline"]["current_quarter"]:
        _paragraph(doc, f"Контроль завершённого {focus} квартала; текущие показатели "
                   f"{m['headline']['current_quarter']} квартала отражаются в основном отчёте.",
                   color=GRAY, size=8, italic=True)
    _add_metrics(doc, m, quarter=focus)
    _add_remainders(doc, m, quarter=focus)
    _add_active_procedures(doc, m)
    _add_weekly_review(doc, m, detailed=False)
    _paragraph(doc, "Финансовые остатки и подтверждённая экономия", color=BLUE,
               bold=True, keep_with_next=True)
    _paragraph(doc, "Требует уточнения: сведения о свободных средствах по оперативному "
               "финансовому учёту пока не включены в этот комплект. "
               "Плановая разница и прогноз экономии не выдаются за подтверждённые остатки.",
               color=ORANGE, size=8, italic=True)
    _paragraph(doc, "На что обратить внимание", color=BLUE, bold=True, keep_with_next=True)
    current = m["report_content"]["global"]["comp"][f"q{focus}"]
    if current["remain_count"]:
        _paragraph(doc, f"Уточнить состояние {current['remain_count']} незакрытых плановых "
                   f"позиций {focus} квартала: дату фактического заключения и сведения, "
                   f"отражённые в реестрах. Результат торгов сам по себе не равен заключённому контракту.",
                   size=8, source=current)
    else:
        _paragraph(doc, f"Все позиции плана {focus} квартала имеют отражённые даты факта. "
                   "Это не подтверждает исполнение или оплату договоров.", size=8, source=current)
    _add_ep(doc, m)
    return doc.export()
