"""Original wording supplies the action target; stale ledger labels do not."""
import pytest


def compile_text(text, ids=('42',)):
    from procurement_engine.action_spec import compile_action
    return compile_action(text, source_ids=ids)


@pytest.mark.parametrize('text', [
    'Рекомендуем позицию 42 вынести на ЭА.', 'Вынести на ЭА 42.',
    'Предлагаем провести позицию №42 способом электронного аукциона.',
    'Позицию 42 перевести на электронный аукцион.',
])
def test_method_target_is_extracted_from_unconditional_original(text):
    result = compile_text(text)
    assert result['type'] == 'CHANGE_METHOD_EA' and result['target_method'] == 'ЭА'


@pytest.mark.parametrize('text', [
    'Если появится финансирование, позицию 42 вынести на ЭА.',
    'Не рекомендуем позицию 42 вынести на ЭА.',
    'Рекомендуем позицию 42 вынести на ЭА при наличии финансирования.',
    'Позицию 42 перевести на ЭА. Но только при отсутствии иных предложений.',
    'Коллеги писали: «Позицию 42 перевести на ЭА».',
    'Рекомендуем позицию 43 вынести на ЭА.',
])
def test_conditional_quoted_negated_and_other_target_text_is_not_an_unconditional_action(text):
    assert compile_text(text) is None


@pytest.mark.parametrize('text,target', [
    ('Установить плановую сумму 17,50 тыс. руб.', '17.50'),
    ('Изменить плановую сумму до 17 500 руб.', '17.5'),
])
def test_amount_target_and_unit_come_from_text(text, target):
    from decimal import Decimal
    result = compile_text(text)
    assert result['type'] == 'CHANGE_AMOUNT'
    assert Decimal(result['target_amount_thousand']) == Decimal(target)


def test_date_target_does_not_require_an_additional_manual_target_field():
    result = compile_text('Перенести плановую дату на 15.11.2034.')
    assert result['target_planned_date'] == '2034-11-15'
    assert compile_text('Перенести плановую дату на 31.02.2034.') is None


def test_merge_is_only_complete_when_all_named_members_match():
    assert compile_text('Объединить позиции 42 и 43 в одну закупку.', ('42', '43'))['type'] == 'MERGE_PROCUREMENTS'
    assert compile_text('Объединить позиции 42 и 43 в одну закупку.', ('42',)) is None


@pytest.mark.parametrize('text', [
    'Вынести на ЭА 42 Поставка бумаги – 46,00 тыс. руб.',
    'Вынести на ЭА 42 Поставка бумаги на сумму 46,00 тыс. руб.',
    'Рекомендуем позицию 42 (Поставка бумаги) вынести на ЭА на сумму 46,00 тыс. руб.',
    'Вынести на ЭА 42 (Поставка бумаги) на сумму 46,00 тыс. руб. (прогнозная экономия – 5,00 тыс. руб.)',
    'Вынести на ЭА 42 (Поставка бумаги)',
])
def test_linked_description_is_not_an_unrecognised_new_action(text):
    from procurement_engine.action_spec import compile_action
    result = compile_action(text, source_ids=['42'], subjects=[('42', 'Поставка бумаги')], reference_grammar=True)
    assert result['type'] == 'CHANGE_METHOD_EA'
    assert result['source_text'] == text
    assert result['source_ids'] == ['42']


@pytest.mark.parametrize('text', [
    'Вынести на ЭА 42 Поставка бумаги – 46,00 тыс. руб. если появятся средства.',
    'Не рекомендуется вынести на ЭА 42 Поставка бумаги – 46,00 тыс. руб.',
    'Вынести на ЭА 42 Поставка бумаги и картриджей – 46,00 тыс. руб.',
    'Вынести на ЭА 42 Поставка бумаги – 46,00 тыс. руб. Отменить позицию 43.',
    'Вынести на ЭА 42/1 Поставка бумаги – 46,00 тыс. руб.',
    'Вынести на ЭА 42 Поставка бумаги – 46,00 тыс. руб. (только при финансировании)',
    'Коллеги писали «Вынести на ЭА 42 Поставка бумаги – 46,00 тыс. руб.»',
    'Вынести на единый ЭА 42,43 Поставка бумаги – 46,00 тыс. руб.',
])
def test_extra_conditions_targets_and_partial_subjects_stay_unclassified(text):
    from procurement_engine.action_spec import compile_action
    assert compile_action(text, source_ids=['42'], subjects=[('42', 'Поставка бумаги')], reference_grammar=True) is None


def test_nested_subject_and_nonempty_historical_v1_result_are_versioned():
    from procurement_engine.action_spec import compile_action
    text = 'Вынести на ЭА 42 (Химия (моющие средства)) на сумму 40,00 тыс. руб.'
    assert compile_action(text, source_ids=['42'], subjects=[('42', 'Химия (моющие средства)')], reference_grammar=True)['type'] == 'CHANGE_METHOD_EA'
    plain = 'Вынести на ЭА 42 Поставка бумаги – 46,00 тыс. руб.'
    assert compile_action(plain, source_ids=['42'], subjects=[('42', 'Поставка бумаги')]) is None
