"""Temporary materialization verifier; contains public code and synthetic tests only."""
import hashlib
import sys
from pathlib import Path

EXPECTED = {
    'pyproject.toml': 'fd17a6a1f0a2e2237cb306269c25a166de8ce866b0290c7d24ae62d863f55696',
    'src/procurement_engine/__init__.py': 'eb336386214f1c31ded55de8895a0894a7d32af95ffd5888d1b53263dc785f4f',
    'src/procurement_engine/adapters.py': 'f0aae8698a8018b5636b15e7785e621aef78a6d4cee5e502ccf356dc747b2a20',
    'src/procurement_engine/deployment_diagnostics.py': '6a7efc680ef68420e332bd0510e123b4f21fc79943c74a8a6467c75bfdad49d4',
    'src/procurement_engine/docx_renderer.py': '2ca0620993ba2ae000faca6f829ad3ffc5e17fd91889f459563cb8db3dc84a68',
    'src/procurement_engine/google_adapter.py': 'f53f79fb91d99812db394c4e2aa667d60ad6a38c05eceafce13317ea7b715879',
    'src/procurement_engine/identity_store.py': 'ab8ab9664ec485faa3f12d27b6463f09bf093538285f9d28192e72be73209cad',
    'src/procurement_engine/independent_audit.py': 'ca1282cca89b33aedc1583c142999526b67a318da71a2716600a0b1fd0d98c89',
    'src/procurement_engine/normalize.py': '1b5d3f2eca1c9b77464ef45e887bfb13192be30ca2aed326e87675558a288f07',
    'src/procurement_engine/publication_history.py': '65dd6f1ee5516ac20776d5908b8df9dfcac55efc6f4263ff3fe40e4ec0115b91',
    'src/procurement_engine/publication_store.py': 'c07c1c7e9ad975a6aa6f48b66eba6833c085730908491ed9c665539095ca9b4c',
    'src/procurement_engine/qa.py': '6043da7c2f8f681998ef6c4a51a7cb74f2b3de329c479d0a2017c8dda09c1b84',
    'src/procurement_engine/raw_pipeline.py': 'fa046934bbdda93fb95cddbfb10677a43ad350d592a19930292d2747f2117d08',
    'src/procurement_engine/recommendation_links.py': '4c852c4ca62a25e6604a8e53b644a0ce84353a1c628557779eebdf1b6ed55686',
    'src/procurement_engine/rehearsal.py': 'e0e67305e6e3557cc0bf534f5e48ebb20256f82a8b1f9a77b1a74174b3f31500',
    'src/procurement_engine/release_gates.py': '0eed0b6f3f9ee1b0f05d1c85f1a23ac50ff6010f5b04fd236e9df885b414b882',
    'src/procurement_engine/report_model.py': '14b5eebf55eec9546b19a96f652d0c0dcb406dcac76c6123c6563c329cb69891',
    'src/procurement_engine/runtime.py': 'a5c5d34c6738860c43846ceb0ee7629747b6daf8cd9aab099cecc22783d83cdb',
    'src/procurement_engine/runtime_inputs.py': '32c8bca8cb9711c6edca416335e5bffa910e1e24512645152e76f68766f1d86e',
    'src/procurement_engine/section_audit.py': '847db4520f8c46c2ffedea765033938f34df3748c272e80d9bd224f101d2e05a',
    'src/procurement_engine/source_contract.py': '0d7aaa5ee7d509300c503275c66530322123953bf2fe81ee7a11e0c3fec2ec55',
    'tests/test_recommendation_links.py': '42985685dfb59a0ae233bc5df3e03771ca34f3f12878e96a62985c6d7217da1f',
    'tests/test_universal_contract.py': '913bed569c8acf2da334ac66a9274f0f7df508c9f7c954cf1715aaae195f0e0b',
    'README.md': 'db8fc9a2aec8fe0eea5ec7106741918314909c002d34e2a5d3aa5c3697b5afb8',
}
root = Path('packages/report-engine')
if sys.argv[1:] == ['--check']:
    mismatches = {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
                  for name, wanted in EXPECTED.items()
                  if hashlib.sha256((root / name).read_bytes()).hexdigest() != wanted}
    assert not mismatches, mismatches
    print('EXACT_OFFLINE_SOURCE_MATCH=PASS')
    raise SystemExit(0)

path = root / 'src/procurement_engine/normalize.py'
path.write_text(path.read_text().replace('Accept a bounded finite whole number without rounding calendar periods.',
                                        'Accept a bounded calendar integer, without rounding or allocating huge integers.'))
path = root / 'tests/test_recommendation_links.py'
path.write_text(path.read_text() + '''

def test_complete_group_links_each_own_subject_amount_and_uid_without_claiming_merge():
    text = ('Объединить позиции 42, 43 в одну закупку. '
            'Позиция 42 (Поставка бумаги) на сумму 46,00 тыс. руб.; '
            'позиция 43 (Поставка картриджей) на сумму 17,00 тыс. руб.')
    second = replace(row(), source_row_no='43', procurement_id='43', subject='Поставка картриджей',
                     plan_mb=17, procurement_uid='PUR-second', row_number=5)
    result = resolve(recommendation(text), [row(), second])
    assert result['status'] == 'CONFIRMED'
    assert result['business_ids'] == ['42', '43']
    assert result['procurement_uids'] == ['PUR-synthetic', 'PUR-second']
    assert result['fulfillment'] == 'UNKNOWN'
    assert result['origin']['document_sha256']


@pytest.mark.parametrize('change', [{'plan_mb': 63}, {'subject': 'Другой предмет'},
    {'procurement_uid': None}, {'procurement_uid': 'PUR-synthetic'}])
def test_group_requires_every_member_not_combined_money_or_reused_identity(change):
    text = ('Объединить позиции 42, 43 в одну закупку. '
            'Позиция 42 (Поставка бумаги) на сумму 46,00 тыс. руб.; '
            'позиция 43 (Поставка картриджей) на сумму 17,00 тыс. руб.')
    second = replace(row(), source_row_no='43', subject='Поставка картриджей', plan_mb=17,
                     procurement_uid='PUR-second', row_number=5)
    assert resolve(recommendation(text), [row(), replace(second, **change)])['status'] != 'CONFIRMED'


def test_previous_single_only_link_contract_keeps_its_original_replay_result():
    from procurement_engine.raw_pipeline import review_recommendations

    text = ('Объединить позиции 42, 43 в одну закупку. '
            'Позиция 42 (Поставка бумаги) на сумму 46,00 тыс. руб.; '
            'позиция 43 (Поставка картриджей) на сумму 17,00 тыс. руб.')
    rec = recommendation(text); rec['active_in_current_slice'] = True
    second = replace(row(), source_row_no='43', subject='Поставка картриджей', plan_mb=17,
                     procurement_uid='PUR-second', row_number=5)
    old = review_recommendations([rec], [row(), second], 'snapshot', '30.09.2026',
        documents=TEST_DOCUMENTS, link_contract='verified-original-and-current-plan-v1')[0]
    assert old['current_link']['status'] == 'GROUP_EVIDENCE_REQUIRED'
    assert old['semantic_status'] == 'REVIEW_REQUIRED'
    new = review_recommendations([rec], [row(), second], 'snapshot', '30.09.2026',
        documents=TEST_DOCUMENTS, link_contract='verified-original-and-current-plan-v2')[0]
    assert new['current_link']['status'] == 'CONFIRMED'
    assert new['dimensions']['grouping_status'] == 'UNKNOWN'
''')
path = root / 'README.md'
text = path.read_text().replace('Код 0 означает успешную публикацию либо уже идущий запуск.',
                              'Код 0 означает успешную публикацию. Уже идущий запуск возвращает\nALREADY_RUNNING и код 2; существующий статус при этом не меняется.')
path.write_text(text + '''
## Конфигурируемый контракт rc9

`grbs_order` в закрытом реестре задаёт состав и порядок управлений; без него
сохраняется прежний состав из восьми. Пропавший источник не сокращает состав
автоматически. `header_rows` используется во всех стадиях, включая независимую
проверку и восстановление истории. Дробные периоды и невозможные даты отклоняются.

Контракт связей v2 подтверждает каждую позицию группы отдельно, только по полному
предмету, собственной сумме и постоянной идентичности. Это не доказательство
исполнения объединения. Сохранённые выпуски v1 повторно проверяются по старым
правилам. Новый выпуск имеет собственную версию правил и не переименовывает старый.

Работа сотрудника, расчётные определения, границы эвристики, эксплуатация,
резервирование и миграции описаны в [рабочем контракте](../../docs/report-engine-operating-contract.ru.md).
''')
