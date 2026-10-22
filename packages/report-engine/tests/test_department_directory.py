import json
from pathlib import Path

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


def test_known_master_binding_cannot_skip_the_single_profile_after_provider_change():
    from procurement_engine.department_directory import MASTER_FIELDS
    from procurement_engine.google_adapter import (
        GoogleReadError,
        GoogleSheetSourceAdapter,
    )

    header = [field['label'] for field in MASTER_FIELDS.values()]
    header[21] = 'Другая сумма вместо ФБ 2'

    class Source:
        def grid(self, _provider, _sheet_id):
            return {'title': 'ВСЕ', 'gridProperties': {'columnCount': 34, 'rowCount': 3}}

        def values(self, _provider, _title, start, end, _columns):
            return [[], [], header][start - 1:end]

    registry_source = {
        'source_id': 'UER', 'provider_id': 'new-reviewed-provider',
        'sheet_id': 1344447365, 'sheet': 'ВСЕ', 'role': 'master',
        'columns': 34, 'header_rows': 3, 'units': 'thousand_rub',
        'schema_fingerprint': '0' * 64,
    }
    with pytest.raises((GoogleReadError, ValueError), match='MASTER_SOURCE_REQUIRED_MEANING_CHANGED:V'):
        GoogleSheetSourceAdapter(registry_source, Source()).read_payload()

    # The override itself is not the reason for failure: a correct header
    # still passes the one shared required-meaning validator.
    header[21] = MASTER_FIELDS['FB_FACT']['label']
    payload = GoogleSheetSourceAdapter(registry_source, Source()).read_payload()
    assert payload.source_id == 'UER'


def test_eight_actual_master_headers_are_accepted_by_the_one_shared_profile():
    from procurement_engine.department_directory import (
        MASTER_SOURCE_PROFILE,
        validate_master_source_header,
    )

    fixture_path = Path(__file__).resolve().parents[2] / "shared/fixtures/master-headers-reviewed-20261022.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert fixture["profile"] == MASTER_SOURCE_PROFILE["id"]
    assert {item["department"] for item in fixture["headers"]} == {item["id"] for item in DEPARTMENTS}
    assert len(fixture["headers"]) == len(DEPARTMENTS) == 8
    for item in fixture["headers"]:
        assert len(item["header"]) == MASTER_SOURCE_PROFILE["columns"] == 34
        validate_master_source_header(item["header"])
        invalid = list(item["header"])
        invalid[21] = "Цена договора вместо ФБ 2"
        with pytest.raises(ValueError, match="MASTER_SOURCE_REQUIRED_MEANING_CHANGED:V"):
            validate_master_source_header(invalid)


def test_master_profile_layout_rejects_unreviewed_field_and_dependency_changes():
    from copy import deepcopy
    from procurement_engine.source_contract import (
        master_source_profile,
        validate_master_profile_layout,
    )

    profile = validate_master_profile_layout()
    assert profile is master_source_profile()
    assert len(profile['fields']) == 34
    for field_name, mutation, reason in [
        ('ID', {'index': 34}, 'MASTER_PROFILE_LAYOUT_INVALID'),
        ('ID', {'requiredMeaning': None}, 'MASTER_PROFILE_LAYOUT_INVALID'),
        ('ID', {'dependsOn': ['UNKNOWN']}, 'MASTER_PROFILE_DEPENDENCY_INVALID'),
        ('FB_PLAN', {'unit': 'none'}, 'MASTER_PROFILE_LAYOUT_INVALID'),
        ('FB_PLAN', {'kind': 'text'}, 'MASTER_PROFILE_LAYOUT_INVALID'),
    ]:
        damaged = deepcopy(profile)
        damaged['fields'][field_name].update(mutation)
        with pytest.raises(ValueError, match=reason):
            validate_master_profile_layout(damaged)
