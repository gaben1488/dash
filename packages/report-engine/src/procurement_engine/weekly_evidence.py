"""Evidence-bound weekly changes. Never infer contracts from procedure outcomes.

The earlier *verified* Thursday/Friday publication is captured into the current
snapshot; reconstruction never depends on what Google happens to contain later.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

CONTRACT = "weekly-evidence-v1"

LABELS = {
    "METHOD_CHANGED": "Изменён способ определения поставщика",
    "PLAN_QUARTER_CHANGED": "Изменён плановый квартал",
    "PLAN_DATE_CHANGED": "Изменена плановая дата",
    "PLAN_AMOUNT_CHANGED": "Изменена плановая сумма",
    "BUDGET_CHANGED": "Изменено распределение финансирования",
    "FACT_DATE_RECORDED": "Внесена дата заключения",
    "FACT_DATE_REMOVED": "Убрана ранее указанная дата заключения",
    "FACT_DATE_CORRECTED": "Исправлена дата заключения",
    "FACT_AMOUNT_CHANGED": "Уточнена фактическая сумма",
}
PRIORITY = {k: i for i, k in enumerate((
    "FACT_DATE_RECORDED", "FACT_DATE_REMOVED", "FACT_DATE_CORRECTED",
    "METHOD_CHANGED", "PLAN_QUARTER_CHANGED", "PLAN_DATE_CHANGED",
    "PLAN_AMOUNT_CHANGED", "BUDGET_CHANGED", "FACT_AMOUNT_CHANGED",
))}


def _iso(value):
    from .normalize import parse_date

    return parse_date(value)


def _money(value):
    try:
        return Decimal(str(value if value is not None else 0)).quantize(Decimal("0.01"))
    except (TypeError, ValueError, InvalidOperation) as exc:
        raise ValueError("WEEKLY_MONEY_INVALID") from exc


def _money_ru(value):
    return f"{_money(value):,.2f}".replace(",", " ").replace(".", ",")


def _day_ru(value):
    return ".".join(reversed(value.split("-"))) if value else "не указана"


def previous_week_window(report_date):
    """Only verified releases from Thursday/Friday of the preceding week qualify."""
    current = date.fromisoformat(_iso(report_date))
    monday = current - timedelta(days=current.weekday() + 7)
    return (monday + timedelta(days=3)).isoformat(), (monday + timedelta(days=4)).isoformat()


def freeze_weekly_baseline(previous):
    """Keep only the previous model fields needed for a repeatable comparison."""
    if previous is None:
        return {"contract": CONTRACT, "status": "NOT_AVAILABLE"}
    receipt, model = previous["receipt"], previous["model"]
    return {
        "contract": CONTRACT, "status": "AVAILABLE",
        "release_id": receipt["release_id"],
        "snapshot_id": receipt["snapshot_id"],
        "model_sha256": receipt["model_sha256"],
        "report_date": receipt["report_date"],
        "model": {
            "snapshot": {k: model["snapshot"].get(k) for k in (
                "snapshot_id", "report_date", "report_year", "rules_version")},
            "grbs_order": model.get("grbs_order"),
            "headline": model.get("headline"),
            "details": model.get("details", []),
            "recommendation_records": model.get("recommendation_records", []),
        },
    }


def _eligible_rows(model):
    year = model["snapshot"]["report_year"]
    rows = [r for r in model.get("details", [])
            if r.get("included") and r.get("planned_year") == year]
    counts = Counter(r.get("procurement_uid") for r in rows if r.get("procurement_uid"))
    certain = {r["procurement_uid"]: r for r in rows
               if r.get("procurement_uid") and counts[r["procurement_uid"]] == 1}
    uncertain = sum(not r.get("procurement_uid") or counts[r.get("procurement_uid")] != 1
                    for r in rows)
    return certain, uncertain


def _event(kind, old, new, before, after):
    return {
        "kind": kind, "grbs": new["grbs"], "subject": new["subject"],
        "uid": new["procurement_uid"], "before": str(before or ""),
        "after": str(after or ""),
        "previous_source_ref": old.get("physical_row_key"),
        "current_source_ref": new.get("physical_row_key"),
        "amount_thousand": str(_money(new.get("plan_amount"))),
    }


def _events(old, new):
    items = []
    if old.get("method") != new.get("method"):
        items.append(_event("METHOD_CHANGED", old, new, old.get("method"), new.get("method")))
    if old.get("planned_quarter") != new.get("planned_quarter"):
        items.append(_event("PLAN_QUARTER_CHANGED", old, new, old.get("planned_quarter"),
                            new.get("planned_quarter")))
    if old.get("planned_date") != new.get("planned_date"):
        items.append(_event("PLAN_DATE_CHANGED", old, new, old.get("planned_date"),
                            new.get("planned_date")))
    old_money, new_money = _money(old.get("plan_amount")), _money(new.get("plan_amount"))
    if old_money != new_money:
        items.append(_event("PLAN_AMOUNT_CHANGED", old, new, old_money, new_money))
    elif any(_money(old.get(f"plan_{budget}")) != _money(new.get(f"plan_{budget}"))
             for budget in ("fb", "kb", "mb")):
        items.append(_event("BUDGET_CHANGED", old, new, "", ""))
    old_fact, new_fact = old.get("actual_date"), new.get("actual_date")
    if old_fact != new_fact:
        kind = ("FACT_DATE_RECORDED" if not old_fact else
                "FACT_DATE_REMOVED" if not new_fact else "FACT_DATE_CORRECTED")
        items.append(_event(kind, old, new, old_fact, new_fact))
    old_amount, new_amount = _money(old.get("fact_amount")), _money(new.get("fact_amount"))
    if old_amount != new_amount:
        items.append(_event("FACT_AMOUNT_CHANGED", old, new, old_amount, new_amount))
    return items


def event_sentence(event, *, baseline_date=None):
    """Ordinary business language; never print UID, engine labels or trace locators."""
    action = event["kind"]
    lead = f"{event['grbs']}: {event['subject']} — "
    before, after = event["before"], event["after"]
    if action == "METHOD_CHANGED":
        return lead + f"в плане способ определения поставщика изменён с {before or 'не указан'} на {after or 'не указан'}."
    if action == "PLAN_QUARTER_CHANGED":
        return lead + f"плановый квартал изменён с {before or 'не указан'} на {after or 'не указан'}."
    if action == "PLAN_DATE_CHANGED":
        return lead + f"плановая дата изменена с {_day_ru(before)} на {_day_ru(after)}."
    if action == "PLAN_AMOUNT_CHANGED":
        return lead + f"плановая сумма уточнена: {_money_ru(before)} → {_money_ru(after)} тыс. руб."
    if action == "BUDGET_CHANGED":
        return lead + "изменено распределение плановых средств по бюджетам; общая сумма не изменилась."
    if action == "FACT_DATE_RECORDED":
        note = (" Сведения относятся к более раннему периоду."
                if baseline_date and after <= _iso(baseline_date) else "")
        return lead + f"в реестре появилась фактическая дата {_day_ru(after)}.{note}"
    if action == "FACT_DATE_REMOVED":
        return lead + "ранее указанная фактическая дата больше не отражается в реестре."
    if action == "FACT_DATE_CORRECTED":
        return lead + f"исправлена фактическая дата: {_day_ru(before)} → {_day_ru(after)}."
    if action == "FACT_AMOUNT_CHANGED":
        return lead + f"уточнена фактическая сумма: {_money_ru(before)} → {_money_ru(after)} тыс. руб."
    raise ValueError("WEEKLY_EVENT_KIND_UNKNOWN")


def build_weekly_evidence(current, frozen):
    """No comparison => explicit uncertainty, never reuse yesterday as last week."""
    snapshot = current["snapshot"]
    info = {"contract": CONTRACT, "status": "NOT_AVAILABLE", "report_date": snapshot["report_date"],
            "baseline_date": None, "baseline_release_id": None,
            "message": "Срез за предыдущую отчётную неделю не подтверждён. Недельное сравнение не составлено.",
            "totals": {}, "event_counts": {}, "events": [],
            "matched_positions": 0, "unmatched_positions": 0, "recommendations_added": 0}
    if frozen.get("contract") != CONTRACT or frozen.get("status") != "AVAILABLE":
        return info
    earlier = frozen["model"]
    baseline_date = frozen["report_date"]
    info.update(baseline_date=baseline_date, baseline_release_id=frozen["release_id"])
    start, end = previous_week_window(snapshot["report_date"])
    if not (start <= _iso(baseline_date) <= end):
        info.update(status="INCOMPARABLE",
                    message="Нет проверенного четвергового или пятничного среза именно за предыдущую неделю.")
        return info
    a, b = earlier["snapshot"], snapshot
    if a.get("report_year") != b.get("report_year") or set(earlier.get("grbs_order") or []) != set(current.get("grbs_order") or []):
        info.update(status="INCOMPARABLE",
                    message="Изменился отчётный год либо состав управлений; прямое сравнение не выполняется.")
        return info
    if a.get("rules_version") != b.get("rules_version"):
        info.update(status="INCOMPARABLE",
                    message="Изменилась методика расчёта. Сравнение будет доступно после накопления сопоставимых недель.")
        return info
    old, old_uncertain = _eligible_rows(earlier)
    new, new_uncertain = _eligible_rows(current)
    common = sorted(set(old) & set(new))
    events = [event for uid in common for event in _events(old[uid], new[uid])]
    events.sort(key=lambda item: (PRIORITY[item["kind"]], -_money(item["amount_thousand"]),
                                  item["grbs"], item["subject"], item["uid"]))
    counts = Counter(item["kind"] for item in events)
    headline_a, headline_b = earlier["headline"], current["headline"]
    totals = {}
    for key in ("competitive", "single_supplier"):
        a_block, b_block = headline_a[key]["year"], headline_b[key]["year"]
        totals[key] = {field: {"before": a_block[field], "after": b_block[field],
                               "delta": round(float(b_block[field]) - float(a_block[field]), 2)}
                       for field in ("plan_count", "fact_count")}
    before_recs = {r.get("recommendation_id") for r in earlier.get("recommendation_records", [])
                   if r.get("recommendation_id")}
    now_recs = {r.get("recommendation_id") for r in current.get("recommendation_records", [])
                if r.get("recommendation_id")}
    unknown = old_uncertain + new_uncertain + len(set(old) ^ set(new))
    info.update(
        status="COMPARABLE",
        message=("Показатели сопоставлены с проверенным недельным выпуском. "
                 "Изменения строк приведены только при подтверждённой идентичности."),
        totals=totals, event_counts=dict(sorted(counts.items())), events=events,
        matched_positions=len(common), unmatched_positions=unknown,
        recommendations_added=len(now_recs - before_recs),
    )
    return info
