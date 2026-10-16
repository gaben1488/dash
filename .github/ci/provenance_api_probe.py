"""Read-only, fixed-sample wiring probe; never a full journal/money acceptance.

Run with stdlib Python inside the API container. Custody/source-image admission
belongs to the caller. No source revision is inferred from a reading timestamp.
"""
import json
import math
import os
import re
import signal
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

LABELS = ('416', '434', '437', '449', '456', '477')
BOOK = 'УКСиМП'
BASE = 'http://127.0.0.1:3000'
BODY_LIMIT = 16 * 1024 * 1024
REQUEST_SECONDS = 25
TOTAL_SECONDS = 180
KINDS = {'unit-fix', 'scale-shift', 'date-in-money', 'invalid-value', 'retro-cut', 'raise', 'fill', 'clear', 'unknown'}


class Unavailable(Exception):
    """A missing HTTP response is not an empty or invalid source history."""


def require(value):
    if not value:
        raise ValueError('PROVENANCE_SAMPLE_INVALID')


def counter(value):
    require(type(value) is int and 0 <= value <= 2**53 - 1)
    return value


def boolean(value):
    require(type(value) is bool)
    return value


def source_key(source, book_id):
    require(isinstance(source, dict) and source.get('spreadsheetId') == book_id)
    require(source.get('journalSheet') == '_ChangeLog')
    require(1 <= counter(source.get('journalRow')) <= 1_000_000)
    require(counter(source.get('readAt')) > 0)
    return book_id, source['readAt'], source['journalRow']


def target_book(health):
    require(isinstance(health, dict) and isinstance(health.get('books'), list))
    books = health['books']
    require(len(books) == counter(health.get('booksTotal')) and 1 <= len(books) <= 32)
    for book in books:
        require(isinstance(book, dict))
        boolean(book.get('journalAvailable'))
        counter(book.get('journalEntries'))
        for name in ('rows', 'rowsCovered'):
            if book.get(name) is not None:
                counter(book[name])
        if book.get('provenance') is not None:
            for name in ('witnessCount', 'financialAmbiguityCount'):
                counter(book['provenance'].get(name))
    require(counter(health.get('booksRead')) == sum(book['journalAvailable'] for book in books))
    for name in ('witnessCount', 'financialAmbiguityCount'):
        counter(health.get(name))
    matches = [book for book in books if book.get('dept') == BOOK]
    require(len(matches) == 1)
    require(isinstance(matches[0].get('spreadsheetId'), str)
            and re.fullmatch(r'[A-Za-z0-9_-]{10,128}', matches[0]['spreadsheetId']))
    return matches[0]


def inspect_sample(health, rows, story):
    book = target_book(health)
    book_id = book['spreadsheetId']
    result = {'status': 'SAMPLE_VALID', 'full_journal_accepted': False,
              'health_shape_valid': True, 'books_read': health['booksRead'],
              'books_unread': health['booksTotal'] - health['booksRead'],
              'readable_rows': 0, 'missing_rows': 0, 'unavailable_rows': 0, 'unread_rows': 0,
              'empty_readable_rows': 0, 'events_checked': 0, 'witnesses_checked': 0,
              'journal_entries_checked': 0, 'same_read_witnesses_checked': 0,
              'classes': dict.fromkeys(('source_locators', 'multiple_sources', 'unknown_sides',
                                       'financial_ambiguity', 'same_read_overlap'), 'NOT_OBSERVED')}
    observations = {}
    require(set(rows) == set(LABELS))
    for label in LABELS:
        status, row = rows[label]
        if status in (404, 503):
            result['missing_rows' if status == 404 else 'unavailable_rows'] += 1
            continue
        require(status == 200 and isinstance(row, dict))
        require(row.get('rowSeq') == label and row.get('dept') == BOOK and row.get('deptLatin') == 'uksimp')
        require(1 <= counter(row.get('sheetRow')) <= 1_000_000)
        if not boolean(row.get('journalAvailable')):
            result['unread_rows'] += 1
            continue  # Unread zero-looking DTOs are not evidence of an empty history.
        result['readable_rows'] += 1
        events, summary, observability = row.get('events'), row.get('summary'), row.get('observability')
        require(isinstance(events, list) and len(events) <= 100_000)
        require(isinstance(summary, dict) and isinstance(observability, dict))
        boolean(observability.get('coversRow'))
        counter(observability.get('journalEntries'))
        counter(observability.get('planEntries'))
        for name in ('witnessCount', 'financialAmbiguityCount', 'retroCutCount'):
            counter(summary.get(name))
        require(type(summary.get('retroCutTotal')) in (int, float)
                and math.isfinite(summary['retroCutTotal']) and summary['retroCutTotal'] >= 0)
        if summary['financialAmbiguityCount']:
            result['classes']['financial_ambiguity'] = 'OBSERVED'
        if not events:
            result['empty_readable_rows'] += 1
        witnesses = 0
        for event in events:
            require(isinstance(event, dict) and event.get('kind') in KINDS)
            require(isinstance(event.get('cell'), str) and re.fullmatch(r'[HIJK][1-9][0-9]{0,5}', event['cell']))
            require(event.get('column') == event['cell'][0])
            require(isinstance(event.get('sheet'), str) and len(event['sheet']) <= 500)
            require(isinstance(event.get('author'), str) and len(event['author']) <= 1000)
            require(isinstance(event.get('at'), str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d', event['at']))
            for name in ('was', 'became', 'delta'):
                require(event.get(name) is None or (type(event[name]) in (int, float) and math.isfinite(event[name])))
            known = boolean(event.get('wasKnown')) & boolean(event.get('becameKnown'))
            if not known:
                require(event.get('delta') is None and event['kind'] == 'unknown'
                        and summary['financialAmbiguityCount'] > 0)
                result['classes']['unknown_sides'] = 'OBSERVED'
            sources = event.get('sources')
            require(isinstance(sources, list) and 1 <= len(sources) <= 100_000)
            keys = [source_key(source, book_id) for source in sources]
            require(len(set(keys)) == len(keys) == counter(event.get('witnessCount')))
            witnesses += len(keys)
            result['classes']['source_locators'] = 'OBSERVED'
            if len(keys) > 1:
                result['classes']['multiple_sources'] = 'OBSERVED'
            fact = (label, event['sheet'] or 'ВСЕ', event['cell'], event['at'], event['author'] or None)
            for key in keys:
                require(key not in observations or observations[key] == fact)
                observations[key] = fact
        require(summary['witnessCount'] == witnesses)
        result['events_checked'] += len(events)
        result['witnesses_checked'] += witnesses

    require(isinstance(story, dict) and isinstance(story.get('entries'), list) and isinstance(story.get('gaps'), list))
    require(story.get('deletionsUnobservable') is True)
    shown, total = counter(story.get('shown')), counter(story.get('total'))
    require(shown == len(story['entries']) <= min(total, 2000))
    result['story_truncated'] = total > shown
    for entry in story['entries']:
        require(isinstance(entry, dict) and entry.get('book') == BOOK)
        evidence = entry.get('evidence', [entry])
        require(isinstance(evidence, list) and 1 <= len(evidence) <= 100_000)
        for original in evidence:
            require(isinstance(original, dict) and original.get('book') == BOOK)
            if original.get('origin') != 'book-journal':
                continue
            key = source_key(original.get('journalSource'), book_id)
            result['journal_entries_checked'] += 1
            if key in observations:
                require(original.get('column') in ('H', 'I', 'J', 'K'))
                sheet_row = counter(original.get('sheetRow'))
                fact = (original.get('rowSeq'), original.get('sheet'),
                        original['column'] + str(sheet_row), original.get('at'), original.get('author'))
                require(observations[key] == fact)
                result['same_read_witnesses_checked'] += 1
    if result['same_read_witnesses_checked']:
        result['classes']['same_read_overlap'] = 'OBSERVED'
    if (not book['journalAvailable'] or book.get('rows') is None
            or any(result[name] for name in ('missing_rows', 'unavailable_rows', 'unread_rows'))
            or any(gap.get('book') == BOOK and gap.get('reason') == 'journal-unread' for gap in story['gaps'])):
        result['status'] = 'SAMPLE_UNAVAILABLE'
    return result


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise ValueError('PROVENANCE_REDIRECT_REFUSED')


def fetch_json(path, token, remaining):
    allowed = {'/api/provenance/health', '/api/change-story?' + urlencode({'book': BOOK, 'limit': 2000})}
    allowed.update('/api/provenance/uksimp/' + label for label in LABELS)
    require(path in allowed and remaining > 0)
    seconds = min(REQUEST_SECONDS, remaining)
    request = Request(BASE + path, method='GET', headers={'Authorization': 'Bearer ' + token,
                      'Accept': 'application/json', 'Accept-Encoding': 'identity'})
    def expired(_signum, _frame):
        raise TimeoutError('PROVENANCE_READ_TIMEOUT')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        opener = build_opener(ProxyHandler({}), NoRedirect())
        try:
            with opener.open(request, timeout=seconds) as response:
                body = response.read(BODY_LIMIT + 1)
                require(len(body) <= BODY_LIMIT)
                return response.status, json.loads(body)
        except HTTPError as error:
            error.close()
            return error.code, None  # Never read or echo an error body.
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def main():
    try:
        token = os.environ.get('AEMR_API_KEY', '')
        require(bool(token) and len(token) <= 4096 and '\n' not in token and '\r' not in token)
        deadline = time.monotonic() + TOTAL_SECONDS
        def get(path):
            return fetch_json(path, token, deadline - time.monotonic())
        status, health = get('/api/provenance/health')
        if status in (502, 503, 504):
            raise Unavailable
        require(status == 200)
        book = target_book(health)  # Validate the actual book name before using the supported filter.
        rows = {label: get('/api/provenance/uksimp/' + label) for label in LABELS}
        status, story = get('/api/change-story?' + urlencode({'book': book['dept'], 'limit': 2000}))
        if status in (502, 503, 504):
            raise Unavailable
        require(status == 200)
        result = inspect_sample(health, rows, story)
    except ValueError:
        result = {'status': 'SAMPLE_INVALID', 'full_journal_accepted': False}
    except Exception:  # noqa: BLE001 — final privacy boundary: no raw exception, token or response escapes.
        result = {'status': 'SAMPLE_UNAVAILABLE', 'full_journal_accepted': False}
    print(json.dumps(result, sort_keys=True))
    return 0 if result['status'] == 'SAMPLE_VALID' else 2


if __name__ == '__main__':
    raise SystemExit(main())
