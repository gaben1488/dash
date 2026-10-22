"""Reviewed spellings exported from shared/SUBORDINATE_REGISTRY, never fuzzy names.

The packaged JSON is checked against that registry by test_customer_identity_aliases.
Source text and legacy row/identity fingerprints remain unchanged.
"""
import json
import re
from pathlib import Path

from .normalize import clean_text, normalize_grbs


def _spelling(value):
    text = clean_text(value).casefold().replace('ё', 'е')
    text = re.sub('[«»„“”]', '"', text)
    text = re.sub(r'\bno\s*(?=\d)', 'no', text)  # clean_text NFKC maps № to No.
    return re.sub(r'\s*\.\s*', '.', text)


_NAMES = {}
for _entry in json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8')):
    for _name in (_entry['canonicalName'], _entry['legacyCanonicalName']):
        _key = (normalize_grbs(_entry['grbsId']), _spelling(_name))
        if _key in _NAMES and _NAMES[_key] != _entry['id']:
            raise ValueError('SUBORDINATE_HISTORIC_ALIAS_CONFLICT')
        _NAMES[_key] = _entry['id']


def customer_name_key(grbs, name):
    """Resolve only registered names in their department; preserve unknown names."""
    return _NAMES.get((normalize_grbs(grbs), _spelling(name)), name)


def customer_anchor(value):
    source, grbs, name, subject, year = json.loads(value)
    return json.dumps([source, grbs, customer_name_key(grbs, name), subject, year],
                      ensure_ascii=False, separators=(',', ':'))
