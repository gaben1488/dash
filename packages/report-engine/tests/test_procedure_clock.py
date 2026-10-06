from procurement_engine.procedures import validate_operational_view


def master(code, stage, result='', action='Действие'):
    row = [''] * 25
    row[0] = code; row[6] = 'Synthetic subject'; row[8] = '01.09.2026'
    row[9] = '20.09.2026'; row[11] = '30.09.2026'
    row[19] = result; row[22] = stage; row[23] = action
    return row


def queue(row, deadline='30.09.2026'):
    return [deadline, 0, row[23], row[0], '', '', row[6], 0, row[22], row[24]]


def test_independent_clock_detects_stale_stage_on_next_day_without_source_edits():
    row = master('ЭА1-26', 'Объявлена')
    assert validate_operational_view([row], [queue(row)], as_of='2026-09-30') == []
    issues = validate_operational_view([row], [queue(row)], as_of='2026-10-01')
    assert 'PROCEDURE_STAGE_DATE_MISMATCH' in {i.code for i in issues}


def test_closed_quality_is_separate_and_missing_active_row_blocks():
    active = master('ЭА1-26', 'Объявлена')
    closed = master('ЭА2-26', 'Состоялась', 'Состоялась')
    view = [queue(active), ['Данные по закрытым строкам'], queue(closed)]
    assert validate_operational_view([active, closed], view, as_of='2026-09-30') == []
    wrong = [queue(active), queue(closed)]
    assert 'PROCEDURE_QUEUE_COVERAGE_MISMATCH' in {
        i.code for i in validate_operational_view([active, closed], wrong, as_of='2026-09-30')}
    assert 'PROCEDURE_QUEUE_COVERAGE_MISMATCH' in {
        i.code for i in validate_operational_view([active], [], as_of='2026-09-30')}


def test_share_rows_do_not_create_attempts_and_queue_edits_are_detected():
    active = master('ЭА1-26', 'Объявлена')
    share = master('ЭА1-26', ''); share[1] = 'доля'
    assert validate_operational_view([active, share], [queue(active)], as_of='2026-09-30') == []
    wrong = queue(active); wrong[6] = 'Different procurement'
    assert 'PROCEDURE_QUEUE_RECORD_MISMATCH' in {
        i.code for i in validate_operational_view([active], [wrong], as_of='2026-09-30')}


def test_parallel_queues_keep_closed_header_fixed_when_active_grows():
    active = [master(f'ЭА{i}-26', 'Объявлена') for i in range(1, 122)]
    closed = master('ЭА200-26', 'Состоялась', 'Состоялась', action='')
    closed[24] = 'Проверить: неоднозначный ИНН — S'
    closed_row = queue(closed); closed_row[2] = 'Разобрать замечания'
    title = ['Процедуры в работе'] + [''] * 11 + ['Данные по закрытым строкам']
    view = [title, ['Дата ориентира']] + [queue(row) + [''] * 2 + (closed_row if i == 0 else []) for i, row in enumerate(active)]
    assert validate_operational_view([*active, closed], view, as_of='2026-09-30') == []
    view[2][18] = 'Подменённый предмет'
    assert 'PROCEDURE_QUEUE_RECORD_MISMATCH' in {
        issue.code for issue in validate_operational_view([*active, closed], view, as_of='2026-09-30')}


def test_parallel_queue_includes_missing_dates_but_not_reference_notes():
    incomplete = master('ЭЕП29-26', 'Состоялась', 'Состоялась', action='')
    incomplete[24] = 'Неполно: Нет даты итогов — L'
    reference = master('ЭА230-26', 'Состоялась', 'Состоялась', action='')
    reference[24] = 'Справка: Протокол с отклонениями — C'
    title = ['Процедуры в работе'] + [''] * 11 + ['Данные по закрытым строкам']
    closed = queue(incomplete); closed[2] = 'Разобрать замечания'
    assert validate_operational_view([incomplete, reference], [title, [''] * 12 + closed], as_of='2026-09-30') == []


def test_current_closed_checks_without_deadlines_keep_every_physical_row():
    from procurement_engine.procedures import iter_operational_rows

    active = master('ЭА1-26', 'Объявлена')
    closed = master('ЭА2-26', 'Состоялась', 'Состоялась', action='')
    closed[24] = 'Неполно: Нет даты итогов — L'
    title = ['Очередь на сегодня'] + [''] * 12 + ['Проверки данных закрытых процедур']
    headers = ['Срок', 'Дней до срока', 'Действие', 'Код', 'Управление', 'Заказчик',
               'Предмет', 'НМЦК', 'Стадия', 'Сигнал'] + [''] * 3 + [
               'Уровень', 'Код', 'Действие', 'Управление', 'Заказчик', 'Предмет',
               'НМЦК', 'Стадия', 'Сигнал', 'Открыть']
    checks = ['Неполно', closed[0], 'Уточнить даты итогов', '', '', closed[6], 0,
              closed[22], closed[24], 'В реестр']
    closed[23] = checks[2]
    view = [title, headers, queue(active) + [''] * 3 + checks]
    assert validate_operational_view([active, closed], view, as_of='2026-09-30') == []
    records = list(iter_operational_rows(view))
    assert [(block, number, offset) for block, number, offset, _ in records] == [
        ('active', 3, 0), ('closed_quality', 3, 13)]
    assert records[1][3] == checks
    view[2][18] = 'Другой предмет'
    assert 'PROCEDURE_QUEUE_RECORD_MISMATCH' in {
        issue.code for issue in validate_operational_view([active, closed], view, as_of='2026-09-30')}
    view[2] = view[2][:13]
    assert 'PROCEDURE_QUEUE_COVERAGE_MISMATCH' in {
        issue.code for issue in validate_operational_view([active, closed], view, as_of='2026-09-30')}


def test_current_queue_does_not_turn_application_dates_into_publication_deadlines():
    closed = master('ЭА2-26', 'Состоялась', 'Состоялась', action='')
    closed[24] = 'Проверить: неоднозначный ИНН — S'
    application = master('ЭА1-26', 'Заявка в уполномоченном органе', action='Разместить извещение')
    application[9] = ''
    repair = master('ЭА3-26', 'Объявлена', action='Исправить: сумму')
    headers = [''] * 13 + ['Уровень', 'Код', 'Действие', 'Управление', 'Заказчик',
                          'Предмет', 'НМЦК', 'Стадия', 'Сигнал', 'Открыть']
    checks = ['Проверить', closed[0], 'Проверить данные', '', '', closed[6], 0,
              closed[22], closed[24], 'В реестр']
    view = [headers, queue(application, '') + [''] * 3 + checks, queue(repair, '')]
    assert validate_operational_view([application, repair, closed], view, as_of='2026-09-30') == []
    view[1][0] = application[8]
    assert 'PROCEDURE_QUEUE_RECORD_MISMATCH' in {
        issue.code for issue in validate_operational_view([application, repair, closed], view, as_of='2026-09-30')}
