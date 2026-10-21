"""Bounded read-only native/edge measurements. Scenario setup belongs to the caller.

Run once per cold/warm/worker scenario against the same isolated final-SHA runtime.
No refresh, restart, source access or worker mutation is performed here.
Credentials come only from environment and are never included in evidence.
"""
import argparse
import base64
import hashlib
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

LIMIT = 24 * 1024 * 1024
BUDGET_MS = 3000
VOLATILE_FIELDS = ['trust.computedAt', 'snapshot.trust.computedAt']


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def stages(header):
    result = {}
    for item in header.split(','):
        match = re.fullmatch(r'\s*([a-zA-Z][\w-]*);dur=([0-9]+(?:\.[0-9]+)?)\s*', item)
        if match:
            value = float(match[2])
            if match[1] in result or not math.isfinite(value):
                raise ValueError('INVALID_SERVER_TIMING')
            result[match[1]] = value
    if 'app' not in result:
        raise ValueError('MISSING_APP_TIMING')
    return result


def summarize(body, header, headers_ms, body_ms, parse_ms):
    data = json.loads(body)
    context = data.get('snapshot', {})
    snapshot = context.get('id')
    if not isinstance(snapshot, str) or not snapshot:
        raise ValueError('MISSING_SNAPSHOT')
    as_of = context.get('createdAt')
    if not isinstance(as_of, str) or not as_of:
        raise ValueError('MISSING_SNAPSHOT_TIME')
    timings = stages(header)
    # Reassessment time is generated per GET. Exclude only these named fields;
    # source time, context, evidence, decisions and every value remain compared.
    for parent in (data, context):
        if isinstance(parent.get('trust'), dict):
            parent['trust'].pop('computedAt', None)
    semantic = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    return {
        'snapshotId': snapshot, 'asOf': as_of, 'asOfField': 'snapshot.createdAt',
        'bytes': len(body), 'bodySha256': hashlib.sha256(body).hexdigest(),
        'semanticSha256': hashlib.sha256(semantic).hexdigest(), 'ignoredVolatileFields': VOLATILE_FIELDS,
        'serverTimingMs': timings, 'inclusiveNonAdditive': True,
        'clientHeadersMs': headers_ms, 'clientBodyMs': body_ms, 'clientParseMs': parse_ms,
        'transportAndProxyResidualMs': max(0, body_ms - timings['app']),
        'appBudgetMs': BUDGET_MS, 'appBudgetPassed': timings['app'] <= BUDGET_MS,
    }


def measure(base, path, authorization):
    parsed = urlsplit(base)
    if parsed.scheme not in {'http', 'https'} or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('INVALID_BASE')
    request = Request(base.rstrip('/') + path, headers={
        'Authorization': authorization, 'Accept': 'application/json', 'Accept-Encoding': 'identity',
    })
    opener = build_opener(ProxyHandler({}), NoRedirect())
    started_at = datetime.now(timezone.utc).isoformat()
    start = time.perf_counter()
    with opener.open(request, timeout=30) as response:
        headers_ms = (time.perf_counter() - start) * 1000
        body = response.read(LIMIT + 1)
        body_ms = (time.perf_counter() - start) * 1000
        if response.status != 200 or len(body) > LIMIT:
            raise ValueError('INVALID_RESPONSE')
        header = response.headers.get('Server-Timing', '')
        request_id = response.headers.get('X-Request-Id', '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', request_id):
            raise ValueError('MISSING_REQUEST_CORRELATION')
    parse_start = time.perf_counter()
    json.loads(body)
    parse_ms = (time.perf_counter() - parse_start) * 1000
    return summarize(body, header, headers_ms, body_ms, parse_ms) | {
        'startedAt': started_at, 'endedAt': datetime.now(timezone.utc).isoformat(), 'requestId': request_id,
    }


def attach_proxy_timing(proof, lines):
    """Join captured Caddy JSON access logs after the requests finish; copy no headers."""
    matches = []
    for line in lines:
        try:
            entry = json.loads(line[line.index('{'):])
        except (ValueError, TypeError):
            continue
        headers = {key.lower(): value for key, value in entry.get('resp_headers', {}).items()}
        if headers.get('x-request-id') != [proof['edge']['requestId']]:
            continue
        duration = entry.get('duration')
        if entry.get('status') == 200 and type(duration) in (int, float) and math.isfinite(duration) and duration >= 0:
            matches.append(duration * 1000)
    # A proxy access duration includes its upstream wait; it is NOT overhead
    # to add to app duration. Ambiguous/missing log entries remain unmeasured.
    proof['proxyIsolated'] = len(matches) == 1
    proof['edge']['proxyInclusiveMs'] = matches[0] if len(matches) == 1 else None
    return proof


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', required=True)
    parser.add_argument('--edge', required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--scenario', choices=['cold', 'warm', 'worker'], required=True)
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.sha) or not 2000 <= args.year <= 2100:
        raise ValueError('INVALID_CONTEXT')
    # Native first is explicitly recorded: only this first read can be cold.
    # Edge follows on the same snapshot; do not label both as cold-cache reads.
    credentials = base64.b64encode((os.environ['DASH_BASIC_USER'] + ':' + os.environ['DASH_BASIC_PASSWORD']).encode()).decode()
    path = '/api/dashboard?year=' + str(args.year)
    native = measure(args.native, path, 'Bearer ' + os.environ['AEMR_API_KEY'])
    edge = measure(args.edge, path, 'Basic ' + credentials)
    same_snapshot = native['snapshotId'] == edge['snapshotId'] and native['asOf'] == edge['asOf']
    proof = {'sourceSha': args.sha, 'scenarioLabel': args.scenario,
             'scenarioSetupVerifiedByProbe': False, 'order': ['native', 'edge'],
             'native': native, 'edge': edge, 'sameSnapshot': same_snapshot,
             'sameBody': native['bodySha256'] == edge['bodySha256'],
             'sameSemanticBody': native['semanticSha256'] == edge['semanticSha256'],
             'browserMeasured': False, 'proxyIsolated': False,
             'passed': same_snapshot and native['semanticSha256'] == edge['semanticSha256']
             and native['appBudgetPassed'] and edge['appBudgetPassed']}
    Path(args.output).write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
    print('PAIRED_READ_PASS' if proof['passed'] else 'PAIRED_READ_FAIL')
    return 0 if proof['passed'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError):
        # Exception text may include a private origin or authorization challenge.
        print('PAIRED_READ_UNAVAILABLE')
        raise SystemExit(2) from None
