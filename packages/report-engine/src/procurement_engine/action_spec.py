"""Compile bounded original action statements; never infer targets from a status label.

A complete recognised imperative is required. Conditional, compound or quoted
wording is left unclassified rather than interpreted as an unconditional demand.
This compiler operates on source text, not free-form output from a language model.
"""
from __future__ import annotations

import re
from decimal import Decimal

from .normalize import clean_text, normalize_id, parse_date

CONTRACT = 'original-action-v1'
NUMBER = r'\d+(?:[/-]\d+)?'
PREFIX = r'(?:(?:рекомендуем|рекомендуется|предлагаем|предлагается)\s+)?'
METHOD = r'(?:эа|электронный\s+аукцион|электронного\s+аукциона)'
POSITION = rf'(?:позици(?:ю|я)\s*[№#]?\s*)?({NUMBER})'
AMOUNT = r'(\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)?)\s*(тыс\.?\s*)?руб(?:лей|ля|ль)?\.?'


def compile_action(text, *, source_ids, subjects=()):
    """Return a typed goal and an exact source text; None never means noncompliance."""
    value = clean_text(str(text or '').replace('№', '#')).casefold().replace('ё', 'е')
    wanted = {normalize_id(item) for item in source_ids}
    if not wanted or None in wanted or not value:
        return None
    # Strip only exact, independently matched reference descriptions, not other
    # prose (which may contain an exception or a second requested action).
    for business_id, subject in subjects:
        if normalize_id(business_id) not in wanted:
            continue
        name = re.escape(clean_text(subject).casefold().replace('ё', 'е'))
        suffix = rf'\s*\({name}\)\s+на\s+сумму\s+{AMOUNT}'
        value = re.sub(suffix, '', value)
        description = (rf'позиция\s*[№#]?\s*{re.escape(str(business_id))}\s*\({name}\)'
                       rf'(?:\s+на\s+сумму\s+{AMOUNT})?\s*[.;]?')
        value = re.sub(description, '', value)
    value = ' '.join(value.strip(' ;.').split())
    base = {'contract': CONTRACT, 'source_text': clean_text(text), 'source_ids': sorted(wanted)}

    patterns = [
        rf'{PREFIX}позицию\s*[№#]?\s*({NUMBER})\s+(?:вынести|перевести|провести)\s+на\s+{METHOD}',
        rf'{PREFIX}(?:вынести|перевести|провести)\s+{POSITION}\s+(?:на|способом)\s+{METHOD}',
        rf'{PREFIX}(?:вынести|перевести|провести)\s+на\s+{METHOD}\s+{POSITION}',
    ]
    for pattern in patterns:
        match = re.fullmatch(pattern, value)
        if match and {normalize_id(match[1])} == wanted:
            return {**base, 'type': 'CHANGE_METHOD_EA', 'target_method': 'ЭА'}
    match = re.fullmatch(PREFIX + rf'объединить\s+позиции\s+({NUMBER}(?:\s*,\s*{NUMBER}|\s+и\s+{NUMBER})+)\s+в\s+(?:одну|единую)\s+закупку', value)
    if match and {normalize_id(x) for x in re.findall(NUMBER, match[1])} == wanted:
        return {**base, 'type': 'MERGE_PROCUREMENTS'}
    match = re.fullmatch(PREFIX + r'(?:установить\s+плановую\s+сумму\s+|изменить\s+плановую\s+сумму\s+до\s+)' + AMOUNT, value)
    if match:
        amount = Decimal(match[1].replace(' ', '').replace('\u00a0', '').replace(',', '.'))
        amount = amount if match[2] else amount / 1000
        return {**base, 'type': 'CHANGE_AMOUNT', 'target_amount_thousand': format(amount, 'f')}
    match = re.fullmatch(PREFIX + r'перенести\s+плановую\s+дату\s+на\s+(\d{2}\.\d{2}\.\d{4})', value)
    if match and (day := parse_date(match[1])):
        return {**base, 'type': 'MOVE_PLANNED_DATE', 'target_planned_date': day}
    return None
