from procurement_engine.models import ProcedureAttempt, ProcedureShare
from procurement_engine.normalize import normalize_grbs, normalize_procedure_code
from procurement_engine.procedures import (
    effective_procedure_nmc,
    normalize_procedure_values,
    validate_procedure_uniqueness,
)


def test_grbs_aliases_from_live_registry():
    assert normalize_grbs("Управление образования") == "УО"
    assert normalize_grbs("Управление дорожно-транспортного хозяйства, УДТХ") == "УДТХ"
    assert normalize_grbs("УАГЗО Администрации Елизовского муниципального района") == "УАГЗО"
    assert normalize_grbs("Управление культуры, спорта и молодежной политики Администрации") == "УКСиМП"
    assert normalize_grbs("Управление делами Администрации Елизовского муниципального района") == "УД"


def test_procedure_code_header_is_not_a_procedure():
    assert normalize_procedure_code("Код") is None
    assert normalize_procedure_code("Код процедуры") is None
    assert normalize_procedure_code("ЭАС339-26") == "ЭАС339-26"


def test_normalizer_skips_group_headers_and_canonicalizes_grbs():
    values = [
        ["Код", "Пометки"],
        ["Код процедуры", "Вид строки", None, None, "Управление"],
        ["ЭА349-26", "", "", "", "Управление дорожно-транспортного хозяйства, УДТХ", "Заказчик", "Предмет", "1418524,96"] + [None]*14 + ["Заявка в уполномоченном органе"],
    ]
    attempts, shares = normalize_procedure_values(values)
    assert len(attempts) == 1
    assert attempts[0].procedure_code == "ЭА349-26"
    assert attempts[0].grbs == "УДТХ"
    assert shares == []


def test_effective_nmc_accepts_dataclass_shares_and_aliases():
    shares = [ProcedureShare("ЭАС1-26", "Управление образования", 123.0, "x")]
    assert effective_procedure_nmc(master_nmc=999.0, shares=shares, grbs="УО") == (123.0, "PROCEDURE_SHARE")


def test_duplicate_master_attempt_is_blocker():
    attempts = [
        ProcedureAttempt("ЭА1-26", "УО", "a", "x", 1, "Состоялась"),
        ProcedureAttempt("ЭА1-26", "УО", "b", "y", 2, "Состоялась"),
    ]
    issues = validate_procedure_uniqueness(attempts)
    assert len(issues) == 1
    assert issues[0].severity == "ERROR"
    assert issues[0].code == "DUPLICATE_PROCEDURE_CODE"


def test_joint_allocations_require_a_balanced_unique_parent():
    from procurement_engine.models import ProcedureAttempt, ProcedureShare
    from procurement_engine.procedures import validate_procedure_shares

    parent = ProcedureAttempt('ЭА1-26', 'УО', 'School', 'Supplies', 100.03, '')
    shares = [ProcedureShare('ЭА1-26', 'УО', 60.01, 'row2'),
              ProcedureShare('ЭА1-26', 'УЭР', 40.02, 'row3')]
    assert validate_procedure_shares([parent], shares) == []
    shares[1] = ProcedureShare('ЭА1-26', 'УЭР', 40.04, 'row3')
    assert 'PROCEDURE_SHARE_BALANCE_MISMATCH' in {x.code for x in validate_procedure_shares([parent], shares)}
    assert 'PROCEDURE_SHARE_PARENT_MISSING' in {x.code for x in validate_procedure_shares([], shares)}
