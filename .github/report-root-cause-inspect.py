"""Read-only diagnostic. Raw business words, IDs, money and sources never print."""
import hashlib
import json
import re
import shutil
import sqlite3
import tempfile
from collections import Counter, defaultdict
from dataclasses import fields
from pathlib import Path

from procurement_engine.canonical_metrics import money
from procurement_engine.deployment_diagnostics import public_error_code
from procurement_engine.models import ProcurementRow
from procurement_engine.publication_store import PublicationStore
from procurement_engine.recommendation_links import _subject_amounts, _text, _text_ids

root = Path('/app/packages/server/data/reports')

def fingerprint(path):
    if not path.exists(): return None
    stat = path.stat()
    with path.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return stat.st_ino, stat.st_size, stat.st_mtime_ns, digest


def shape(text, subjects=()):
    # Deliberately fixed vocabulary: anything else (including names, IDs and
    # subject words) becomes a placeholder. This is not reversible redaction.
    value = _text(text)
    for subject in sorted(subjects, key=len, reverse=True):
        if len(_text(subject)) >= 4: value = value.replace(_text(subject), '<s>')
    allowed = set('рекомендуем рекомендуется предлагаем предлагается рекомендуемые рекомендовано вынести перевести провести проводить закупку закупки позицию позиции объединить объединение рассмотреть возможность при если не без с по для и или в на из одна одну единый единую несколько совместную совместно совместный закупка путем проведения способом электронный электронного аукцион аукциона эа еп конкурентным конкурентные способ способа перейти перейти целесообразно нецелесообразно сумма сумму тыс руб рублей необходимо плановая плановую сумму изменить установить перенести дату плановую до от году год финансирования наличии отсутствия случае результате несостоявшейся процедуры электронном аукционе также с'.split())
    tokens = []
    for token in re.findall(r'<s>|\w+|[^\w\s]', value):
        translated = '<SUBJECT>' if token == '<s>' else token if token in allowed or token in {'.', ',', ';', ':', '(', ')', '#', '«', '»', '—', '-'} else '<N>' if token.isdigit() else '<TEXT>'
        if translated in {'<TEXT>', '<N>'} and tokens and tokens[-1] == translated: continue
        tokens.append(translated)
    return ' '.join(tokens)[:700]


def inspect():
    store = PublicationStore(root / 'published', readonly=True)
    source = store.database_path
    paths = [source, source.with_name(source.name + '-wal')]
    receipt = None
    for _ in range(3):
        with tempfile.TemporaryDirectory(prefix='report-catalog-') as folder:
            before = [fingerprint(path) for path in paths]
            if before[0] is None: raise ValueError('PUBLICATION_NOT_FOUND')
            try:
                for path, stamp in zip(paths, before):
                    if stamp is not None: shutil.copyfile(path, Path(folder) / path.name)
            except FileNotFoundError: continue
            if before != [fingerprint(path) for path in paths]: continue
            store.database_path = Path(folder) / source.name
            db = sqlite3.connect(store.database_path)
            try:
                if db.execute('PRAGMA quick_check').fetchone() != ('ok',): raise ValueError('CATALOG_CORRUPT')
            finally: db.close()
            receipt = store.latest()
            break
    if receipt is None: raise ValueError('PUBLICATION_NOT_FOUND')
    model = json.loads((store.releases / receipt['release_id'] / 'report_model.json').read_text())
    names = {field.name for field in fields(ProcurementRow)}
    rows = [ProcurementRow(**{key: value for key, value in record.items() if key in names}) for record in model['details']]
    by_number = defaultdict(list)
    by_grbs = defaultdict(list)
    for row in rows:
        by_number[row.grbs, row.source_row_no].append(row)
        by_grbs[row.grbs].append(row)
    records = [record for record in model['recommendation_records'] if record.get('active_in_current_slice')]
    patterns = defaultdict(Counter)
    origin_counts = Counter()
    for record in records:
        status = (record.get('current_link') or {}).get('status', 'NONE')
        candidates = by_grbs[record.get('grbs')]
        patterns[status][shape(record.get('recommendation_text'), [row.subject for row in candidates])] += 1
        origin_counts['verified' if (record.get('current_link') or {}).get('origin') else 'missing'] += 1
    status = json.loads((root / 'status.json').read_text())
    last_attempt = status.get('attempt_id')
    private_error = {}
    if isinstance(last_attempt, str) and re.fullmatch(r'[A-Za-z0-9_-]+', last_attempt):
        path = root / 'attempts' / last_attempt / 'error.json'
        if path.is_file(): private_error = json.loads(path.read_text())
    output = {'release_date': model['snapshot']['report_date'], 'active_recommendations': len(records),
        'link_status_counts': dict(Counter((record.get('current_link') or {}).get('status', 'NONE') for record in records)),
        'origin_counts': dict(origin_counts), 'worker_status': status.get('status'),
        'last_error_code': public_error_code(str(status.get('error_code') or private_error.get('error') or private_error.get('message') or '')),
        'redacted_grammar': {status: [{'shape': key, 'count': n} for key, n in counts.most_common(40)] for status, counts in patterns.items()}}
    print(json.dumps(output, ensure_ascii=False, sort_keys=True))

try:
    inspect()
except Exception as error:
    print(json.dumps({'probe': 'FAIL', 'exception_class': type(error).__name__}))
    raise SystemExit(2)
