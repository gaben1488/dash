"""Compact business projection; full attributed source context is retained in the model."""
from .normalize import parse_date

CONTRACT = 'relevant-context-v1'


def group_context(records, *, year, as_of):
    """One group per department/period and identical attributed business explanations.

    Current pending positions and the next plan year remain visible. Completed
    positions stay in the full source model and recommendation evidence rather
    than being repeated en masse at the end of both reports. A future-year word
    in prose cannot change the structured cohort.
    """
    cutoff = parse_date(as_of)
    if cutoff is None:
        raise ValueError('REPORT_DATE_INVALID')
    groups = {}
    for row in records:
        period = row.get('planned_year')
        fact = parse_date(row.get('actual_date'))
        if period not in (year, year + 1) or (period == year and fact and fact <= cutoff):
            continue
        business = [entry for entry in row['explanations'] if entry['visibility'] == 'business']
        if not business:
            continue
        key = (row['grbs'], period, row.get('planned_date'), tuple(
            (entry['field'], entry['column'], entry['label'], entry['text']) for entry in business))
        group = groups.setdefault(key, {'grbs': row['grbs'], 'planned_year': period,
            'planned_date': row.get('planned_date'), 'members': [], 'explanations': []})
        group['members'].append({'source_row_key': row['source_row_key'],
            'business_id': row['business_id'], 'subject': row['subject']})
        if not group['explanations']:
            group['explanations'] = [{'field': entry['field'], 'column': entry['column'],
                'label': entry['label'], 'text': entry['text'], 'source_row_keys': []} for entry in business]
        for entry in group['explanations']:
            entry['source_row_keys'].append(row['source_row_key'])
    return list(groups.values())
