"""Read-only operational counts. Never emit row text, identifiers or credentials."""
import json
from collections import Counter
from pathlib import Path
from procurement_engine.publication_store import PublicationStore

state = Path('/app/packages/server/data/reports')
store = PublicationStore(state / 'published', readonly=True)
receipt = store.latest()
if receipt is None:
    raise SystemExit('NO_PUBLISHED_REPORT')
model = json.loads((store.releases / receipt['release_id'] / 'report_model.json').read_text())
records = [r for r in model.get('recommendation_records', []) if r.get('active_in_current_slice')]
allowed = {'CONFIRMED', 'ORIGIN_UNPROVEN', 'TEXT_REFERENCE_MISSING', 'PERIOD_EVIDENCE_REQUIRED', 'GROUP_EVIDENCE_REQUIRED', 'CURRENT_EVIDENCE_MISSING', 'AMBIGUOUS'}
counts = Counter((r.get('current_link') or {}).get('status') for r in records)
result = {'active_recommendations': len(records), 'link_status_counts': {k: counts[k] for k in sorted(allowed) if counts[k]},
          'other_link_statuses': sum(n for k,n in counts.items() if k not in allowed),
          'identity_unresolved': (model.get('identity_observations') or {}).get('unresolved_count'),
          'recommendations_with_current_explanations': sum(bool(r.get('current_explanations')) for r in records),
          'source_rows': len(model.get('details', [])),
          'known_business_actions': sum((r.get('dimensions') or {}).get('compliance_status') in {'IMPLEMENTED', 'NOT_IMPLEMENTED'} for r in records)}
print(json.dumps(result, allow_nan=False))
