"""Visible, attributable report limitations and concrete actions, never grey placeholders.

Reported business circumstances are not silently promoted to completion or payment.
An incomplete parser is engine work; it is not delegated as a vague user approval.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from dataclasses import asdict, is_dataclass
from decimal import Decimal
from urllib.parse import quote

from .normalize import clean_text, parse_date, to_decimal
from .source_context import explanations

CONTRACT = 'actionable-assurance-v2'

SOURCE_ISSUES = {
    'PLAN_TOTAL_MISMATCH': (('H', 'I', 'J', 'K'), 'Итог плана не равен сумме источников', 'Сверьте H:I:J с утверждённым планом и восстановите сумму в K. Не подгоняйте компоненты под ошибочный итог.'),
    'FACT_TOTAL_MISMATCH': (('V', 'W', 'X', 'Y'), 'Итог факта не равен сумме источников', 'Сверьте V:W:X с первичными документами и восстановите сумму в Y.'),
    'SAVING_TOTAL_MISMATCH': (('Z', 'AA', 'AB', 'AC'), 'Итог экономии не равен компонентам', 'Сверьте составляющие Z:AA:AB и формулу итога AC; флаг AD не заменяет проверку сумм.'),
    'INVALID_PLAN_DATE': (('N',), 'Некорректная плановая дата', 'Исправьте N на существующую календарную дату из утверждённого плана; не подставляйте дату автоматически.'),
    'INVALID_FACT_DATE': (('Q',), 'Некорректная дата факта', 'Исправьте Q по первичному документу; оставьте пустой, если факт ещё не состоялся.'),
    'METHOD_UNKNOWN_FOR_PLANNED_ROW': (('L',), 'Способ закупки не распознан', 'Укажите в L предусмотренный реестром способ закупки. Если корректный вариант уже указан, это ошибка словаря сопровождения, а не основание менять способ.'),
    'COMPLETION_DATE_WITH_ZERO_FACT': (('Q', 'V', 'W', 'X'), 'Дата факта внесена без фактической суммы', 'Проверьте, имеется ли сумма в документе. Внесите подтверждённые составляющие V:W:X; не заменяйте неизвестную сумму планом.'),
}
for label, column in [('PLAN_YEAR','P'), ('PLAN_QUARTER','O'), ('FACT_YEAR','S'), ('FACT_QUARTER','R')]:
    SOURCE_ISSUES['INVALID_' + label] = ((column,), 'Недопустимое значение периода',
        f'Проверьте {column}: год должен быть целым календарным годом, квартал — целым числом от 1 до 4. Если поле вычисляется, восстановите формулу от соответствующей даты.')
for code, columns in [('PLAN_YEAR_DATE_MISMATCH', ('N','P')), ('PLAN_QUARTER_DATE_MISMATCH', ('N','O')),
                      ('FACT_YEAR_DATE_MISMATCH', ('Q','S')), ('FACT_QUARTER_DATE_MISMATCH', ('Q','R'))]:
    SOURCE_ISSUES[code] = (columns, 'Период противоречит исходной дате',
        'Сверьте дату с первичным документом, затем восстановите расчёт периода из этой даты. Не исправляйте правильную дату ради совпадения с неверным периодом.')



def source_events(row):
    """Recognise complete explicit statements; keep the original field and quote."""
    result = []
    for entry in explanations(row):
        if entry['visibility'] != 'business':
            continue
        # A colon does not remove a condition, quotation, or historical frame.
        # Preserve the complete source text even when no event can be asserted.
        frame = clean_text(entry['text']).casefold()
        if re.search(r'\b(?:если|ранее|прежде|пример|допустим|возможно|предположим)\b|[«»"“”]', frame):
            continue
        for clause in re.split(r';|:|(?<!\d)\.(?!\d)', entry['text']):
            value = clean_text(clause).casefold().replace('ё', 'е')
            kind, target = None, None
            if re.fullmatch(r'(?:финансирование (?:отсутствует|не предусмотрено|не выделено)|(?:нет|отсутствует) финансировани[ея]|средства не выделены)', value):
                kind = 'NO_FUNDING_REPORTED'
            elif re.fullmatch(r'финансирование (?:выделено|подтверждено|предусмотрено|доведено)', value):
                kind = 'FUNDING_REPORTED'
            elif re.fullmatch(r'(?:закупка|процедура) отложена', value):
                kind = 'POSTPONED_REPORTED'
            elif match := re.fullmatch(r'закупка перенесена (?:в план|на) (\d{4})(?: год[ау]?)?', value):
                kind, target = 'PLAN_YEAR_CHANGE_REPORTED', int(match[1])
            elif (match := re.fullmatch(r'(?:договор|контракт) заключен (\d{2}\.\d{2}\.\d{4})', value)) and (target := parse_date(match[1])):
                kind = 'CONTRACT_DATE_REPORTED'
            if kind:
                result.append({'kind': kind, 'target': target, 'field': entry['field'],
                    'column': entry['column'], 'quote': clean_text(clause),
                    'source_text': entry['text'], 'evidence_kind': 'SOURCE_STATEMENT'})
    return result


def _location(row, column, sources):
    source = next((s for s in sources if s.get('provider_id') == row.get('source_id')
                   and s.get('sheet') == row.get('sheet_name')), {})
    number = row.get('row_number')
    a1 = f'{column}{number}' if type(number) is int and number > 0 else None
    provider, sheet_id = row.get('source_id'), source.get('sheet_id')
    url = (f'https://docs.google.com/spreadsheets/d/{quote(str(provider), safe="")}/edit#gid={sheet_id}&range={a1}'
           if provider and type(sheet_id) is int and a1 else None)
    return {'source_id': provider, 'sheet': row.get('sheet_name'), 'sheet_id': sheet_id,
            'row': number, 'column': column, 'a1': a1, 'url': url,
            'subject': row.get('subject'), 'business_id': row.get('source_row_no')}


def _signal(code, *, row=None, rec=None, sources=(), columns=(), owner_kind='SOURCE_OWNER',
            title, cause, effect, action, resolved_when, severity='needs_attention'):
    row, rec = row or {}, rec or {}
    identity = [code, row.get('physical_row_key'), rec.get('recommendation_id'), list(columns)]
    return {'signal_id': 'SIG-' + hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest(),
            'code': code, 'severity': severity, 'owner_kind': owner_kind,
            'owner': row.get('grbs') or rec.get('grbs') if owner_kind == 'SOURCE_OWNER' else 'Сопровождение генератора',
            'user_action_required': owner_kind == 'SOURCE_OWNER',
            'title': title, 'cause': cause, 'report_effect': effect, 'action': action,
            'resolved_when': resolved_when, 'recommendation_id': rec.get('recommendation_id'),
            'source_row_key': row.get('physical_row_key'),
            'locations': [_location(row, column, sources) for column in columns]}


ENGINE_LINK_CAUSES = {
    'ORIGIN_UNPROVEN': 'Оригинал исторической рекомендации не прочитан или его происхождение не прошло проверку.',
    'TEXT_REFERENCE_MISSING': 'Обработчик не извлёк номера и полные предметы закупок из оригинального текста.',
    'PERIOD_EVIDENCE_REQUIRED': 'Обработчик не разделил исходный и целевой периоды исторической рекомендации.',
    'CURRENT_EVIDENCE_MISSING': 'Не найдено однозначное соответствие оригинала текущей закупке с постоянной историей.',
    'GROUP_EVIDENCE_REQUIRED': 'Для групповой рекомендации не установлены все исходные участники.',
    'AMBIGUOUS': 'Найдено несколько соответствий; выбор только по номеру или цене недопустим.',
}


def assess_automation(model, sources=(), *, legacy_scope=False):
    actions, observations = [], []
    for value in model.get('details', []):
        row = asdict(value) if is_dataclass(value) else value
        events = source_events(row)
        if events:
            observations.append({'source_row_key': row.get('physical_row_key'), 'events': events})
        facts = sum((to_decimal(row.get(field)) for field in ('fact_fb', 'fact_kb', 'fact_mb')), Decimal(0))
        if facts != 0 and not row.get('actual_date'):
            actions.append(_signal('FACT_MONEY_WITHOUT_DATE', row=row, sources=sources, columns=('Q',),
                title='Фактическая сумма внесена без даты факта',
                cause=f'В V:W:X внесено {facts} тыс. руб., а Q не содержит дату.',
                effect='Сумма сохраняется как денежный факт, но не увеличивает число завершённых позиций.',
                action='Проверьте первичный документ: для состоявшейся закупки внесите дату факта в Q. '
                       'Если сумма относится к плану или прогнозу, исправьте фактические суммы V:W:X. Не подставляйте сегодняшнюю дату.',
                resolved_when='В источнике появилась подтверждённая дата факта либо исправлены фактические суммы.'))
        funding = [event for event in events if event['kind'] in {'FUNDING_REPORTED', 'NO_FUNDING_REPORTED'}]
        if len({event['kind'] for event in funding}) > 1:
            actions.append(_signal('CONFLICTING_FUNDING_STATEMENTS', row=row, sources=sources,
                columns=tuple(dict.fromkeys(event['column'] for event in funding)),
                title='Пояснения противоречат друг другу по финансированию',
                cause='Одно пояснение сообщает об отсутствии финансирования, другое — о его наличии.',
                effect='В отчёте сохраняются оба сообщения с их авторами; одно не выдаётся за более новое без основания.',
                action='Укажите актуальное положение и дату изменения в соответствующем комментарии; явно пометьте прежнее сообщение как утратившее актуальность.',
                resolved_when='В текущих пояснениях нет противоположных утверждений об одном состоянии.'))
        for event in events:
            if event['kind'] == 'PLAN_YEAR_CHANGE_REPORTED' and event['target'] != row.get('planned_year'):
                actions.append(_signal('PLAN_YEAR_STATEMENT_CONFLICT', row=row, sources=sources,
                    columns=(event['column'], 'N', 'P'), title='Сообщён перенос, но плановый период не изменён',
                    cause=f'Пояснение указывает {event["target"]} год, структурированный план — {row.get("planned_year") or "год не указан"}.',
                    effect='Комментарий не перемещает закупку в другой год расчёта; разница отражается отдельно.',
                    action='Уточните, утверждён ли перенос. Для утверждённого переноса исправьте плановую дату N; проверьте пересчёт года P. Для предложения обозначьте его в комментарии как предложение.',
                    resolved_when='Структурированный период согласован с сообщённым переносом либо комментарий больше не утверждает состоявшееся изменение.'))
        contract_dates = [event for event in events if event['kind'] == 'CONTRACT_DATE_REPORTED']
        if contract_dates and any(event['target'] != row.get('actual_date') for event in contract_dates):
            actions.append(_signal('FACT_DATE_STATEMENT_CONFLICT', row=row, sources=sources,
                columns=tuple(dict.fromkeys(['Q', *[event['column'] for event in contract_dates]])),
                title='Комментарий о заключении договора не согласован с датой факта',
                cause='В пояснении указана дата заключения договора; Q пусто или содержит другую дату.',
                effect='Комментарий сохраняется как сообщение источника, но не заменяет дату факта при расчёте.',
                action='Сверьте дату с подписанным документом. Исправьте Q либо уточните сообщение, если оно относится к другому событию или ещё не подтверждено.',
                resolved_when='Дата факта и действующее сообщение согласованы с первичным документом.'))
    # Unhandled validation findings must never disappear behind a green automation label.
    # Known raw-cell errors are source tasks; parser/identity failures remain engine work.
    for issue in model.get('issues', []):
        code = issue.get('code', 'UNKNOWN')
        if code in {'MONETARY_FACT_WITHOUT_COMPLETION_DATE', 'RECOMMENDATION_LINK_REVIEW_REQUIRED',
                    'IDENTITY_REVIEW_REQUIRED', 'RECOMMENDATION_LINK_UNCONFIRMED', 'IDENTITY_CONTINUITY_UNCONFIRMED'}:
            continue  # Reconstructed more specifically from primary rows/records below.
        context = issue.get('context') or {}
        row = next((item for item in model.get('details', [])
                    if item.get('physical_row_key') == context.get('row_key')), None)
        if row is None and context.get('row'):
            row = {'source_id': context.get('source_id'), 'sheet_name': context.get('sheet'),
                   'row_number': context.get('row'), 'source_row_no': context.get('procurement_id'),
                   'grbs': context.get('grbs'), 'physical_row_key': context.get('row_key')}
        spec = SOURCE_ISSUES.get(code)
        if spec is not None:
            columns, title, instruction = spec
            actions.append(_signal(code, row=row, sources=sources, columns=columns,
                severity='blocks_release' if issue.get('severity') == 'ERROR' else 'needs_attention',
                title=title, cause=title,
                effect='Новый выпуск заблокирован до согласования исходных полей.' if issue.get('severity') == 'ERROR'
                       else 'Исходное ограничение сохранено; оно не подменяется предположением.',
                action=instruction, resolved_when='Повторное чтение первичного реестра больше не воспроизводит эту ошибку.'))
        elif issue.get('severity') in {'ERROR', 'WARN', 'WARNING', 'BLOCKER'}:
            actions.append(_signal(code, row=row, sources=sources, owner_kind='ENGINE',
                severity='blocks_release' if issue.get('severity') in {'ERROR', 'BLOCKER'} else 'needs_attention',
                title='Не завершена проверка данных генератором', cause='Код проверки: ' + str(code) + '.',
                effect='Полная автоматическая проверка этого участка не подтверждена.',
                action='От вас исправление кода или выбор технической связи не требуется. Сопровождение должно разобрать сохранённую попытку и устранить причину; до этого нельзя заявлять полное покрытие.',
                resolved_when='Повторная проверка участка проходит по исходным доказательствам.'))
    # An excluded source observation is not a current procurement needing
    # history repair. Keep it visible in diagnostics without falsely assigning
    # engine work. Missing inclusion flag is conservatively still included.
    nonprocurement_uid_gaps = sum(
        row.get('included') is False and not row.get('procurement_uid')
        for row in model.get('details', []))
    for row in model.get('details', []):
        if not row.get('procurement_uid') and (legacy_scope or row.get('included') is not False):
            actions.append(_signal('ENGINE_IDENTITY_CONTINUITY', row=row, sources=sources, columns=('A',), owner_kind='ENGINE',
                title='История закупки не связана однозначно',
                cause='Текущая строка сохранена, но её постоянная идентичность не установлена.',
                effect='Строка учитывается в текущем расчёте; изменение и историческая рекомендация не приписываются ей без доказательства.',
                action='От вас переписывать отчёт не требуется. Сопровождение должно сопоставить сохранённые версии строки и исключить дубликаты; вопрос владельцу нужен только при действительно неразличимых исходных записях.',
                resolved_when='Восстановлено однозначное продолжение закупки в сохранённых версиях.'))
    active = [r for r in model.get('recommendation_records', []) if r.get('active_in_current_slice')]
    links, semantics = Counter(), Counter()
    for record in active:
        link = (record.get('current_link') or {}).get('status', 'ORIGIN_UNPROVEN')
        links[link] += 1
        compliance = (record.get('dimensions') or {}).get('compliance_status', 'UNKNOWN')
        semantics[compliance] += 1
        if link != 'CONFIRMED' and not record.get('current_procurement_uids'):
            cause = (('Автоматическая связь и датированное подтверждение указывают на '
                      'разные закупки; до независимой проверки нельзя выбрать одну из них.')
                     if (record.get('current_link') or {}).get('conflict_kind')
                        == 'AUTOMATIC_REVIEWED_UID_DISAGREEMENT'
                     else ENGINE_LINK_CAUSES.get(link, 'Не завершена проверка текущей исторической связи.'))
            actions.append(_signal('ENGINE_RECOMMENDATION_LINK', rec=record, owner_kind='ENGINE',
                title='Генератор не завершил сопоставление исторической рекомендации', cause=cause,
                effect='По этой рекомендации не заявляется текущий результат исполнения.',
                action='От вас подтверждение связи не требуется. Сопровождение должно восстановить исходные доказательства и сопоставить все доступные записи; неоднозначность нельзя снимать по одному номеру.',
                resolved_when='Оригинал и однозначные текущие участники установлены по сохранённым доказательствам.'))
        elif compliance == 'UNKNOWN':
            actions.append(_signal('ENGINE_RECOMMENDATION_ACTION', rec=record, owner_kind='ENGINE',
                title='Действие рекомендации ещё не получило доказанного результата',
                cause='Участники установлены, но исходная формулировка или доказательство действия не покрыты проверенным правилом.',
                effect='Наличие текущей закупки не подменяет исполнение рекомендации.',
                action='От вас перевод рекомендации в техническую форму не требуется. Сопровождение должно разобрать исходное действие и проверить его по соответствующим полям и истории.',
                resolved_when='Для исходного действия определено проверяемое условие и получен результат по источникам.'))
    actions = list({item['signal_id']: item for item in actions}.values())
    user_count = sum(item['user_action_required'] for item in actions)
    engine_count = sum(item['owner_kind'] == 'ENGINE' for item in actions)
    outcome = {'contract': 'actionable-assurance-v1' if legacy_scope else CONTRACT,
        'fully_automated': not actions,
        'user_action_count': user_count, 'engine_action_count': engine_count,
        'active_recommendations': len(active), 'link_status_counts': dict(sorted(links.items())),
        'action_status_counts': dict(sorted(semantics.items())),
        'source_observations': observations, 'actions': actions,
        'meaning': 'Arithmetic verification does not imply complete semantic automation.'}
    if not legacy_scope:
        outcome['nonprocurement_identity_observations'] = nonprocurement_uid_gaps
    return outcome
