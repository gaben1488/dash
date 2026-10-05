from io import BytesIO

from openpyxl import Workbook
from procurement_engine.master_revision_history import (
    exact_revisions,
    probe_exact_master_revisions,
)
from procurement_engine.raw_pipeline import header_hash


def xlsx_bytes(sheet_name, rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = sheet_name
    for row in rows:
        sheet.append(row)
    stream = BytesIO()
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


class RevisionClient:
    def __init__(self, revisions, exports):
        self.revisions = revisions
        self.exports = exports

    def _get(self, url, params=None):
        if url.endswith('/revisions'):
            return {'revisions': self.revisions}
        revision_id = url.rsplit('/', 1)[-1]
        revision = next(item for item in self.revisions if item['id'] == revision_id)
        return {'id': revision_id, 'modifiedTime': revision['modifiedTime'],
                'exportLinks': {
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
                        'https://example.invalid/' + revision_id,
                }}

    def _get_bytes(self, url):
        return self.exports[url.rsplit('/', 1)[-1]]


def source_contract(rows):
    return {
        'source_id': 'MASTER_UER',
        'provider_id': 'book-uer',
        'role': 'master',
        'sheet': 'ВСЕ',
        'sheet_id': 0,
        'columns': 4,
        'header_rows': 2,
        'schema_fingerprint': header_hash(rows, 2),
        'units': 'thousand_rubles',
        'grbs': 'УЭР',
    }


def test_exact_revision_date_uses_product_timezone_and_never_nearest():
    client = RevisionClient([
        {'id': 'before', 'modifiedTime': '2026-09-10T11:59:59Z'},
        {'id': 'exact-a', 'modifiedTime': '2026-09-10T12:00:00Z'},
        {'id': 'exact-b', 'modifiedTime': '2026-09-11T11:59:59Z'},
        {'id': 'after', 'modifiedTime': '2026-09-11T12:00:00Z'},
    ], {})
    assert [item['id'] for item in exact_revisions(
        client, 'book-uer', '11.09.2026', timezone_name='Asia/Kamchatka'
    )] == ['exact-a', 'exact-b']


def test_probe_reads_every_exact_revision_and_validates_registered_schema():
    rows = [['group'], ['№', 'ГРБС', 'Учреждение', 'Предмет'], [1, 'УЭР', 'МКУ', 'Бумага']]
    content = xlsx_bytes('ВСЕ', rows)
    client = RevisionClient([
        {'id': 'r1', 'modifiedTime': '2026-09-11T01:00:00Z'},
        {'id': 'r2', 'modifiedTime': '2026-09-11T05:00:00Z'},
    ], {'r1': content, 'r2': content})
    registry = {'sources': [source_contract(rows)]}
    ledger = [{'recommendation_id': 'R1', 'grbs': 'УЭР', 'recommendation_text': 'x',
               'source_procurement_ids': ['1'], 'active_in_current_slice': True,
               'origin_evidence': [{'document_date': '11.09.2026'}]}]
    result = probe_exact_master_revisions(registry, ledger, client)
    assert result['requested_exact_days'] == 1
    assert result['days_with_exact_revision'] == 1
    assert result['days_with_readable_schema'] == 1
    assert result['exact_revisions_read'] == 2
    assert result['by_grbs']['УЭР'] == {
        'requested_days': 1, 'exact_days': 1, 'readable_days': 1,
        'rejected_days': 0, 'exact_revisions': 2, 'source_registered': True,
    }


def test_probe_does_not_substitute_neighbor_day():
    rows = [['group'], ['№', 'ГРБС', 'Учреждение', 'Предмет'], [1, 'УЭР', 'МКУ', 'Бумага']]
    client = RevisionClient([
        {'id': 'r1', 'modifiedTime': '2026-09-10T01:00:00Z'},
        {'id': 'r2', 'modifiedTime': '2026-09-12T01:00:00Z'},
    ], {})
    registry = {'sources': [source_contract(rows)]}
    ledger = [{'recommendation_id': 'R1', 'grbs': 'УЭР', 'recommendation_text': 'x',
               'source_procurement_ids': ['1'], 'active_in_current_slice': True,
               'origin_evidence': [{'document_date': '11.09.2026'}]}]
    result = probe_exact_master_revisions(registry, ledger, client)
    assert result['days_with_exact_revision'] == 0
    assert result['days_with_readable_schema'] == 0


def test_probe_rejects_historical_schema_drift():
    registered = [['group'], ['№', 'ГРБС', 'Учреждение', 'Предмет'], [1, 'УЭР', 'МКУ', 'Бумага']]
    changed = [['group'], ['№', 'ГРБС', 'Учреждение', 'Другой заголовок'], [1, 'УЭР', 'МКУ', 'Бумага']]
    client = RevisionClient(
        [{'id': 'r1', 'modifiedTime': '2026-09-11T01:00:00Z'}],
        {'r1': xlsx_bytes('ВСЕ', changed)},
    )
    registry = {'sources': [source_contract(registered)]}
    ledger = [{'recommendation_id': 'R1', 'grbs': 'УЭР', 'recommendation_text': 'x',
               'source_procurement_ids': ['1'], 'active_in_current_slice': True,
               'origin_evidence': [{'document_date': '11.09.2026'}]}]
    result = probe_exact_master_revisions(registry, ledger, client)
    assert result['days_with_exact_revision'] == 1
    assert result['days_with_readable_schema'] == 0
    assert result['days_rejected_schema'] == 1
    assert result['by_grbs']['УЭР']['rejected_days'] == 1
