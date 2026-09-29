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
