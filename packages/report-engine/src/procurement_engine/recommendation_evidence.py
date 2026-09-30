"""Current action evidence from reviewed historical links and frozen primary rows."""
import re
from collections import defaultdict
from datetime import datetime
from decimal import Decimal

from .normalize import normalize_id, parse_date, to_decimal


def action_target_proven(record, source_ids):
    """Accept only a complete unconditional action, never an embedded mention."""
    text = ' '.join((record.get('recommendation_text') or '').casefold().split())
    prefix = r'(?:рекомендуем\s+)?'
    number = r'\d+(?:[/-]\d+)?'
    kind = record.get('recommendation_type')
    if kind in {'CHANGE_METHOD_EA', 'CHANGE_METHOD_EP'}:
        action = (rf'(?:позицию\s+{number}\s+(?:вынести|перевести|провести)'
                  rf'|(?:вынести|перевести|провести)\s+(?:закупку|позицию\s+{number}))\s+на\s+эа')
        anchor = r'(?:\s*\([^()]+\)\s+на\s+сумму\s+\d+(?:[.,]\d+)?\s+тыс\.\s*руб\.)?'
        match = re.fullmatch(prefix + action + anchor + r'\.?', text)
        if not match:
            return False
        explicit = re.findall(number, re.split(r'\bна\s+эа\b', text, maxsplit=1)[0])
        wanted = {normalize_id(value) for value in source_ids}
        return ({normalize_id(value) for value in explicit} == wanted if explicit else len(wanted) == 1)
    if kind == 'MERGE_PROCUREMENTS':
        match = re.fullmatch(prefix + rf'объединить\s+позиции\s+({number}(?:\s*,\s*{number})+)\s+в\s+одну\s+закупку\.?', text)
        return bool(match and {normalize_id(value) for value in re.findall(number, match[1])}
                    == {normalize_id(value) for value in source_ids})
    if kind == 'CHANGE_AMOUNT':
        target = re.fullmatch(prefix + r'(?:установить\s+(?:плановую\s+)?сумму\s+|изменить\s+(?:плановую\s+)?сумму\s+до\s+)(\d+(?:[.,]\d+)?)\s+тыс\.\s*руб\.', text)
        return bool(target and record.get('target_amount_thousand') is not None
                    and to_decimal(target[1]) == to_decimal(record['target_amount_thousand']))
    if kind == 'MOVE_PLANNED_DATE':
        match = re.fullmatch(prefix + r'перенести\s+плановую\s+дату\s+на\s+(\d{2}\.\d{2}\.\d{4})\.?', text)
        target = parse_date(record.get('target_planned_date'))
        return bool(match and target is not None and parse_date(match[1]) == target)
    return False


def confirmed_result(record, rows, reviews, report_date, *, compile_original=False):
    wanted = {normalize_id(value) for value in record.get('source_procurement_ids') or []}
    if not wanted:
        return None
    by_uid = defaultdict(list)
    for row in rows:
        if row.procurement_uid and row.grbs == record.get('grbs'):
            by_uid[row.procurement_uid].append(row)
    proofs = []
    links = defaultdict(set)
    for review in reviews or []:
        evidence = review.get('evidence') or {}
        if evidence.get('recommendation_id') != record['recommendation_id']:
            continue
        if not all(review.get(key) for key in ('review_id', 'uid', 'reviewer', 'reviewed_at')) or not all(
                evidence.get(key) for key in ('source_ref', 'reason', 'source_procurement_ids')):
            continue
        instant = datetime.fromisoformat(review['reviewed_at'])
        if instant.tzinfo is None or instant.date().isoformat() > parse_date(report_date):
            continue
        original_ids = {normalize_id(value) for value in evidence['source_procurement_ids']}
        if not original_ids <= wanted or len(by_uid[review['uid']]) != 1:
            continue
        proofs.append(review)
        for original in original_ids:
            links[original].add(review['uid'])
    if set(links) != wanted or any(len(targets) != 1 for targets in links.values()):
        return None
    uids = sorted({next(iter(targets)) for targets in links.values()})
    current = [by_uid[uid][0] for uid in uids]
    spec = None
    if compile_original:
        from .action_spec import compile_action
        spec = compile_action(record.get('recommendation_text'), source_ids=wanted,
            subjects=[(row.source_row_no, row.subject) for row in current])
    return evaluate_linked_action(record, current, report_date, source_ids=wanted, proofs=proofs,
                                  action_spec=spec)


def evaluate_linked_action(record, current, report_date, *, source_ids, proofs=(),
                           evidence_quality='REVIEWED_IDENTITY+PRIMARY_FIELDS', action_spec=None):
    """Evaluate primary fields only after the caller has verified the full link."""
    if not current:
        raise ValueError('RECOMMENDATION_ROWS_REQUIRED')
    wanted = set(source_ids)
    if action_spec is not None and set(action_spec.get('source_ids', [])) != wanted:
        raise ValueError('RECOMMENDATION_ACTION_TARGET_MISMATCH')
    uids = sorted({row.procurement_uid for row in current})
    methods = {row.method for row in current}
    facts = sorted({row.actual_date for row in current if row.actual_date and row.actual_date <= parse_date(report_date)})
    execution = ('FACT_RECORDED' if all(row.actual_date in facts for row in current)
                 else 'PARTIAL_RECORDED_FACT' if facts else 'PLANNED')
    compliance, grouping = 'UNKNOWN', 'NONE'
    goal = action_spec or record
    kind = action_spec['type'] if action_spec is not None else (record.get('recommendation_type') if action_target_proven(record, source_ids) else None)
    if kind in {'CHANGE_METHOD_EA', 'CHANGE_METHOD_EP'} and None not in methods:
        # CHANGE_METHOD_EP is the existing historical label for leaving ЕП.
        implemented = all(method == 'ЭА' for method in methods)
        compliance = 'IMPLEMENTED' if implemented else 'NOT_IMPLEMENTED'
        finding = ('Рекомендуемый конкурентный способ отражён в текущем плане: ' if implemented
                   else 'Рекомендуемый конкурентный способ не отражён во всех связанных позициях: ') + ', '.join(sorted(methods)) + '.'
    elif kind == 'MERGE_PROCUREMENTS':
        merge_ids = {normalize_id(value) for review in proofs
                     if review['evidence'].get('relation') == 'MERGES_INTO'
                     for value in review['evidence']['source_procurement_ids']}
        if len(wanted) > 1 and len(uids) == 1 and merge_ids == wanted:
            compliance, grouping = 'IMPLEMENTED', 'MERGED'
            finding = 'Все исходные позиции связаны подтверждённым объединением с одной текущей закупкой.'
        else:
            grouping = 'UNKNOWN'
            finding = 'Связь с текущими закупками подтверждена; объединение всех исходных позиций не доказано.'
    elif kind == 'CHANGE_AMOUNT' and goal.get('target_amount_thousand') is not None:
        amount = sum((to_decimal(getattr(row, field)) for row in current
                      for field in ('plan_fb', 'plan_kb', 'plan_mb')), Decimal(0))
        target = to_decimal(goal['target_amount_thousand'])
        if all(not any(field in row.missing_money_fields for field in ('H', 'I', 'J'))
               or (action_spec is not None and row.stored_plan_total is not None
                   and to_decimal(row.stored_plan_total) == sum((to_decimal(getattr(row, f))
                        for f in ('plan_fb', 'plan_kb', 'plan_mb')), Decimal(0))) for row in current):
            compliance = 'IMPLEMENTED' if amount == target else 'NOT_IMPLEMENTED'
        finding = f'Плановая сумма связанных позиций — {amount} тыс. руб.; рекомендуемая — {target} тыс. руб.'
    elif kind == 'MOVE_PLANNED_DATE' and parse_date(goal.get('target_planned_date')):
        target = parse_date(goal['target_planned_date'])
        if all(row.planned_date for row in current):
            compliance = 'IMPLEMENTED' if all(row.planned_date == target for row in current) else 'NOT_IMPLEMENTED'
        finding = 'Рекомендуемая дата планирования: ' + target + '; текущие даты: ' + ', '.join(
            sorted({row.planned_date or 'не указана' for row in current})) + '.'
    else:
        finding = 'Связь с текущими закупками подтверждена; для проверки действия нужна конкретная структурированная цель.'
    finding += (' Факт внесён по всем связанным позициям.' if execution == 'FACT_RECORDED'
                else ' Факт внесён по части связанных позиций.' if facts else ' Факт закупки пока не внесён.')
    status = compliance if compliance != 'UNKNOWN' else 'ACTION_REVIEW_REQUIRED'
    return {**({'compiled_action': action_spec} if action_spec is not None else {}), 'semantic_status': status,
            'semantic_status_ru': {'IMPLEMENTED': 'РЕАЛИЗОВАНО В ПЛАНЕ', 'NOT_IMPLEMENTED': 'НЕ РЕАЛИЗОВАНО В ПЛАНЕ',
                                   'ACTION_REVIEW_REQUIRED': 'ИСПОЛНЕНИЕ ДЕЙСТВИЯ НЕ УСТАНОВЛЕНО'}[status],
            'current_procurement_ids': sorted({row.source_row_no for row in current if row.source_row_no}),
            'current_procurement_uids': uids, 'current_method': next(iter(methods)) if len(methods) == 1 else None,
            'current_procurement_state': execution, 'current_fact_date': facts, 'business_finding': finding,
            'binding_evidence': {'review_ids': sorted({review['review_id'] for review in proofs}),
                                 'source_procurement_ids': sorted(wanted), 'current_procurement_uids': uids},
            'status_evidence': 'Подтверждена историческая связь; действие проверено по первичным полям текущего снимка.',
            'dimensions': {'compliance_status': compliance, 'execution_status': execution,
                           'grouping_status': grouping, 'evidence_quality': evidence_quality}}


COUNT_LABELS = {
    'UNKNOWN': 'Не подтверждено', 'IMPLEMENTED': 'Реализовано', 'NOT_IMPLEMENTED': 'Не реализовано',
    'PLANNED': 'Факт не внесён', 'FACT_RECORDED': 'Факт внесён', 'PARTIAL_RECORDED_FACT': 'Факт внесён частично',
    'VERIFIED_ORIGIN_AND_CURRENT_IDENTITY': 'Связь подтверждена', 'VERIFIED_ORIGIN': 'Происхождение подтверждено',
    'IDENTITY_REVIEW_REQUIRED': 'Не подтверждено', 'REVIEWED_IDENTITY+PRIMARY_FIELDS': 'Подтверждённая связь и первичные поля',
}


def recommendation_counts(records):
    from collections import Counter

    return {key: dict(Counter(COUNT_LABELS.get(record['dimensions'][axis], record['dimensions'][axis])
                             for record in records if record.get('active_in_current_slice')))
            for key, axis in [('recommendation_compliance_counts', 'compliance_status'),
                              ('recommendation_execution_counts', 'execution_status'),
                              ('recommendation_evidence_quality_counts', 'evidence_quality')]}
