"""Date-aware deterministic metric blocks, exact before presentation conversion.

Amounts are thousands of RUB. *_decimal strings are authoritative; numeric
amounts exist for legacy consumers. Missing source cells remain in coverage.
Quarterly execution selects planned cohorts; calendar events are separate.
"""
from decimal import Decimal

from .fact_model import is_procurement_row
from .normalize import parse_date

VERSION = 'metric-contract-v1.4.0'

def money(row, prefix):
    return sum((Decimal(str(getattr(row, prefix + '_' + p))) for p in ('fb','kb','mb')), Decimal(0))

def completed(row, as_of=None):
    return bool(row.actual_date and (as_of is None or row.actual_date <= as_of))

def metric_block(rows, *, report_year, as_of=None, method=None, planned_quarter=None, planned_month=None):
    if as_of is not None:
        as_of = parse_date(as_of)
        if not as_of: raise ValueError('AS_OF_INVALID')
    selected = [r for r in rows if is_procurement_row(r, report_year=report_year)
                and (method is None or r.method == method)
                and (planned_quarter is None or r.planned_quarter == planned_quarter)
                and (planned_month is None or int(r.planned_date[5:7]) == planned_month)]
    done = [r for r in selected if completed(r, as_of)]
    remaining = [r for r in selected if not completed(r, as_of)]
    partial = [r for r in selected if not r.actual_date and money(r,'fact') > 0]
    eligible = [r for r in done if r.include_saving is True]
    exact = {
        'plan_amount': sum((money(r,'plan') for r in selected), Decimal(0)),
        'fact_amount': sum((money(r,'fact') for r in done), Decimal(0)),
        'remain_amount': sum((money(r,'plan') for r in remaining), Decimal(0)),
        'monetary_fact_amount': sum((money(r,'fact') for r in selected if not r.actual_date or completed(r,as_of)), Decimal(0)),
        'partial_fact_without_completion_amount': sum((money(r,'fact') for r in partial), Decimal(0)),
        'confirmed_saving_amount': sum((money(r,'saving') for r in eligible), Decimal(0)),
    }
    for prefix, population in [('plan', selected), ('fact', done), ('remain', remaining)]:
        for budget in ('fb', 'kb', 'mb'):
            field = ('plan' if prefix == 'remain' else prefix) + '_' + budget
            exact[prefix + '_' + budget + '_amount'] = sum(
                (Decimal(str(getattr(r, field))) for r in population), Decimal(0))
    exact['deviation_amount'] = exact['monetary_fact_amount'] - exact['plan_amount']
    exact['contracted_share_pct'] = (exact['monetary_fact_amount'] / exact['plan_amount'] * 100) if exact['plan_amount'] else None
    block = {'plan_count':len(selected),'fact_count':len(done),'remain_count':len(remaining),
             'completed_position_count':len(done), 'completed_position_amount':float(exact['fact_amount']),
             'partial_fact_without_completion_count':len(partial),
             'overdue_count':sum(bool(as_of and r.planned_date < as_of) for r in remaining),
             'execution_pct':100*len(done)/len(selected) if selected else None,
             'procedure_count':None,'contract_count':None,
             'money_unit':'тыс. руб.', 'as_of':as_of, 'rule_version':VERSION,
             'contributors':[r.physical_row_key for r in selected],
             'fact_contributors':[r.physical_row_key for r in done],
             'saving_contributors':[r.physical_row_key for r in eligible],
             'money_coverage':{
                'rows_with_missing_plan_components':sum(any(x in r.missing_money_fields for x in ('H','I','J')) for r in selected),
                'rows_with_all_plan_components_missing':sum(all(x in r.missing_money_fields for x in ('H','I','J')) for r in selected),
                'completed_rows_with_all_fact_components_missing':sum(all(x in r.missing_money_fields for x in ('V','W','X')) for r in done),
                'basis':'Known components summed; missing cells retained separately, not evidence of zero.'}}
    block.update({k:float(v) if v is not None else None for k,v in exact.items()})
    block['exact_decimal']={k:format(v,'f') if v is not None else None for k,v in exact.items()}
    return block

def calendar_facts(rows, *, event_year, event_quarter, as_of):
    date=parse_date(as_of)
    if not date: raise ValueError('AS_OF_INVALID')
    # This population includes plans of other years; it counts recorded positions,
    # never contracts. It intentionally differs from planned-quarter execution.
    selected=[r for r in rows if is_procurement_row(r) and completed(r,date)
              and int(r.actual_date[:4])==event_year
              and (int(r.actual_date[5:7])-1)//3+1==event_quarter]
    amount=sum((money(r,'fact') for r in selected),Decimal(0))
    return {'event_year':event_year,'event_quarter':event_quarter,'as_of':date,
            'recorded_position_count':len(selected),'amount_thousand':float(amount),
            'amount_thousand_decimal':format(amount,'f'),
            'contributors':[r.physical_row_key for r in selected], 'contract_count':None}
