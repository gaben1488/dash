"""Strict projection of bounded host lifecycle evidence; never emit raw messages."""
import json
import math
import re

SERVICES = {'server', 'report-worker', 'web', 'caddy'}
ACTIONS = {'start', 'stop', 'restart', 'die', 'kill', 'oom',
           'health_status: healthy', 'health_status: unhealthy'}


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _json(raw):
    if not isinstance(raw, str) or len(raw.encode()) > 1024 * 1024:
        raise ValueError('LIFECYCLE_INPUT_UNAVAILABLE')
    return json.loads(raw)


def project_lifecycle(state_raw, journal_raw, events_raw, policy_raw=None):
    result = {'guard_state': {'available': False}, 'guard_journal': {'available': False},
              'docker_events': {'available': False}, 'guard_policy': {'available': False}}
    try:
        policy = _json(policy_raw)
        threshold = policy.get('failure_threshold', 3)
        cooldown = policy.get('cooldown_seconds', 300)
        assert type(threshold) is int and threshold > 0 and _number(cooldown)
        result['guard_policy'] = {'available': True, 'failure_threshold': threshold,
                                  'cooldown_seconds': cooldown}
    except (ValueError, TypeError, AttributeError, AssertionError):
        pass
    try:
        state = _json(state_raw)
        assert isinstance(state, dict)
        result['guard_state'] = {'available': True,
            **{key: {service: value for service, value in state.get(key, {}).items()
                     if service in SERVICES and _number(value)}
               for key in ('failures', 'last_recovery') if isinstance(state.get(key), dict)}}
        if _number(state.get('checked_at')):
            result['guard_state']['checked_at'] = state['checked_at']
    except (ValueError, TypeError, AssertionError):
        pass
    for category, raw in (('guard_journal', journal_raw), ('docker_events', events_raw)):
        try:
            if not isinstance(raw, str) or len(raw.encode()) > 1024 * 1024:
                raise ValueError('LIFECYCLE_INPUT_UNAVAILABLE')
            records = []
            for line in raw.splitlines():
                item = _json(line)
                if not isinstance(item, dict):
                    continue
                if category == 'guard_journal':
                    try:
                        event = _json(item.get('MESSAGE'))
                    except (ValueError, TypeError):
                        continue
                    if not isinstance(event, dict) or event.get('service') not in SERVICES:
                        continue
                    if event.get('event') not in {'start', 'restart', 'recovery_failed'}:
                        continue
                    stamp = item.get('__REALTIME_TIMESTAMP', '')
                    if not isinstance(stamp, str) or not re.fullmatch(r'\d{1,18}', stamp):
                        continue
                    records.append({'at_us': int(stamp), 'service': event['service'],
                                    'event': event['event']})
                elif item.get('Action') in ACTIONS and type(item.get('timeNano')) is int and item['timeNano'] >= 0:
                    record = {'at_ns': item['timeNano'], 'event': item['Action']}
                    attrs = (item.get('Actor') or {}).get('Attributes') or {}
                    for key in ('exitCode', 'signal'):
                        value = attrs.get(key)
                        if isinstance(value, str) and re.fullmatch(r'\d{1,3}', value):
                            record[key] = int(value)
                    records.append(record)
            result[category] = {'available': True, 'records': records}
        except (ValueError, TypeError, AttributeError):
            pass
    return result
