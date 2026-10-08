"""The same working RecommendationLedger may include drafts, but Word must not."""
import json

import pytest
from procurement_engine.recommendation_history import issued_recommendations
from procurement_engine.runtime import run_once
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


def test_drafts_and_working_notes_do_not_enter_official_provenance():
    original = {'recommendation_id': 'REC-OLD', 'grbs': 'УО',
        'recommendation_text': 'Историческая рекомендация', 'active_in_current_slice': True,
        'source_procurement_ids': ['42'], 'editor_note': 'Только для внутренней работы',
        'editorial_history': [{'at': '2026-10-09', 'kind': 'note'}],
        'editorial_updated_at': '2026-10-09T00:00:00Z'}
    draft = {'recommendation_id': 'REC-DRAFT-123', 'grbs': 'УЭР',
        'recommendation_text': 'Предложение для обсуждения', 'active_in_current_slice': False,
        'source_procurement_ids': [], 'editorial_state': 'DRAFT',
        'editor_note': 'Не утверждено'}
    rows = issued_recommendations([original, draft])
    assert rows == [{k: v for k, v in original.items()
                     if k not in ('editor_note', 'editorial_history', 'editorial_updated_at')}]
    assert len(rows) == 1
    assert 'REC-DRAFT' not in json.dumps(rows)


@pytest.mark.parametrize('stage', ['DRAFT', 'ARCHIVED_DRAFT'])
def test_staged_recommendation_is_never_published_by_a_scheduled_run(tmp_path, stage):
    registry, ledger_path = inputs(tmp_path)
    state = tmp_path / 'state'
    first = run_once(registry, ledger_path, state, client=CompleteGoogle())
    assert first['status'] in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}
    ledger_path.write_text(json.dumps([{
        'recommendation_id': 'REC-DRAFT-123',
        'grbs': 'УЭР', 'recommendation_text': 'Рассмотреть объединение закупок',
        'source_procurement_ids': [], 'active_in_current_slice': False,
        'editorial_state': stage, 'editor_note': 'Проверить'
    }]))
    second = run_once(registry, ledger_path, state, client=CompleteGoogle())
    assert second['status'] in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}, second
    assert second.get('reused_publication') is True
    assert second['publication']['release_id'] == first['publication']['release_id']
    assert json.loads(ledger_path.read_text())[0]['recommendation_id'] == 'REC-DRAFT-123'


def test_unknown_editorial_state_fails_closed():
    with pytest.raises(ValueError, match='RECOMMENDATION_EDITORIAL_STATE_INVALID'):
        issued_recommendations([{'recommendation_id': 'x', 'editorial_state': 'OFFICIAL_BY_CLICK'}])


def test_existing_input_bootstrap_and_validation_survive_draft_and_editor_note(tmp_path):
    """A later deployment must not reject the safe existing working JSON."""
    from procurement_engine.runtime_inputs import install_google_inputs, validate_inputs

    registry, ledger_path = inputs(tmp_path)
    saved = json.loads(ledger_path.read_text())
    saved.append({
        'recommendation_id': 'REC-DRAFT-1234', 'grbs': 'УО',
        'recommendation_text': 'Предложение о сверке данных',
        'source_procurement_ids': [], 'active_in_current_slice': False,
        'editorial_state': 'DRAFT', 'editor_note': 'Черновик не включён в отчёт',
    })
    ledger_path.write_text(json.dumps(saved))
    spec = json.loads(registry.read_text())
    validate_inputs(spec, saved)

    target = tmp_path / 'installed' / 'inputs'
    target.mkdir(parents=True)
    (target / 'registry.json').write_text(registry.read_text())
    (target / 'ledger.json').write_text(ledger_path.read_text())

    class NoDrive:
        def _get(self, *_args, **_kwargs):
            raise AssertionError('Existing private input must not be replaced from Google')

    install_google_inputs(target, client=NoDrive())
    assert json.loads((target / 'ledger.json').read_text()) == saved
