import pytest
from procurement_engine.department_directory import (
    ALIASES,
    APPROVED_PRIMARY_TITLE_ALIASES,
    DEPARTMENTS,
    department_id,
    department_label,
)
from procurement_engine.rule_catalog import DEFAULT_RULE_CATALOG


def test_every_reviewed_alias_has_one_identity_and_current_label():
    by_id = {entry["id"]: entry for entry in DEPARTMENTS}
    assert len(by_id) == 8
    for alias, canonical in ALIASES.items():
        assert department_id(alias) == canonical
        assert DEFAULT_RULE_CATALOG.normalize_grbs(alias) == canonical
        assert department_label(alias) == by_id[canonical]["shortName"]
    assert department_label("УФБР") == "УФ"
    assert department_label("УТХиРКИ") == "УДТХиБ"
    assert department_id("  уфбп   аемр ") == "УФБП"
    assert department_id("Управление финансов неизвестного округа") is None


def test_reviewed_primary_renames_derive_from_current_directory_labels():
    assert set(APPROVED_PRIMARY_TITLE_ALIASES.values()) == {"УФ", "УДТХиБ"}
    assert len(APPROVED_PRIMARY_TITLE_ALIASES) == 2


# Names captured from 4147 source procurement rows, not generated from the dictionary.
@pytest.mark.parametrize("source_name, expected", [('Управление архитектуры, градостроительства и земельных отношений администрации Елизовского муниципального округа', 'УАГЗО'), ('Управление делами администрации Елизовского муниципального округа', 'УД'), ('Управление дорожно-транспортного хозяйства и благоустройства администрации Елизовского муниципального округа', 'УДТХ'), ('Управление имущественных отношений администрации Елизовского муниципального округа', 'УИО'), ('Управление культуры, спорта и молодежной политики администрации Елизовского муниципального округа', 'УКСиМП'), ('Управление образования администрации Елизовского муниципального округа', 'УО'), ('Управление финансов администрации Елизовского муниципального округа', 'УФБП'), ('Управление экономического развития администрации Елизовского муниципального округа', 'УЭР')])
def test_current_source_names_remain_covered(source_name, expected):
    assert department_id(source_name) == expected


def test_master_fields_and_required_meanings_come_from_shared_profile():
    from procurement_engine.adapters import mapping_contract
    from procurement_engine.department_directory import (
        MASTER_FIELDS,
        validate_master_source_header,
    )
    header = [field['label'] for field in MASTER_FIELDS.values()]
    assert len(header) == 34
    assert mapping_contract()['AD'] == 'include_saving'
    assert MASTER_FIELDS['ECONOMY_FB']['unit'] == 'thousandRub'
    validate_master_source_header(header)
    header[33] = 'Рабочее примечание'
    validate_master_source_header(header)
    header[21] = 'Иной денежный показатель'
    with pytest.raises(ValueError, match='MASTER_SOURCE_REQUIRED_MEANING_CHANGED:V'):
        validate_master_source_header(header)
    header[21] = 'Цена договора вместо ФБ 2'
    with pytest.raises(ValueError, match='MASTER_SOURCE_REQUIRED_MEANING_CHANGED:V'):
        validate_master_source_header(header)
