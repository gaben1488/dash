"""Conservative, readable per-purchase evidence for the DE operational report.

An explicit procedure code in the plan is necessary, but a mismatch between
subjects or responsible participants invalidates the apparent match. A procedure
result is NEVER treated as a contract signature or as confirmed budget savings.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from decimal import Decimal
from difflib import SequenceMatcher
import re

from .normalize import normalize_grbs, normalize_procedure_code, parse_date

_STOP = frozenset({"в", "на", "для", "и", "по", "из", "с", "от", "до", "о", "об",
                   "оказание", "услуг", "услуги", "выполнение", "работ", "поставка",
                   "приобретение", "организация", "обеспечение", "заказчик"})


def _tokens(text):
    text = re.sub(r"(?iu)[а-яa-z]+[0-9]+-[0-9]{2}", " ", str(text or ""))
    return {part for part in re.findall(r"(?iu)[а-яa-z]{3,}|\d+", text.casefold())
            if part not in _STOP}


def _compatible(plan_subject, procedure_subject):
    """Text only checks an explicit code, never generates one."""
    a, b = _tokens(plan_subject), _tokens(procedure_subject)
    if not a or not b:
        return False
    common = a & b
    return (len(common) >= 2 and len(common) / min(len(a), len(b)) >= 0.35) or (
        SequenceMatcher(None, " ".join(sorted(a)), " ".join(sorted(b))).ratio() >= 0.67)


def _clean_date(value):
    d = parse_date(value)
    return ".".join(reversed(d.split("-"))) if d else None


def _thousand_rub(value):
    return Decimal(str(value)) / Decimal(1000)


def _money(value):
    return f"{Decimal(str(value)):,.2f}".replace(",", " ").replace(".", ",")


def _normalized_codes(value):
    codes = []
    for token in re.split(r"[;,\n]+", str(value or "")):
        candidate = normalize_procedure_code(token.strip())
        if candidate and candidate not in codes:
            codes.append(candidate)
    return codes


def _unique_by_code(rows):
    count = Counter(r["procedure_code"] for r in rows)
    return {r["procedure_code"]: r for r in rows if count[r["procedure_code"]] == 1}


def build_case_index(operational_evidence, plan_details, *, year):
    attempts = operational_evidence.get("attempts") or []
    by_code = _unique_by_code(attempts)
    shares = defaultdict(list)
    for share in operational_evidence.get("shares") or []:
        shares[share["procedure_code"]].append(share)
    used = {code for detail in plan_details
            if detail.get("included") and detail.get("planned_year") == year
            if (code := normalize_procedure_code(detail.get("procedure_code")))}
    return by_code, shares, used


def _financial_match(grbs, procedure, shares):
    target = normalize_grbs(grbs) or str(grbs or "")
    recorded = normalize_grbs(procedure.get("grbs")) or str(procedure.get("grbs") or "")
    relevant = [row for row in shares if normalize_grbs(row.get("grbs")) == target]
    if shares:
        return len(relevant) == 1
    return recorded == target


def describe_linked_procedure(detail, index):
    by_code, shares, _ = index
    code = normalize_procedure_code(detail.get("procedure_code"))
    if not code:
        return "", ""
    attempt = by_code.get(code)
    if attempt is None:
        return "", f"Код {code} указан в плане, но соответствующая процедура не найдена в рабочем реестре. Связь требует проверки."
    if not _financial_match(detail.get("grbs"), attempt, shares.get(code, [])):
        return "", f"По коду {code} не подтверждена принадлежность процедуры этому управлению."
    if not _compatible(detail.get("subject"), attempt["subject"]):
        return "", f"Код {code} есть в рабочем реестре, но наименование закупки не совпадает с планом. Требуется сверка."
    parts = [f"В реестре процедур: {code} — {attempt.get('stage') or 'стадия не указана'}."]
    result = attempt.get("result") or ""
    if result and result not in parts[0]:
        parts.append(f"Итог процедуры: {result}.")
    price = attempt.get("final_price")
    if price is not None and (attempt.get("stage") == "Состоялась" or result == "Состоялась"):
        parts.append(f"Цена по итогам процедуры — {_money(_thousand_rub(price))} тыс. руб.")
    closed = _clean_date(attempt.get("results_date"))
    if closed:
        parts.append(f"Дата подведения итогов — {closed}.")
    after = _normalized_codes(attempt.get("successor_code"))
    if len(after) == 1 and after[0] != code and after[0] in by_code:
        follower = by_code[after[0]]
        if _compatible(detail.get("subject"), follower["subject"]) and (
            _financial_match(detail.get("grbs"), follower, shares.get(after[0], []))):
            parts.append(f"По явно указанной связи преемник {after[0]}: {follower.get('stage') or 'стадия не указана'}.")
            if follower.get("final_price") is not None and follower.get("stage") == "Состоялась":
                parts.append("Цена по итогам преемника — "
                             f"{_money(_thousand_rub(follower['final_price']))} тыс. руб.")
        else:
            return " ".join(parts), "Для указанного преемника не подтверждено соответствие предмета или управления."
    elif len(after) > 1:
        return " ".join(parts), "Указано несколько связанных процедур; требуется уточнить судьбу закупки."
    return " ".join(parts), ""


def unlinked_procedure_candidates(index, *, year, limit=5):
    """No categorical claims that absent code means the procurement is off-plan."""
    by_code, _, used = index
    result = [row for code, row in by_code.items()
              if code not in used and code.endswith("-" + str(year)[-2:])
              and row.get("stage") in {"Объявлена", "Заявка в уполномоченном органе", "Итог не внесён"}]
    result.sort(key=lambda r: (-Decimal(str(r.get("nmc") or 0)), r["procedure_code"]))
    return result[:limit], max(0, len(result) - limit)


def procedure_candidate_sentence(p):
    price = Decimal(str(p.get("nmc") or 0)) / Decimal(1000)
    return (f"{p['procedure_code']} — {p['subject']}. "
            f"НМЦК — {_money(price)} тыс. руб.; стадия — {p.get('stage') or 'не указана'}. "
            "Точная связь с позицией плана не подтверждена; повторно в плановых итогах не учитывается.")
