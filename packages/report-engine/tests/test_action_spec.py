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
