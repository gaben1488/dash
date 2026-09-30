"""Prepare complete business sections once; DOCX views only format this model."""
from .canonical_metrics import completed, metric_block, money
from .fact_model import is_procurement_row


def remaining_position(row):
    return {'source_row_key': row.physical_row_key, 'business_id': row.source_row_no,
            'institution': row.institution, 'subject': row.subject,
            'amount_thousand_decimal': format(money(row, 'plan'), 'f'),
            'comment': ' | '.join(dict.fromkeys(x for x in
                (row.deviation_reason, row.grbs_comment) if x and x.strip().casefold() not in {'x','х','-','—'}))}


def build_business_sections(rows, *, year, as_of, grbs_order, departmental_model):
    scopes = ('year', 'q1', 'q2', 'q3', 'q4')
    global_blocks = {}
    grouped = {}
    remaining = {}
    for kind, method in [('comp', 'ЭА'), ('ep', 'ЕП')]:
        global_blocks[kind] = {scope: metric_block(rows, report_year=year, as_of=as_of,
            method=method, planned_quarter=None if scope == 'year' else int(scope[1])) for scope in scopes}
    for grbs in grbs_order:
        grouped[grbs] = {kind: {scope: departmental_model[grbs][kind][scope]['metric_block']
                               for scope in scopes} for kind in ('comp', 'ep')}
        remaining[grbs] = {kind: {scope: [] for scope in scopes} for kind in ('comp', 'ep')}
    for row in rows:
        if not is_procurement_row(row, report_year=year) or completed(row, as_of):
            continue
        kind = 'comp' if row.method == 'ЭА' else 'ep'
        item = remaining_position(row)
        remaining[row.grbs][kind]['year'].append(item)
        if row.planned_quarter in (1, 2, 3, 4):
            remaining[row.grbs][kind][f'q{row.planned_quarter}'].append(item)
    return {'version': 'business-sections-v1', 'global': global_blocks,
            'by_grbs': grouped, 'remaining': remaining}
