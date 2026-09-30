"""Attributed source explanations, independent of completion and action compliance.

A statement in a cell is evidence that the author wrote it, not evidence of a
contract, payment, changed plan period or the lawfulness of a procurement method.
Unknown wording is preserved verbatim (after whitespace normalization), not dropped.
"""
import re

from .normalize import clean_text

CONTRACT = 'source-context-v1'
FIELDS = (
    ('single_supplier_reason', 'M', 'Основание выбора ЕП'),
    ('deviation_reason', 'U', 'Пояснение отклонения'),
    ('necessity_reason', 'AE', 'Обоснование необходимости'),
    ('grbs_comment', 'AF', 'Комментарий ГРБС'),
    ('uer_comment', 'AG', 'Комментарий УЭР'),
    ('monitoring_note', 'AH', 'Примечание мониторинга'),
)
PLACEHOLDERS = {'', 'x', 'х', '-', '—'}
NEW_ROW_FIELDS = ('program', 'subprogram', 'single_supplier_reason', 'necessity_reason', 'uer_comment')


def is_technical_note(value):
    # Only whole-cell signatures of known engine annotations. A business request
    # such as “подтвердить сроки поставки” is NOT an engineering placeholder.
    return bool(re.fullmatch(r'(?:\[сверка кодов\]\s*)?(?:глазами не проверено|'
                            r'требуется подтверждение связи|identity_review_required|review_required)[.!]?',
                            clean_text(value), flags=re.IGNORECASE))


def explanations(row):
    """Keep separate provenance when two authors supplied the same words."""
    getter = row.get if isinstance(row, dict) else lambda key, default=None: getattr(row, key, default)
    key = getter('physical_row_key')
    return [{'field': field, 'column': column, 'label': label, 'text': clean_text(getter(field)),
             'source_row_key': key, 'assertion_kind': 'SOURCE_STATEMENT',
             'visibility': 'diagnostic_only' if is_technical_note(getter(field)) else 'business'}
            for field, column, label in FIELDS if clean_text(getter(field)).casefold() not in PLACEHOLDERS]


def context_rows(rows, *, year):
    """Include explanations for completed and pending positions, with explicit period.

    Unassigned and future plan periods stay visible and labelled as such. Merely
    mentioning a future year in prose must not move an existing current-year row.
    """
    result = []
    for row in rows:
        entries = explanations(row)
        if not entries:
            continue
        result.append({'source_row_key': row.physical_row_key, 'business_id': row.source_row_no,
                       'grbs': row.grbs, 'subject': row.subject, 'planned_year': row.planned_year,
                       'planned_date': row.planned_date, 'actual_date': row.actual_date,
                       'method': row.method, 'in_report_year': row.planned_year == year,
                       'explanations': entries})
    return result


def enrich_recommendation(record, rows):
    """Enrich only proven current links; candidate number matches are diagnostics."""
    link = record.get('current_link') or {}
    uids = record.get('current_procurement_uids') or (
        link.get('procurement_uids') if link.get('status') == 'CONFIRMED' else []) or []
    current = [row for row in rows if row.procurement_uid and row.procurement_uid in uids
               and row.grbs == record.get('grbs')]
    record['current_explanations'] = context_rows(current, year=0)
    # Preserve the diagnostic result, but do not tell executives how to finish the engine.
    diagnostic = record.get('business_finding', '')
    record['diagnostic_finding'] = diagnostic
    state = record.get('dimensions') or {}
    if state.get('compliance_status') in {'IMPLEMENTED', 'NOT_IMPLEMENTED'}:
        business = diagnostic
    elif current:
        parts = []
        for row in current:
            number = f" № {row.source_row_no}" if row.source_row_no else ''
            plan = '.'.join(reversed(row.planned_date.split('-'))) if row.planned_date else 'не указана'
            fact = ('.'.join(reversed(row.actual_date.split('-'))) if row.actual_date else 'не внесена')
            parts.append(f"Текущий план{number}: {row.subject}. Способ — {row.method or 'не указан'}; "
                         f"плановая дата — {plan}; дата факта — {fact}.")
        business = ' '.join(parts)
    else:
        business = ''
    for item in record['current_explanations']:
        for entry in item['explanations']:
            if entry['visibility'] != 'business':
                continue
            business += (' ' if business else '') + f"{entry['label']}: «{entry['text']}»."
    record['business_finding'] = business
    # Material uncertainty remains in the typed dimensions and diagnostic protocol;
    # only established business results are emitted as a current status label.
    if state.get('compliance_status') not in {'IMPLEMENTED', 'NOT_IMPLEMENTED'}:
        record['semantic_status_ru'] = ''
    return record
