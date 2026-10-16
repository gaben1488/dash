"""One native read-only status selection in an externally admitted API image.

No context discovery, bootstrap, writes, network or child processes. Timings are
inclusive and NON-ADDITIVE. catalog_iteration measures generator advancement
(SQL/row decoding/Python), model_json includes file read and JSON parsing.
Initial engine imports and result-shape parsing are outside native_read; lazy
imports within the native reader remain included. Never HTTP/network time.
"""
import argparse
import json
import re
import time
from contextlib import ExitStack
from datetime import date
from functools import wraps
from unittest.mock import patch

STATE = '/app/packages/server/data/reports'
RESULT_LIMIT = 32 * 1024 * 1024
COUNT_LIMIT = 1_000_000
MAX_NS = 86_400 * 1_000_000_000
PHASES = ('native_read', 'combined_selection', 'exact_selection', 'fallback_selection',
          'bundle_validation', 'artifact_inventory', 'model_json', 'catalog_iteration', 'dto_projection')


class Profile:
    def __init__(self, *, wall=None, cpu=None):
        self.wall = wall or time.perf_counter_ns
        self.cpu = cpu or time.process_time_ns
        self.metrics = {phase: {'calls': 0, 'wall_ns': 0, 'cpu_ns': 0} for phase in PHASES}
        self.clock_anomalies = 0
        self.truncated = False

    @staticmethod
    def tick(clock):
        try:
            value = clock()
            return value if type(value) is int and value >= 0 else None
        except Exception:  # noqa: BLE001 — observation cannot replace a native result/exception.
            return None

    def measure(self, phase, function, *args, **kwargs):
        if phase not in self.metrics:
            raise ValueError('PROFILE_PHASE_INVALID')
        row = self.metrics[phase]
        if row['calls'] < COUNT_LIMIT:
            row['calls'] += 1
        else:
            self.truncated = True
        wall, cpu = self.tick(self.wall), self.tick(self.cpu)
        try:
            return function(*args, **kwargs)
        finally:
            for name, start, end in (('wall_ns', wall, self.tick(self.wall)), ('cpu_ns', cpu, self.tick(self.cpu))):
                if start is None or end is None or not 0 <= end - start <= MAX_NS:
                    row[name] = None
                    self.clock_anomalies = min(COUNT_LIMIT, self.clock_anomalies + 1)
                elif row[name] is not None:
                    total = row[name] + end - start
                    row[name] = total if total <= MAX_NS else None

    def wrap(self, phase, function):
        @wraps(function)
        def measured(*args, **kwargs):
            return self.measure(phase, function, *args, **kwargs)
        return measured

    def summary(self):
        return [{'phase': phase, 'calls': row['calls'],
                 **{kind + '_ms': round(row[kind + '_ns'] / 1_000_000, 3)
                    if row['calls'] and row[kind + '_ns'] is not None else None for kind in ('wall', 'cpu')}}
                for phase, row in self.metrics.items()]


def timed_rows(function, profile):
    """Measure lazy advancement, forwarding the generator protocol unchanged."""
    class TimedIterator:
        def __init__(self, iterator):
            self.iterator = iterator
        def __iter__(self):
            return self
        def __next__(self):
            return profile.measure('catalog_iteration', next, self.iterator)
        def send(self, value):
            return profile.measure('catalog_iteration', self.iterator.send, value)
        def throw(self, *args):
            return profile.measure('catalog_iteration', self.iterator.throw, *args)
        def close(self):
            return self.iterator.close()  # Closing a suspended generator is not a query step.
    @wraps(function)
    def measured(*args, **kwargs):
        return (yield from TimedIterator(function(*args, **kwargs)))
    return measured


def run_profile(reader, store, selection, profile=None):
    profile = profile or Profile()
    targets = [(store.PublicationStore, 'select_status', 'combined_selection'),
               (store.PublicationStore, '_select', 'exact_selection'),
               (store.PublicationStore, '_latest_for_period', 'fallback_selection'),
               (store.PublicationStore, '_checked', 'bundle_validation'),
               (store, '_files', 'artifact_inventory'), (store, '_json', 'model_json'),
               (reader, '_status_projection', 'dto_projection')]
    with ExitStack() as stack:
        for target, name, phase in targets:
            stack.enter_context(patch.object(target, name, profile.wrap(phase, getattr(target, name))))
        stack.enter_context(patch.object(store, '_ordered_publication_rows', timed_rows(store._ordered_publication_rows, profile)))
        body = profile.measure('native_read', reader.read_publication, STATE, 'status', selection=selection)
    if not isinstance(body, bytes) or len(body) > RESULT_LIMIT:
        raise ValueError('PROFILE_RESULT_INVALID')
    value = json.loads(body)
    if not isinstance(value, dict) or not {'selected', 'latest_matching'} <= value.keys():
        raise ValueError('PROFILE_RESULT_INVALID')
    selected, latest = value['selected'], value['latest_matching']
    for receipt in (selected, latest):
        if receipt is not None and (not isinstance(receipt, dict) or not isinstance(receipt.get('release_id'), str)
                                   or not re.fullmatch(r'REL-[a-f0-9]{64}', receipt['release_id'])):
            raise ValueError('PROFILE_RESULT_INVALID')
    return {'state': 'NATIVE_SELECTION_PROFILE_PASS', 'scope': 'NATIVE_SINGLE_READ',
            'timings_inclusive_non_additive': True, 'result_bytes': len(body),
            'selected_present': selected is not None, 'latest_matching_present': latest is not None,
            'same_release': selected is not None and latest is not None and selected['release_id'] == latest['release_id'],
            'clock_anomalies': profile.clock_anomalies, 'counts_truncated': profile.truncated, 'phases': profile.summary()}


def parse_context(argv=None):
    class Parser(argparse.ArgumentParser):
        def error(self, message):
            raise ValueError('PROFILE_CONTEXT_INVALID')
    parser = Parser(add_help=False)
    parser.add_argument('--report-date', required=True)
    parser.add_argument('--report-year', type=int, required=True)
    parser.add_argument('--quarter', type=int, required=True)
    args = parser.parse_args(argv)
    if (date.fromisoformat(args.report_date).isoformat() != args.report_date
            or not 1900 <= args.report_year <= 9999 or args.quarter not in (1, 2, 3, 4)):
        raise ValueError('PROFILE_CONTEXT_INVALID')
    return args.report_date, args.report_year, args.quarter


def main():
    profile = Profile()
    try:
        selection = parse_context()
        from procurement_engine import publication_reader, publication_store
        result = run_profile(publication_reader, publication_store, selection, profile)
    except Exception:  # noqa: BLE001 — fixed public failure only; no raw argv/body/exception.
        result = {'state': 'NATIVE_SELECTION_PROFILE_FAILED', 'code': 'NATIVE_SELECTION_PROFILE_FAILED',
                  'scope': 'NATIVE_SINGLE_READ', 'timings_inclusive_non_additive': True,
                  'clock_anomalies': profile.clock_anomalies, 'counts_truncated': profile.truncated,
                  'phases': profile.summary()}
    print(json.dumps(result, allow_nan=False, sort_keys=True))
    return 0 if result['state'] == 'NATIVE_SELECTION_PROFILE_PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
