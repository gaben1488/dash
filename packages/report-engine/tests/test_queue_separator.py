import pytest
from procurement_engine.procedures import (
    iter_operational_rows,
    operational_cells,
    validate_operational_view,
)
from test_procedure_clock import master, queue


@pytest.mark.parametrize('label', ['Уровень', 'Тип задачи'])
def test_visible_n_separator_preserves_closed_records_and_source_offsets(label):
    active = master('ЭА1-26', 'Объявлена')
    closed = master('ЭА2-26', 'Состоялась', 'Состоялась', action='Уточнить даты итогов')
    headers = [''] * 14 + [label, 'Код', 'Действие', 'Управление', 'Заказчик',
                           'Предмет', 'НМЦК', 'Стадия', 'Сигнал', 'Открыть']
    checks = ['Проверить', closed[0], closed[23], '', '', closed[6], 0,
              closed[22], closed[24], 'В реестр']
    view = [[], headers, queue(active) + [''] * 4 + checks]
    assert validate_operational_view([active, closed], view, as_of='2026-09-30') == []
    records = list(iter_operational_rows(view))
    assert [(block, number, offset) for block, number, offset, _ in records] == [
        ('active', 3, 0), ('closed_quality', 3, 14)]
    assert operational_cells(records[1][3], 14)[3] == closed[0]
    view[2][19] = 'Подменённый предмет'
    assert 'PROCEDURE_QUEUE_RECORD_MISMATCH' in {
        issue.code for issue in validate_operational_view([active, closed], view, as_of='2026-09-30')}
