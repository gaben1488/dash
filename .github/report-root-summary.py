"""Read-only predicate counts; no primary text, source identifiers or credentials."""
import json
from collections import Counter
from dataclasses import fields
from pathlib import Path
from procurement_engine.publication_store import PublicationStore
from procurement_engine.models import ProcurementRow
from procurement_engine.recommendation_links import _text, _text_ids, _subject_amounts
from procurement_engine.canonical_metrics import money
from procurement_engine.normalize import normalize_id
from procurement_engine.recommendation_evidence import action_target_proven

state = Path('/app/packages/server/data/reports')
store = PublicationStore(state / 'published', readonly=True)
receipt = store.latest()
if receipt is None:
    raise SystemExit('NO_PUBLISHED_REPORT')
model = json.loads((store.releases / receipt['release_id'] / 'report_model.json').read_text())
records = [r for r in model.get('recommendation_records', []) if r.get('active_in_current_slice')]
names = {f.name for f in fields(ProcurementRow)}
rows = [ProcurementRow(**{k:v for k,v in row.items() if k in names}) for row in model['details']]
allowed = {'CONFIRMED', 'ORIGIN_UNPROVEN', 'TEXT_REFERENCE_MISSING', 'PERIOD_EVIDENCE_REQUIRED', 'GROUP_EVIDENCE_REQUIRED', 'CURRENT_EVIDENCE_MISSING', 'AMBIGUOUS'}
counts = Counter((r.get('current_link') or {}).get('status') for r in records)
predicates = Counter()
actions = Counter()
for record in records:
    text = _text(record.get('recommendation_text'))
    ids, _ = _text_ids(text)
    own = [row for row in rows if row.grbs == record['grbs']]
    status = (record.get('current_link') or {}).get('status')
    if status != 'CONFIRMED':
        if not ids:
            predicates['NO_TEXT_ID'] += 1
            predicates['NO_TEXT_ID_BUT_LEDGER_ID'] += bool(record.get('source_procurement_ids'))
            predicates['NO_TEXT_ID_BUT_FULL_SUBJECT_MENTION'] += any(_text(row.subject) in text for row in own if len(row.subject) > 10)
        else:
            matched = [row for row in own if normalize_id(row.source_row_no) in ids]
            predicates['MISSING_AT_LEAST_ONE_NUMBER'] += not set(ids) <= {normalize_id(row.source_row_no) for row in matched}
            pairs = [row for row in matched if _subject_amounts(text, row.subject, normalize_id(row.source_row_no))]
            predicates['NO_EXACT_SUBJECT_AND_OWN_MONEY_PAIR'] += not pairs
            predicates['TEXT_PAIR_BUT_CURRENT_AMOUNT_DIFFERS'] += any(money(row, 'plan') not in _subject_amounts(text, row.subject, normalize_id(row.source_row_no)) for row in pairs)
            predicates['TEXT_PAIR_CURRENT_AMOUNT_BUT_NO_UID'] += any(money(row, 'plan') in _subject_amounts(text, row.subject, normalize_id(row.source_row_no)) and not row.procurement_uid for row in pairs)
            predicates['NUMBER_AND_FULL_SUBJECT_BUT_GRAMMAR_NOT_RECOGNIZED'] += bool(matched and not pairs and any(_text(row.subject) in text for row in matched if len(row.subject) > 10))
    kind = record.get('recommendation_type')
    if kind not in {'CHANGE_METHOD_EA', 'CHANGE_METHOD_EP', 'MERGE_PROCUREMENTS', 'CHANGE_AMOUNT', 'MOVE_PLANNED_DATE'}:
        kind = 'OTHER_ACTION_KIND'
    actions[kind + ':TOTAL'] += 1
    actions[kind + ':GRAMMAR_ACCEPTED'] += action_target_proven(record, ids)
result = {'active_recommendations': len(records), 'link_status_counts': {k: counts[k] for k in sorted(allowed) if counts[k]},
          'other_link_statuses': sum(n for k,n in counts.items() if k not in allowed),
          'identity_unresolved': (model.get('identity_observations') or {}).get('unresolved_count'),
          'source_rows': len(model.get('details', [])), 'unmet_predicate_counts': dict(predicates), 'action_counts': dict(actions)}
print(json.dumps(result, allow_nan=False))
