from __future__ import annotations

from .models import ProcedureBinding, ProcedureShare, ValidationIssue
from .normalize import clean_text, normalize_grbs, normalize_procedure_code, parse_date
from .rule_catalog import DEFAULT_RULE_CATALOG

DEFAULT_SUBJECT_SIMILARITY_THRESHOLD = DEFAULT_RULE_CATALOG.procedure_subject_similarity_threshold


def binding_from_similarity(procurement_id: str, procedure_code: str, similarity: float | None,
                            *, threshold: float = DEFAULT_SUBJECT_SIMILARITY_THRESHOLD,
                            explicit_code_link: bool = True) -> ProcedureBinding:
    """Fail closed: a code link is necessary, but a gross subject mismatch invalidates result evidence.

    Fuzzy text by itself never creates a binding. It only validates an already explicit code relation.
    """
    if not explicit_code_link:
        return ProcedureBinding(procurement_id, procedure_code, False, similarity,
                                "No explicit procedure-code link")
    if similarity is None:
        return ProcedureBinding(procurement_id, procedure_code, False, None,
                                "Subject similarity unavailable; manual/structured evidence required")
    if similarity < threshold:
        return ProcedureBinding(procurement_id, procedure_code, False, similarity,
                                f"Subject mismatch: {similarity:.4f} < {threshold:.2f}")
    return ProcedureBinding(procurement_id, procedure_code, True, similarity,
                            "Explicit procedure code + compatible subject")


def validate_ledger_procedure_evidence(record: dict) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    block = record.get("procedure_binding_reliable") or {}
    reliable = set(block.get("reliable_codes") or [])
    suspicious = set(block.get("suspicious_codes") or [])
    details = block.get("details") or []
    detail_by_code = {d.get("code"): d for d in details if d.get("code")}
    overlap = reliable & suspicious
    if overlap:
        issues.append(ValidationIssue("ERROR", "PROCEDURE_BINDING_CONFLICT",
                                      "Procedure code is both reliable and suspicious",
                                      {"recommendation_id": record.get("recommendation_id"), "codes": sorted(overlap)}))
    for code in reliable:
        d = detail_by_code.get(code)
        if d and d.get("reliable") is not True:
            issues.append(ValidationIssue("ERROR", "PROCEDURE_RELIABLE_FLAG_MISMATCH",
                                          "Reliable procedure code has non-reliable detail",
                                          {"recommendation_id": record.get("recommendation_id"), "code": code}))
    if record.get("semantic_status") == "IMPLEMENTED_AND_COMPLETED" and not reliable:
        issues.append(ValidationIssue("ERROR", "COMPLETED_WITHOUT_RELIABLE_PROCEDURE",
                                      "Completed recommendation lacks reliable procedure evidence",
                                      {"recommendation_id": record.get("recommendation_id")}))
    return issues


def effective_procedure_nmc(*, master_nmc: float, shares: list[dict], grbs: str) -> tuple[float | None, str]:
    """Resolve the relevant NMC for a GRBS participant in a shared procedure.

    The master NMC is not comparable to one participant's plan row. If share rows exist, exactly one
    share for the GRBS must be used. Ambiguous/missing shares fail closed.
    """
    target_grbs = normalize_grbs(grbs) or str(grbs or "")
    def _share_grbs(s):
        value = s.grbs if isinstance(s, ProcedureShare) else s.get("grbs")
        return normalize_grbs(value) or str(value or "")
    def _share_amount(s):
        return s.amount if isinstance(s, ProcedureShare) else s.get("amount")
    relevant = [s for s in shares if _share_grbs(s) == target_grbs]
    if shares:
        if len(relevant) == 1:
            return float(_share_amount(relevant[0])), "PROCEDURE_SHARE"
        if len(relevant) > 1:
            return None, "AMBIGUOUS_PROCEDURE_SHARE"
        return None, "MISSING_PROCEDURE_SHARE"
    return float(master_nmc), "MASTER_PROCEDURE"


def normalize_procedure_values(values: list[list], *, source_ref_prefix: str = "PROCEDURES") -> tuple[list, list]:
    """Normalize A:Y from `Рабочий реестр процедур` into attempts and participant shares.

    Row kind `доля` is not an independent procurement attempt. It is a participant allocation under the
    same procedure code and must be used for per-GRBS amount comparison.
    """
    from .models import ProcedureAttempt, ProcedureShare
    from .normalize import clean_text, to_decimal

    attempts = []
    shares = []
    for idx, row in enumerate(values, start=1):
        def c(i, row=row): return row[i] if i < len(row) else None
        code = normalize_procedure_code(c(0))
        if not code:
            continue
        kind = clean_text(c(1)).casefold()
        raw_grbs = clean_text(c(4))
        grbs = normalize_grbs(raw_grbs) or raw_grbs
        source_ref = f"{source_ref_prefix}!{idx}"
        nmc = float(to_decimal(c(7))) if clean_text(c(7)) else 0.0
        if kind == "доля":
            shares.append(ProcedureShare(code, grbs, nmc, source_ref))
            continue
        attempts.append(ProcedureAttempt(
            procedure_code=code,
            grbs=grbs,
            customer=clean_text(c(5)),
            subject=clean_text(c(6)),
            nmc=nmc,
            stage=clean_text(c(22)),
            result=clean_text(c(19)),
            final_price=float(to_decimal(c(12))) if clean_text(c(12)) else None,
            ancestor_code=clean_text(c(20)) or None,
            successor_code=clean_text(c(21)) or None,
            source_ref=source_ref,
        ))
    return attempts, shares


def _relation_codes(value: str | None) -> set[str]:
    import re
    return {code for part in re.split(r"[;,\n]+", value or "") if (code := normalize_procedure_code(part.strip()))}


def validate_procedure_lineage(attempts: list) -> list[ValidationIssue]:
    """Validate explicit many-to-many attempt relations without inventing a single parent."""
    issues: list[ValidationIssue] = []
    by_code = {a.procedure_code: a for a in attempts}
    graph = {code: set() for code in by_code}
    for a in attempts:
        for parent in _relation_codes(a.ancestor_code):
            if parent not in by_code:
                issues.append(ValidationIssue("WARN", "PROCEDURE_ANCESTOR_NOT_IN_CURRENT_REGISTRY",
                                              f"{a.procedure_code}: ancestor {parent} is not present"))
            else:
                graph[parent].add(a.procedure_code)
        for successor in _relation_codes(a.successor_code):
            if successor not in by_code:
                issues.append(ValidationIssue("WARN", "PROCEDURE_SUCCESSOR_NOT_IN_CURRENT_REGISTRY",
                                              f"{a.procedure_code}: successor {successor} is not present"))
                continue
            graph[a.procedure_code].add(successor)
            ancestors = _relation_codes(by_code[successor].ancestor_code)
            if ancestors and a.procedure_code not in ancestors:
                issues.append(ValidationIssue("ERROR", "PROCEDURE_LINEAGE_CONFLICT",
                                              f"{a.procedure_code} -> {successor} conflicts with successor ancestors",
                                              {"ancestors":sorted(ancestors)}))
    visiting, visited = set(), set()
    def visit(code):
        if code in visiting: return True
        if code in visited: return False
        visiting.add(code)
        if any(visit(child) for child in sorted(graph[code])): return True
        visiting.remove(code); visited.add(code)
        return False
    if any(visit(code) for code in sorted(graph)):
        issues.append(ValidationIssue("ERROR", "PROCEDURE_LINEAGE_CYCLE", "Procedure replacement graph contains a cycle"))
    return issues


def validate_procedure_uniqueness(attempts: list) -> list[ValidationIssue]:
    """A procedure code may have participant share rows, but only one master attempt row."""
    counts = {}
    for a in attempts:
        counts[a.procedure_code] = counts.get(a.procedure_code, 0) + 1
    return [
        ValidationIssue(
            "ERROR", "DUPLICATE_PROCEDURE_CODE",
            f"{code}: {count} master procedure rows use the same code",
            {"procedure_code": code, "master_attempt_rows": count},
        )
        for code, count in sorted(counts.items()) if count > 1
    ]


def validate_procedure_shares(attempts: list, shares: list) -> list[ValidationIssue]:
    """Joint allocations are in RUB and must balance the sole parent within one kopeck."""
    from collections import defaultdict
    from decimal import Decimal

    parents = defaultdict(list); groups = defaultdict(list)
    for attempt in attempts:
        parents[attempt.procedure_code].append(attempt)
    for share in shares:
        groups[share.procedure_code].append(share)
    issues = []
    for code, rows in groups.items():
        def issue(kind, message, code=code):
            issues.append(ValidationIssue('ERROR', kind, message, {'procedure_code': code}))
        if len(parents[code]) != 1:
            issue('PROCEDURE_SHARE_PARENT_MISSING', 'Доли не имеют единственной родительской процедуры.')
            continue
        amounts = [Decimal(str(row.amount)) for row in rows]
        if any(not value.is_finite() or value < 0 for value in amounts):
            issue('PROCEDURE_SHARE_AMOUNT_INVALID', 'Некорректная сумма доли процедуры.')
            continue
        if len({row.grbs for row in rows}) != len(rows) or any(not row.grbs for row in rows):
            issue('PROCEDURE_SHARE_PARTICIPANT_AMBIGUOUS', 'Участник распределения отсутствует или повторяется.')
        if abs(sum(amounts, Decimal(0)) - Decimal(str(parents[code][0].nmc))) > Decimal('0.01'):
            issue('PROCEDURE_SHARE_BALANCE_MISMATCH', 'Сумма долей не совпадает с НМЦК родительской процедуры.')
    return issues


def _closed_check_view(queue_values):
    headers = ['Уровень', 'Код', 'Действие', 'Управление', 'Заказчик',
               'Предмет', 'НМЦК', 'Стадия', 'Сигнал', 'Открыть']
    for row in queue_values:
        for offset in (13, 14):  # N:W before separator J; O:X after it.
            if [clean_text(c) for c in row[offset:offset + 10]] == headers:
                return offset
    return None


def operational_cells(raw, offset):
    """Map reviewed physical columns without changing the retained source cells."""
    if offset not in (13, 14):
        return raw
    c = lambda i: raw[i] if i < len(raw) else ''
    return ['', '', c(2), c(1), *[c(i) for i in range(3, 9)]]


def iter_operational_rows(queue_values):
    """Read stacked queues, A:J / M:V queues and N:W or O:X closed checks.

    Column offset is kept with each physical row so the source address stays verifiable.
    """
    parallel = any(len(row) > 12 and clean_text(row[12]).casefold() == 'данные по закрытым строкам'
                   for row in queue_values)
    checks = _closed_check_view(queue_values)
    block = 'active'
    for number, row in enumerate(queue_values, 1):
        if row and clean_text(row[0]).casefold() == 'данные по закрытым строкам':
            block = 'closed_quality'
            continue
        blocks = [('active', 0), ('closed_quality', checks)] if checks is not None else (
            [('active', 0), ('closed_quality', 12)] if parallel else [(block, 0)])
        for current, offset in blocks:
            cells = row[offset:offset + 10]
            mapped = operational_cells(cells, offset)
            if len(mapped) > 3 and normalize_procedure_code(mapped[3]):
                yield current, number, offset, cells


def validate_operational_view(master_values, queue_values, *, as_of):
    """Check the view against its primary registry and the report's civil date.

    This mirrors the source contract's W stage and two queue predicates using
    Python, not cached formula results. A successful auction remains a result
    of a procedure and never becomes evidence that a contract was concluded.
    """
    day = parse_date(as_of)
    if not day:
        raise ValueError('PROCEDURE_AS_OF_INVALID')
    issues = []
    expected = {'active': {}, 'closed_quality': {}}
    parallel = any(len(row) > 12 and clean_text(row[12]).casefold() == 'данные по закрытым строкам'
                   for row in queue_values)
    checks = _closed_check_view(queue_values)
    active_stages = {'Заявка в уполномоченном органе', 'Объявлена', 'Итог не внесён'}
    closed_stages = {'Состоялась', 'Не состоялась', 'Переоформлена'}
    for number, row in enumerate(master_values, 1):
        def c(i, row=row): return row[i] if i < len(row) else ''
        code = normalize_procedure_code(c(0))
        if not code or clean_text(c(1)) == 'доля':
            continue
        publication = parse_date(c(9)); application = parse_date(c(8)); results_due = parse_date(c(11))
        published = bool(publication and publication <= day)
        if c(19) == 'Состоялась':
            stage = 'Состоялась'
        elif clean_text(c(21)):
            stage = 'Переоформлена'
        elif c(19) in {'Нет заявок', 'Отмена по решению заказчика', 'Отмена по предписанию ФАС'}:
            stage = 'Не состоялась'
        elif application and not published:
            stage = 'Заявка в уполномоченном органе'
        elif published and (not results_due or day <= results_due):
            stage = 'Объявлена'
        else:
            stage = 'Итог не внесён' if published else ''
        if stage != clean_text(c(22)):
            issues.append(ValidationIssue('ERROR', 'PROCEDURE_STAGE_DATE_MISMATCH',
                'Стадия реестра не соответствует датам на момент отчёта.',
                {'procedure_code': code, 'row': number, 'expected': stage, 'observed': c(22), 'as_of': day}))
        action = clean_text(c(23)); quality = clean_text(c(24))
        if stage in active_stages and (action or checks):
            deadline = day if action.startswith('Исправить: ') else application if action == 'Разместить извещение' else results_due
            if checks and (action == 'Разместить извещение' or action.startswith('Исправить: ')):
                deadline = None  # Current source formula explicitly leaves these deadlines unset.
            block = 'active'
        elif stage in closed_stages and (action or 'Ошибка: ' in quality or 'Проверить: ' in quality
                                        or ((parallel or checks) and 'Неполно: ' in quality)):
            deadline = None if checks else results_due
            block = 'closed_quality'
            if checks and not action:
                action = 'Проверить данные'
        else:
            continue
        expected[block][code] = (stage, clean_text(c(6)), action, deadline)

    observed = {'active': {}, 'closed_quality': {}}
    for block, number, offset, row in iter_operational_rows(queue_values):
        row = operational_cells(row, offset)
        def c(i, row=row): return row[i] if i < len(row) else ''
        if offset and not expected[block].get(normalize_procedure_code(c(3)), ('', '', ''))[2]:
            code = normalize_procedure_code(c(3))
            if code in expected[block]:
                stage, subject, _, deadline = expected[block][code]
                expected[block][code] = (stage, subject, 'Разобрать замечания', deadline)
        code = normalize_procedure_code(c(3))
        if not code:
            continue
        if code in observed[block]:
            issues.append(ValidationIssue('ERROR', 'PROCEDURE_QUEUE_DUPLICATE',
                'Процедура повторяется в одном блоке витрины.', {'procedure_code': code, 'row': number}))
        observed[block][code] = (clean_text(c(8)), clean_text(c(6)), clean_text(c(2)), parse_date(c(0)))
    for block, expected_rows in expected.items():
        if expected_rows.keys() != observed[block].keys():
            issues.append(ValidationIssue('ERROR', 'PROCEDURE_QUEUE_COVERAGE_MISMATCH',
                'Состав блока витрины не совпадает с рабочим реестром.',
                {'block': block, 'missing': sorted(expected_rows.keys() - observed[block].keys()),
                 'unexpected': sorted(observed[block].keys() - expected_rows.keys())}))
        for code in expected_rows.keys() & observed[block].keys():
            if expected_rows[code] != observed[block][code]:
                issues.append(ValidationIssue('ERROR', 'PROCEDURE_QUEUE_RECORD_MISMATCH',
                    'Стадия, предмет, действие или срок витрины расходятся с первичным реестром.',
                    {'block': block, 'procedure_code': code, 'expected': expected_rows[code],
                     'observed': observed[block][code]}))
    return issues
