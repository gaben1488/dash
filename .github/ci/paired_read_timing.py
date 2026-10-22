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
from io import BytesIO
from zipfile import BadZipFile, ZipFile
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

LIMIT = 24 * 1024 * 1024
MAX_PROXY_LOG_BYTES = 4 * 1024 * 1024
BUDGET_MS = 3000
VOLATILE_FIELDS = ['trust.computedAt', 'snapshot.trust.computedAt']
DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
# Fixed, reviewed field names only: never log response keys, values, paths or sample rows.
CENSUS_FIELDS = (
    'snapshot.issues', 'recentIssues', 'snapshot.officialMetrics',
    'snapshot.calculatedMetrics', 'snapshot.metadata', 'snapshot.datasetAnalyses',
    'departmentSummaries', 'summaryByPeriod', 'trust', 'issueSummary',
)


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



def field_census(data):
    """Bounded size/count proof without disclosing any response content or dynamic keys."""
    result = {}
    for path in CENSUS_FIELDS:
        value = data
        present = True
        for key in path.split('.'):
            if not isinstance(value, dict) or key not in value:
                present = False
                break
            value = value[key]
        # Explicit null is present; an omitted field is unknown, never a zero.
        if not present:
            result[path] = {'present': False, 'bytes': None, 'entries': None}
            continue
        encoded = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
        result[path] = {'present': True, 'bytes': len(encoded),
                        'entries': len(value) if isinstance(value, (dict, list)) else None}
    return result


def summarize_docx(body, header, content_type, headers_ms, body_ms):
    """Read-only proof of an existing, pinned Word artifact: no generation, no raw bytes in logs."""
    if content_type.split(';', 1)[0].strip().lower() != DOCX_CONTENT_TYPE:
        raise ValueError('INVALID_REPORT_MEDIA_TYPE')
    inspect_start = time.perf_counter()
    try:
        with ZipFile(BytesIO(body)) as archive:
            if not {'[Content_Types].xml', 'word/document.xml'}.issubset(archive.namelist()):
                raise ValueError('INVALID_DOCX_STRUCTURE')
    except BadZipFile:
        raise ValueError('INVALID_DOCX_STRUCTURE') from None
    inspect_ms = (time.perf_counter() - inspect_start) * 1000
    timings = stages(header)
    return {
        'bytes': len(body), 'bodySha256': hashlib.sha256(body).hexdigest(),
        'mediaType': DOCX_CONTENT_TYPE, 'serverTimingMs': timings,
        'inclusiveNonAdditive': True,
        'clientHeadersMs': headers_ms, 'clientBodyMs': body_ms, 'clientParseMs': inspect_ms,
        'transportAndProxyResidualMs': max(0, body_ms - timings['app']),
        'appBudgetMs': BUDGET_MS, 'appBudgetPassed': timings['app'] <= BUDGET_MS,
    }


def summarize(body, header, headers_ms, body_ms, parse_ms, parsed=None):
    data = parsed if parsed is not None else json.loads(body)
    if not isinstance(data, dict) or not isinstance(data.get('snapshot'), dict):
        raise ValueError('INVALID_DASHBOARD_SHAPE')
    context = data['snapshot']
    snapshot = context.get('id')
    if not isinstance(snapshot, str) or not snapshot:
        raise ValueError('MISSING_SNAPSHOT')
    as_of = context.get('createdAt')
    if not isinstance(as_of, str) or not as_of:
        raise ValueError('MISSING_SNAPSHOT_TIME')
    timings = stages(header)
    # Census describes the actual received HTTP payload, before normalized volatile fields
    # are removed only for semantic cross-host equality.
    payload_census = field_census(data)
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
        'payloadCensus': payload_census,
        'clientHeadersMs': headers_ms, 'clientBodyMs': body_ms, 'clientParseMs': parse_ms,
        'transportAndProxyResidualMs': max(0, body_ms - timings['app']),
        'appBudgetMs': BUDGET_MS, 'appBudgetPassed': timings['app'] <= BUDGET_MS,
    }


def measure(base, path, authorization, media='dashboard'):
    parsed = urlsplit(base)
    if parsed.scheme not in {'http', 'https'} or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('INVALID_BASE')
    request = Request(base.rstrip('/') + path, headers={
        'Authorization': authorization,
        'Accept': DOCX_CONTENT_TYPE if media == 'docx' else 'application/json',
        'Accept-Encoding': 'identity',
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
        content_type = response.headers.get('Content-Type', '')
        request_id = response.headers.get('X-Request-Id', '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', request_id):
            raise ValueError('MISSING_REQUEST_CORRELATION')
    if media == 'docx':
        details = summarize_docx(body, header, content_type, headers_ms, body_ms)
    else:
        parse_start = time.perf_counter()
        parsed_body = json.loads(body)
        parse_ms = (time.perf_counter() - parse_start) * 1000
        details = summarize(body, header, headers_ms, body_ms, parse_ms, parsed=parsed_body)
    return details | {
        'startedAt': started_at, 'endedAt': datetime.now(timezone.utc).isoformat(), 'requestId': request_id,
    }


def attach_proxy_timing(proof, lines):
    """Join only response IDs and durations from captured Caddy JSON logs, never request headers."""
    records = []
    for line in lines:
        try:
            entry = json.loads(line[line.index('{'):])
        except (ValueError, TypeError):
            continue
        if not isinstance(entry, dict) or not isinstance(entry.get('resp_headers'), dict):
            continue
        duration = entry.get('duration')
        if entry.get('status') != 200 or type(duration) not in (int, float):
            continue
        if not math.isfinite(duration) or duration < 0:
            continue
        headers = {key.lower(): value for key, value in entry.get('resp_headers', {}).items()}
        records.append((headers.get('x-request-id'), duration * 1000))
    targets = [proof]
    if proof.get('selectedReport') is not None:
        targets.append(proof['selectedReport'])
    for target in targets:
        request_id = target['edge']['requestId']
        matches = [duration for ids, duration in records if ids == [request_id]]
        target['proxyIsolated'] = len(matches) == 1
        target['edge']['proxyInclusiveMs'] = matches[0] if len(matches) == 1 else None
    return proof


def read_proxy_lines(path):
    """Bounded caller-captured logs: discard content after extracting fixed durations."""
    with Path(path).open('rb') as source:
        raw = source.read(MAX_PROXY_LOG_BYTES + 1)
    if len(raw) > MAX_PROXY_LOG_BYTES:
        raise ValueError('PROXY_LOG_TOO_LARGE')
    return raw.decode('utf-8', errors='replace').splitlines()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', required=True)
    parser.add_argument('--edge', required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--scenario', choices=['cold', 'warm', 'worker'], required=True)
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--selected-release', help='Exact existing REL-<64-hex> artifact (GET only)')
    parser.add_argument('--selected-view', choices=['main', 'supplement', 'operational'], default='main')
    parser.add_argument('--proxy-log', help='Bounded captured Caddy access log (read-only, optional)')
    args = parser.parse_args()
    if (not re.fullmatch('[0-9a-f]{40}', args.sha) or not 2000 <= args.year <= 2100
            or (args.selected_release is not None and not re.fullmatch(r'REL-[a-f0-9]{64}', args.selected_release))):
        raise ValueError('INVALID_CONTEXT')
    # Native first is explicitly recorded: only this first read can be cold.
    # Edge follows on the same snapshot; do not label both as cold-cache reads.
    credentials = base64.b64encode((os.environ['DASH_BASIC_USER'] + ':' + os.environ['DASH_BASIC_PASSWORD']).encode()).decode()
    # Match the real browser client (packages/web/src/api.ts): compact prevents duplicated issues.
    path = '/api/dashboard?compact=1&year=' + str(args.year)
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
    # The selected release must be an already-published immutable artifact. GET never prepares
    # a report, touches the worker or falls back to "latest" on 404.
    if args.selected_release:
        report_path = '/api/report-releases/' + args.selected_release + '/' + args.selected_view + '.docx'
        report_native = measure(args.native, report_path, 'Bearer ' + os.environ['AEMR_API_KEY'], media='docx')
        report_edge = measure(args.edge, report_path, 'Basic ' + credentials, media='docx')
        report_equal = report_native['bodySha256'] == report_edge['bodySha256']
        report_passed = report_equal and report_native['appBudgetPassed'] and report_edge['appBudgetPassed']
        proof['selectedReport'] = {
            'releaseId': args.selected_release, 'view': args.selected_view, 'order': ['native', 'edge'],
            'native': report_native, 'edge': report_edge, 'sameBody': report_equal,
            'proxyIsolated': False, 'passed': report_passed,
        }
        proof['passed'] = proof['passed'] and report_passed
    proof['selectedReportMeasured'] = args.selected_release is not None
    # Correlate by an exact edge response ID only; nearby requests or duplicate
    # IDs are not evidence. No logs/headers are included in the output.
    if args.proxy_log:
        attach_proxy_timing(proof, read_proxy_lines(args.proxy_log))
    proof['proxyEvidenceComplete'] = proof['proxyIsolated'] and (
        not args.selected_release or proof['selectedReport']['proxyIsolated'])
    if args.proxy_log:
        proof['passed'] = proof['passed'] and proof['proxyEvidenceComplete']
    # This HTTP probe is not a release acceptance: externally proven scenario,
    # browser and proxy receipts remain independent mandatory evidence.
    proof['acceptanceReady'] = (proof['passed'] and proof['proxyEvidenceComplete']
                                and proof['scenarioSetupVerifiedByProbe'] and proof['browserMeasured'])
    # No inferred cold start, concurrent worker or browser proof: these require independent readback.
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
