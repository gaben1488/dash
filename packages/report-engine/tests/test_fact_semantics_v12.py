from procurement_engine.fact_model import FactMetrics, attach_operational_counts


def test_operational_counts_are_independent_and_unknown_by_default():
    m = FactMetrics(plan_count=10, completed_position_count=8, monetary_fact_amount=100.0)
    d = m.as_dict()
    assert d["procedure_count"] is None
    assert d["contract_count"] is None
    assert d["completed_position_count"] == 8


def test_attach_operational_counts_never_aliases_positions():
    m = FactMetrics(plan_count=10, completed_position_count=8, monetary_fact_amount=100.0)
    x = attach_operational_counts(m, procedure_count=6, contract_count=None)
    assert x.plan_count == 10
    assert x.completed_position_count == 8
    assert x.procedure_count == 6
    assert x.contract_count is None
