"""Read-only installed-runtime evidence; source fingerprints and actual DB schema stay distinct."""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import urllib.parse
import urllib.request
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROLES = ('server', 'web', 'report-worker', 'caddy')
CONFIG = {'compose.json', '.env.production', 'Caddyfile', 'candidate-compose.json', 'candidate-Caddyfile'}


def instant(value):
    if not isinstance(value, str) or len(value) > 64:
        raise ValueError('timestamp')
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError('timezone')
    return parsed


def snapshot_identity(payload):
    """Only the tiny live-model identity is evidence for the release passport."""
    if not isinstance(payload, dict) or set(payload) != {'snapshot'}:
        raise ValueError('snapshot payload')
    snapshot = payload['snapshot']
    if not isinstance(snapshot, dict) or set(snapshot) != {'id', 'createdAt'}:
        raise ValueError('snapshot fields')
    if not isinstance(snapshot['id'], str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', snapshot['id']):
        raise ValueError('snapshot id')
    instant(snapshot['createdAt'])
    return snapshot


def read_snapshot_identity(get, year):
    """One request to the canonical model, not a second SQLite/history reader."""
    if type(year) is not int or not 2000 <= year <= 2100:
        raise ValueError('snapshot year')
    return snapshot_identity(get('/api/dashboard?identity=1&year=' + str(year), limit=2048))


def capture():
    from procurement_engine.raw_pipeline import RAW_RULES_VERSION, RENDERER_VERSION

    started = datetime.now(timezone.utc).isoformat()
    key = os.environ.get('AEMR_API_KEY')
    if not key:
        raise ValueError('auth')

    def get(path, *, limit=32 * 1024**2):
        request = urllib.request.Request('http://127.0.0.1:3000' + path, headers={'Authorization': 'Bearer ' + key})
        with urllib.request.urlopen(request, timeout=25) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError('size')
        return json.loads(data)

    year = datetime.now(timezone(timedelta(hours=12))).year
    snapshot = read_snapshot_identity(get, year)
    receipt = get('/api/report-releases')['latest']
    path = Path(os.environ['SQLITE_PATH']).resolve()
    with closing(sqlite3.connect('file:' + urllib.parse.quote(str(path)) + '?mode=ro', uri=True, timeout=5)) as db:
        db.execute('BEGIN')
        definitions = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
        user_version = db.execute('PRAGMA user_version').fetchone()[0]
    schema_digest = hashlib.sha256(json.dumps(definitions, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    return {'started_at': started, 'ended_at': datetime.now(timezone.utc).isoformat(),
            'database': {'schema_sha256': schema_digest, 'user_version': user_version},
            'dashboard': {'snapshot_id': snapshot['id'], 'created_at': snapshot['createdAt']},
            'report': ({name: receipt[name] for name in ('release_id', 'snapshot_id', 'rules_version', 'renderer_version', 'cutoff_at')}
                       if receipt is not None else None),
            'runtime_versions': {'node': subprocess.check_output(['node', '--version'], text=True, timeout=5).strip(),
                                 'python': '.'.join(map(str, sys.version_info[:3])), 'rules': RAW_RULES_VERSION, 'renderer': RENDERER_VERSION}}


def seal(artifact, metadata, stage, accepted, containers, ops, observed):
    from runtime_artifact import require, validate

    sha = artifact['source_sha']
    validate(artifact, sha, artifact['ci']['run_id'], artifact['ci']['attempt'])
    require(type(metadata['id']) is int and metadata['id'] > 0 and metadata['expired'] is False
            and metadata['name'] == 'runtime-' + sha and metadata['workflow_run']['head_sha'] == sha
            and metadata['workflow_run']['id'] == artifact['ci']['run_id']
            and re.fullmatch(r'sha256:[a-f0-9]{64}', metadata['digest']) is not None)
    require(stage['format'] == 'aemr-release-stage-v1' and stage['release_sha'] == sha
            and set(stage['candidate_images']) == set(ROLES) and set(stage['config_sha256']) == CONFIG
            and all(re.fullmatch(r'[a-f0-9]{64}', value) for value in stage['config_sha256'].values()))
    wanted = stage['candidate_images']
    require(all(re.fullmatch(r'sha256:[a-f0-9]{64}', value) for value in wanted.values()))
    web_only = accepted.get('state') == 'RELEASE_WEB_ACCEPTED'
    backend_sha = accepted.get('backend_sha') if web_only else sha
    require(isinstance(backend_sha, str) and re.fullmatch(r'[a-f0-9]{40}', backend_sha) is not None)
    require(wanted['server'] == wanted['report-worker'] ==
            (stage['images']['server'] if web_only else artifact['images']['server']['id'])
            and wanted['web'] == artifact['images']['web']['id'] and wanted['caddy'] == stage['images']['caddy'])
    acceptance = accepted if web_only else accepted['acceptance']
    require(acceptance['state'] == ('RELEASE_WEB_ACCEPTED' if web_only else 'RELEASE_CANDIDATE_ACCEPTED')
            and acceptance['release_sha'] == sha
            and acceptance['images' if web_only else 'candidate_images'] == wanted
            and acceptance['config_sha256'] == stage['config_sha256']
            and re.fullmatch(r'[a-f0-9]{64}', accepted['plan_sha256']) is not None)
    actual = {}
    require(len(containers) == 4)
    for role in ROLES:
        rows = [row for row in containers if row.get('Name') == '/aemr-' + role + '-1']
        require(len(rows) == 1)
        row = rows[0]
        state = row['State']
        labels = row['Config'].get('Labels') or {}
        require(row['Image'] == wanted[role] and row['RestartCount'] == 0 and state['Status'] == 'running'
                and state['OOMKilled'] is False and labels.get('com.docker.compose.project') == 'aemr'
                and labels.get('com.docker.compose.service') == role
                and (role == 'caddy' or labels.get('org.opencontainers.image.revision') ==
                     (backend_sha if role in ('server', 'report-worker') else sha))
                and (role != 'server' or state.get('Health', {}).get('Status') == 'healthy'))
        instant(state['StartedAt'])
        require(re.fullmatch(r'[a-f0-9]{64}', row['Id']) is not None)
        if web_only:
            require(row['Id'] == accepted['container_ids'][role]
                    and (role == 'web' or row['Id'] == stage['container_ids'][role]))
        actual[role] = {'image_id': row['Image'], 'container_id': row['Id'], 'started_at': state['StartedAt'], 'restarts': 0}
    expected_ops = {Path(name).name: digest for name, digest in artifact['source_files'].items() if name.startswith(('deploy/', '.github/'))}
    require(ops == expected_ops)
    versions = observed['runtime_versions']
    require(isinstance(versions, dict) and set(versions) == set(artifact['versions'])
            and all(isinstance(value, str) and 0 < len(value) <= 512 for value in versions.values()))
    require(all(versions[key] == artifact['versions'][key]
                for key in (('rules', 'renderer') if web_only else artifact['versions'])))
    require(instant(observed['ended_at']) >= instant(observed['started_at'])
            and re.fullmatch(r'[a-f0-9]{64}', observed['database']['schema_sha256']) is not None
            and type(observed['database']['user_version']) is int and observed['database']['user_version'] >= 0)
    report = observed['report']
    require(report is not None or stage.get('word') == {'release_id': None, 'sha256': {}})
    identities = [('snapshot', observed['dashboard']['snapshot_id'])]
    if report is not None:
        identities += [('snapshot', report['snapshot_id']), ('release', report['release_id'])]
    for key, value in identities:
        require(isinstance(value, str) and re.fullmatch(r'REL-[a-f0-9]{64}' if key == 'release' else r'[A-Za-z0-9_.:-]{1,160}', value) is not None
                and not value.startswith('demo-'))
    instant(observed['dashboard']['created_at'])
    if report is not None:
        instant(report['cutoff_at'])
        for name in ('rules_version', 'renderer_version'):
            require(isinstance(report[name], str) and 0 < len(report[name]) <= 512)
    return {'format': 'dash-installed-runtime-v1', 'consistency': 'observation_window',
            'observed': {key: observed[key] for key in ('started_at', 'ended_at')},
            'build': {'source_sha': sha, 'backend_source_sha': backend_sha, 'ci': artifact['ci'], 'artifact_id': metadata['id'],
                      'artifact_digest': metadata['digest'], 'versions': artifact['versions'], 'source_files': artifact['source_files']},
            'runtime': actual, 'runtime_versions': versions, 'ops_sha256': ops, 'acceptance_plan_sha256': accepted['plan_sha256'],
            'data': {'database': {key: observed['database'][key] for key in ('schema_sha256', 'user_version')},
                     'dashboard': {key: observed['dashboard'][key] for key in ('snapshot_id', 'created_at')},
                     'report': ({key: report[key] for key in ('release_id', 'snapshot_id', 'rules_version', 'renderer_version', 'cutoff_at')}
                                if report is not None else None)}}


def read(path):
    if path.is_symlink() or not 0 < path.stat().st_size <= 1024**2:
        raise ValueError('input')
    return json.loads(path.read_text())


def main():
    try:
        if sys.argv[1:] == ['--capture']:
            print(json.dumps(capture()))
            return 0
        parser = argparse.ArgumentParser()
        for name in ('artifact', 'metadata', 'stage', 'accepted', 'containers', 'ops', 'observed'):
            parser.add_argument('--' + name, type=Path, required=True)
        args = parser.parse_args()
        value = seal(**{name: read(path) for name, path in vars(args).items()})
        print(json.dumps(value, sort_keys=True, separators=(',', ':')))
        return 0
    except (OSError, ValueError, TypeError, KeyError, AttributeError, IndexError, ImportError, sqlite3.Error, subprocess.SubprocessError):
        print('RUNTIME_PASSPORT_REJECTED', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
