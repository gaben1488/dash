"""Regression cases found by production and archive-path review."""
import pytest
from procurement_engine.recommendation_links import (
    _exact_subject_reference,
    _subject_amounts,
)


@pytest.mark.parametrize('number', [None, '', '   '])
def test_missing_business_number_is_not_a_regex_or_identity(number):
    text = 'вынести на эа 42 поставка бумаги на сумму 46,00 тыс. руб.'
    assert _subject_amounts(text, 'Поставка бумаги', number) == set()
    assert _exact_subject_reference(text, 'Поставка бумаги', number) is False


def test_a_new_patch_version_cannot_drop_the_domain_contract(tmp_path):
    from procurement_engine.publication_store import PublicationError
    from test_business_document_contract import build_case, publish, rewrite

    model, root, _ = build_case(tmp_path)
    # Re-sign the projections as a faulty producer could, not merely edit a hash.
    model['contract'].pop('report_model_version')
    rewrite(root, model)
    with pytest.raises(PublicationError, match='DOMAIN_RELEASE_CONTRACT_FAILED'):
        publish(root)
