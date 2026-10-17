"""Deployment must use the same commit that passed the required CI jobs."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_main_workflow_does_not_cancel_state_changing_deployment():
    workflow = (ROOT / '.github/workflows/ci.yml').read_text()
    top_concurrency = workflow.split('concurrency:', 1)[1].split('jobs:', 1)[0]
    assert "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}" in top_concurrency


def test_deploy_resets_to_tested_sha_and_checks_it_before_building():
    workflow = (ROOT / '.github/workflows/ci.yml').read_text()
    script = workflow.split('          script: |', 1)[1]
    assert "tested_commit='${{ github.sha }}'" in script
    assert 'git reset --hard "$tested_commit"' in script
    exact_sha_check = 'test "$(exec 9>&-; git rev-parse HEAD)" = "$tested_commit"'
    assert exact_sha_check in script
    reset = script.index('git reset --hard "$tested_commit"')
    check = script.index(exact_sha_check)
    build = script.index('docker compose --env-file .env.production build server web')
    replace = script.index('up -d --no-build server web caddy')
    assert reset < check < build < replace
    assert 'git reset --hard origin/main' not in script
