"""Temporary public-source materializer. Removed before the product PR.
No primary inputs or credentials are read. Every replacement has an exact base.
"""
from pathlib import Path

root = Path('packages/report-engine/src/procurement_engine')

def change(name, old, new):
    path = root / name
    text = path.read_text()
    assert old in text, (name, old[:80])
    path.write_text(text.replace(old, new))

path = root / 'source_contract.py'
path.write_text(path.read_text() + '''

def registry_grbs_order(registry: dict) -> list[str]:
    """Explicit reporting perimeter; missing inputs never redefine that perimeter.

    The original eight-department contract remains the backward-compatible default.
    A different perimeter is a versioned private input, not a source-code edit.
    """
    from .constants import GRBS_ORDER

    order = registry.get('grbs_order', GRBS_ORDER)
    if (not isinstance(order, list) or not order
        or any(not isinstance(value, str) or not value or clean_text(value) != value for value in order)
        or len(set(order)) != len(order)):
        raise ValueError('INPUT_GRBS_ORDER_INVALID')
    return list(order)
''')
change('runtime_inputs.py', 'from .constants import GRBS_ORDER', 'from .source_contract import registry_grbs_order')
change('runtime_inputs.py', '!= sorted(GRBS_ORDER)', '!= sorted(registry_grbs_order(registry))')
change('raw_pipeline.py', 'from .constants import GRBS_ORDER', 'from .constants import GRBS_ORDER\nfrom .source_contract import registry_grbs_order')
change('raw_pipeline.py', '!= sorted(GRBS_ORDER)', '!= sorted(registry_grbs_order(registry))')
change('raw_pipeline.py', 'def aggregate_rows(rows, year, as_of=None):', 'def aggregate_rows(rows, year, as_of=None, *, grbs_order=None):')
change('raw_pipeline.py', 'for grbs in GRBS_ORDER:', 'for grbs in GRBS_ORDER if grbs_order is None else grbs_order:')
change('raw_pipeline.py', 'def monthly_projection(rows, year, as_of=None):', 'def monthly_projection(rows, year, as_of=None, *, grbs_order=None):')
change('raw_pipeline.py', "snap={**bundle.manifest, 'model':aggregate_rows(rows,year,report_date), 'row_count':len(rows), 'active_procedures':len(active)}", "grbs_order = registry_grbs_order(registry)\n    snap={**bundle.manifest, 'grbs_order':grbs_order,\n          'model':aggregate_rows(rows,year,report_date,grbs_order=grbs_order),\n          'row_count':len(rows), 'active_procedures':len(active)}")
change('raw_pipeline.py', "model['monthly']=monthly_projection(rows,year,report_date)", "model['monthly']=monthly_projection(rows,year,report_date,grbs_order=grbs_order)")
change('report_model.py', '"grbs_order": GRBS_ORDER,', '"grbs_order": list(snapshot.get("grbs_order", GRBS_ORDER)),')
change('publication_history.py', "    periods = ['year']", "    if set(current.get('grbs_order') or []) != set(previous.get('grbs_order') or []):\n        result['status'] = 'REPORT_SCOPE_CHANGED'\n        return result\n    periods = ['year']")
change('docx_renderer.py', "        reason = 'изменилась методика расчёта; показатели двух выпусков несопоставимы' if status == 'RULES_CHANGED' else 'изменён год плана'", "        reason = {'RULES_CHANGED': 'изменилась методика расчёта; показатели двух выпусков несопоставимы',\n                  'REPORT_SCOPE_CHANGED': 'изменился состав управлений, включённых в отчёт',\n                  'REPORT_YEAR_CHANGED': 'изменён год плана'}.get(status, 'сопоставимость выпусков не подтверждена')")

path = root / 'normalize.py'
path.write_text(path.read_text() + '''

def parse_integer(value, *, minimum=1, maximum=9999) -> int | None:
    """Accept a bounded finite whole number without rounding calendar periods."""
    if value is None or not clean_text(value):
        return None
    try:
        number = to_decimal(value)
    except ValueError:
        return None
    return int(number) if minimum <= number <= maximum and number == number.to_integral_value() else None
''')
change('adapters.py', '    parse_date,', '    parse_date,\n    parse_integer,')
change('adapters.py', '''    text = clean_text(value)
    if not text:
        return None
    try:
        return int(float(text.replace(",", ".")))
    except ValueError:
        return None''', '    return parse_integer(value)')
change('qa.py', '    clean_text,', '    NO_DATE_MARKERS,\n    clean_text,')
change('qa.py', '    parse_date,', '    parse_date,\n    parse_integer,')
change('qa.py', '        plan = [_num(_cell(row, i)) for i in (7, 8, 9)]', '''        for column, label, maximum in ((14, 'PLAN_QUARTER', 4), (15, 'PLAN_YEAR', 9999),
                                        (17, 'FACT_QUARTER', 4), (18, 'FACT_YEAR', 9999)):
            raw = _cell(row, column)
            if clean_text(raw).casefold() in NO_DATE_MARKERS:
                continue
            number = parse_integer(raw)
            if number is None or not 1 <= number <= maximum:
                issues.append(ValidationIssue('ERROR', 'INVALID_' + label,
                    f'{grbs} row {rn}: calendar period must be a valid whole number', ctx))
        for column, label in ((13, 'PLAN_DATE'), (16, 'FACT_DATE')):
            raw = _cell(row, column)
            if clean_text(raw).casefold() not in NO_DATE_MARKERS and parse_date(raw) is None:
                issues.append(ValidationIssue('ERROR', 'INVALID_' + label,
                    f'{grbs} row {rn}: invalid calendar date cannot be treated as a missing date', ctx))

        plan = [_num(_cell(row, i)) for i in (7, 8, 9)]''')
change('qa.py', 'py = int(_num(_cell(row, 15))) if _num(_cell(row, 15)) else None', 'py = parse_integer(_cell(row, 15))')
change('qa.py', 'fy = int(_num(_cell(row, 18))) if _num(_cell(row, 18)) else None', 'fy = parse_integer(_cell(row, 18))')
change('qa.py', 'planned_year = int(_num(_cell(raw_row, 15))) if _num(_cell(raw_row, 15)) else None', 'planned_year = parse_integer(_cell(raw_row, 15))')

path = root / 'recommendation_links.py'
text = path.read_text()
start = text.index('    if len(ids) != 1 or re.search(')
text = text[:start] + '''    if legacy_group_rules and (len(ids) != 1 or re.search(r'объедин|совместн|единую закуп|раздроб', text)):
        # Replay old immutable releases with their original single-only contract.
        result['status'] = 'GROUP_EVIDENCE_REQUIRED'
        return result
    # Every explicitly named member needs its own full subject, own amount and
    # unique current identity. A group sum or an incomplete subset is not proof.
    by_id = {business_id: [row for row in candidates if normalize_id(row.source_row_no) == business_id]
             for business_id in ids}
    if any(len(matches) > 1 for matches in by_id.values()):
        result['status'] = 'AMBIGUOUS'
        return result
    if any(not matches or not matches[0].procurement_uid for matches in by_id.values()):
        result['status'] = 'GROUP_EVIDENCE_REQUIRED' if len(ids) > 1 else 'CURRENT_EVIDENCE_MISSING'
        return result
    linked = [by_id[business_id][0] for business_id in ids]
    if len({row.procurement_uid for row in linked}) != len(linked):
        # A proven merge needs a separate dated relation, not UID reuse in a row.
        result['status'] = 'AMBIGUOUS'
        return result
    result.update(status='CONFIRMED', procurement_uids=[row.procurement_uid for row in linked],
        business_ids=[row.source_row_no for row in linked], source_row_keys=[row.physical_row_key for row in linked],
        matches=[{'source_row_key': row.physical_row_key, 'procurement_uid': row.procurement_uid,
                  'business_id': row.source_row_no, 'subject': row.subject,
                  'plan_amount_thousand_decimal': format(money(row, 'plan'), 'f'),
                  'planned_year': row.planned_year, 'method': row.method,
                  'recorded_fact_date': row.actual_date} for row in linked])
    return result
'''
text = text.replace('snapshot_id, verified_origin=None):', 'snapshot_id, verified_origin=None, legacy_group_rules=False):')
path.write_text(text)

change('google_adapter.py', "'sheet_id','columns','grbs')", "'sheet_id','columns','grbs','header_rows')")
change('raw_pipeline.py', "        values = s['values']\n", "        values = s['values']\n        headers = contract['header_rows']\n        if (type(headers) is not int or not 1 <= headers <= len(values)\n                or s.get('header_rows', 3) != headers):\n            raise ValueError(f'SOURCE_HEADER_CONTRACT_MISMATCH:{sid}')\n")
change('raw_pipeline.py', "enumerate(s['values'][3:], 4)", "enumerate(s['values'][s.get('header_rows', 3):], s.get('header_rows', 3) + 1)")
change('raw_pipeline.py', "        issues.extend(x.as_dict() for x in validate_master_values(s['values'][3:], grbs=s['grbs'], source_id=s['provider_id'], sheet_name=s['sheet']))", "        headers = s.get('header_rows', 3)\n        issues.extend(x.as_dict() for x in validate_master_values(s['values'][headers:], grbs=s['grbs'],\n            source_id=s['provider_id'], sheet_name=s['sheet'], first_sheet_row=headers + 1))")
change('raw_pipeline.py', "data_start_row=3, source_id=s['provider_id']", "data_start_row=headers, source_id=s['provider_id']")
change('raw_pipeline.py', 'documents=None, legacy=False):', "documents=None, legacy=False,\n                           link_contract='verified-original-and-current-plan-v2'):")
change('raw_pipeline.py', 'snapshot_id=snapshot_id, verified_origin=proof)', "snapshot_id=snapshot_id, verified_origin=proof,\n            legacy_group_rules=link_contract != 'verified-original-and-current-plan-v2')")
change('raw_pipeline.py', "model['contract']['recommendation_link_contract'] = 'verified-original-and-current-plan-v1'", "model['contract']['recommendation_link_contract'] = 'verified-original-and-current-plan-v2'")
change('independent_audit.py', "enumerate(source['values'][3:],4)", "enumerate(source['values'][source.get('header_rows', 3):], source.get('header_rows', 3) + 1)")
change('section_audit.py', "enumerate(source['values'][3:],4)", "enumerate(source['values'][source.get('header_rows', 3):], source.get('header_rows', 3) + 1)")
change('section_audit.py', "enumerate(source['values'][3:], 4)", "enumerate(source['values'][source.get('header_rows', 3):], source.get('header_rows', 3) + 1)")
change('section_audit.py', "data_start_row=3,source_id=source['provider_id']", "data_start_row=source.get('header_rows', 3),source_id=source['provider_id']")
change('section_audit.py', "legacy=not model.get('contract', {}).get('recommendation_link_contract'))", "legacy=not model.get('contract', {}).get('recommendation_link_contract'),\n            link_contract=model.get('contract', {}).get('recommendation_link_contract'))")
change('publication_store.py', "'rows': meta['row_count'], 'columns': meta['column_count'],", "'rows': meta['row_count'], 'columns': meta['column_count'], 'header_rows': meta.get('header_rows', 3),")
change('identity_store.py', "data_start_row=3, source_id=payload['provider_id']", "data_start_row=meta.get('header_rows', 3), source_id=payload['provider_id']")
change('release_gates.py', "legacy=not model.get('contract', {}).get('recommendation_link_contract'))", "legacy=not model.get('contract', {}).get('recommendation_link_contract'),\n        link_contract=model.get('contract', {}).get('recommendation_link_contract'))")
change('runtime.py', '            validate_ledger_contract(ledger)', '            from .runtime_inputs import validate_inputs\n\n            validate_inputs(registry, ledger)')
change('runtime.py', '    validate_ledger_contract,\n', '')
for path in [root / '__init__.py', root / 'raw_pipeline.py', Path('packages/report-engine/pyproject.toml')]:
    path.write_text(path.read_text().replace('1.5.0rc8', '1.5.0rc9'))
change('deployment_diagnostics.py', 'PUBLIC_STAGES = frozenset', "PUBLIC_CODES = PUBLIC_CODES | frozenset({\n    'INPUT_GRBS_ORDER_INVALID', 'INPUT_MASTER_SET_INVALID', 'INPUT_REGISTRY_INVALID',\n    'INPUT_SOURCE_CONTRACT_INVALID', 'INPUT_SCHEMA_FINGERPRINT_INVALID',\n    'INPUT_SOURCE_GEOMETRY_INVALID', 'INPUT_SOURCE_DUPLICATE', 'INPUT_PROCEDURE_SOURCES_MISSING',\n    'SOURCE_HEADER_CONTRACT_MISMATCH', 'INVALID_PLAN_YEAR', 'INVALID_PLAN_QUARTER',\n    'INVALID_FACT_YEAR', 'INVALID_FACT_QUARTER', 'INVALID_PLAN_DATE', 'INVALID_FACT_DATE',\n})\nPUBLIC_STAGES = frozenset")
