"""Conservative dependency closure, not a spreadsheet recalculation engine."""
from __future__ import annotations

import re

from .snapshot import canonical_semantic_hash

# Unknown/custom functions require review. Dynamic/external functions are deliberately absent.
# Native vocabulary: https://support.google.com/docs/table/25273?hl=en
NATIVE_FUNCTIONS = frozenset('''ABS AND ARRAYFORMULA CHAR COLUMNS COUNTA COUNTIF COUNTIFS EXACT FILTER FIND
IF IFERROR IFNA INDEX ISBLANK ISERROR ISFORMULA ISNUMBER LAMBDA LEFT LEN LET LOWER MAP MATCH MAX MID MIN MOD
MONTH N NOT OFFSET OR REGEXEXTRACT REGEXMATCH REGEXREPLACE RIGHT ROUND ROUNDUP ROW ROWS SEQUENCE
SEARCH SORT SPLIT SUBSTITUTE SUM SUMIF SUMIFS SUMPRODUCT TEXT TEXTJOIN TODAY TO_TEXT TRIM UNIQUE VALUE VLOOKUP YEAR
TRUE FALSE'''.split())  # noqa: SIM905 — compact, reviewed vocabulary is easier to audit by function name.
TOKEN = re.compile(r'"(?:[^"]|"")*"|\'(?:[^\']|\'\')*\'|\$?[A-Za-z]{1,3}\$?\d+(?!\w)|[^\W\d][\w.]*|\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?|[^\s]', re.UNICODE)


def _arguments(tokens, opening):
    """Split only at this call's argument depth (nested calls and array literals stay intact)."""
    result, start, depth = [], opening + 1, 0
    for i in range(start, len(tokens)):
        if tokens[i] in ('(', '{'):
            depth += 1
        elif tokens[i] in (')', '}'):
            if depth == 0:
                return [*result, (start, i)]
            depth -= 1
        elif tokens[i] in (',', ';') and depth == 0:
            result.append((start, i)); start = i + 1
    return []


def _formula_dependencies(formula, named_ranges, sheets):
    tokens = TOKEN.findall(formula)
    declarations, local_names, local_functions = set(), [], []
    for i, token in enumerate(tokens[:-1]):
        if token.upper() in ('LET', 'LAMBDA') and tokens[i + 1] == '(':
            args = _arguments(tokens, i + 1)
            if not args:
                continue
            if token.upper() == 'LET':
                for (a, b), (c, d) in zip(args[:-1:2], args[1:-1:2], strict=False):
                    if b - a == 1:
                        declarations.add(a)
                        binding = (tokens[a].upper(), d + 1, args[-1][1])
                        local_names.append(binding)
                        if [t.upper() for t in tokens[c:c + 2]] == ['LAMBDA', '(']:
                            local_functions.append(binding)
            else:
                for a, b in args[:-1]:
                    if b - a == 1:
                        declarations.add(a)
                        local_names.append((tokens[a].upper(), args[-1][0], args[-1][1]))
    unknown, targets = set(), set()
    for i, token in enumerate(tokens):
        if token.startswith('"'):
            continue
        upper = token.upper()
        is_name = bool(re.match(r'[^\W\d]', token))
        if i + 1 < len(tokens) and tokens[i + 1] == '(' and is_name:
            if upper not in NATIVE_FUNCTIONS and not any(n == upper and a <= i < b for n, a, b in local_functions):
                unknown.add(token)
        elif (is_name and i not in declarations and upper not in NATIVE_FUNCTIONS
              and token not in named_ranges and not (i + 1 < len(tokens) and tokens[i + 1] == '!')
              and not re.fullmatch(r'\$?[A-Za-z]{1,3}\$?\d+', token)
              and not (re.fullmatch(r'[A-Za-z]{1,3}', token) and
                       ((i + 1 < len(tokens) and tokens[i + 1] == ':')
                        or (i > 0 and tokens[i - 1] == ':')
                        or (i > 1 and tokens[i - 2:i] == [':', '$'])))
              and not any(n == upper and a <= i < b for n, a, b in local_names)):
            unknown.add(token)
        if i + 1 < len(tokens) and tokens[i + 1] == '!':
            title = token[1:-1].replace("''", "'") if token.startswith("'") else token
            targets.add(sheets.get(title, f'unknown:{title}'))
        if token in named_ranges:
            targets.add(named_ranges[token]['sheetId'])
    return unknown, targets


def audit_formula_dependencies(capture):
    sources = capture.get('sources') or []
    index = {(s['provider_id'], s['sheet_id']): s['source_id'] for s in sources}
    issues, edges, contexts = [], set(), {}

    def problem(sid, code, **details):
        issues.append({'code': code, 'source_id': sid, **details})

    for s in sources:
        sid = s['source_id']; evidence = s.get('formula_evidence')
        if not isinstance(evidence, dict):
            problem(sid, 'FORMULA_EVIDENCE_MISSING'); continue
        if (evidence.get('rows') != s['rows'] or evidence.get('columns') != s['columns']
                or not isinstance(evidence.get('formulas'), list)):
            problem(sid, 'FORMULA_GRID_INCOMPLETE'); continue
        book_context = {'sheets': evidence.get('sheets'), 'named_ranges': evidence.get('named_ranges')}
        if not isinstance(book_context['sheets'], list) or not isinstance(book_context['named_ranges'], list):
            problem(sid, 'FORMULA_CONTEXT_MISSING'); continue
        context_hash = canonical_semantic_hash(book_context)
        previous = contexts.setdefault(s['provider_id'], context_hash)
        if previous != context_hash:
            problem(sid, 'FORMULA_CONTEXT_CHANGED')
        sheets = {p['title']: p['sheetId'] for p in evidence['sheets']}
        names = {p['name']: p['range'] for p in evidence['named_ranges']}
        if sheets.get(s['sheet']) != s['sheet_id'] or len(names) != len(evidence['named_ranges']):
            problem(sid, 'FORMULA_CONTEXT_INVALID'); continue
        for cell in evidence['formulas']:
            if (not isinstance(cell.get('formula'), str) or not cell['formula'].startswith('=')
                    or not 1 <= cell.get('row', 0) <= s['rows']
                    or not 1 <= cell.get('column', 0) <= s['columns']):
                problem(sid, 'FORMULA_CELL_INVALID'); continue
            functions, targets = _formula_dependencies(cell['formula'], names, sheets)
            if functions:
                problem(sid, 'FORMULA_FUNCTION_UNVERIFIED', row=cell['row'], column=cell['column'],
                        functions=sorted(functions))
            for target in targets:
                target_id = index.get((s['provider_id'], target))
                if target_id is None:
                    problem(sid, 'FORMULA_DEPENDENCY_NOT_CAPTURED', row=cell['row'],
                            column=cell['column'], target_sheet_id=target)
                elif target_id != sid:
                    edges.add((sid, target_id))
    return {'closed': bool(sources) and not issues, 'issues': issues,
            'edges': [{'from': a, 'to': b} for a, b in sorted(edges)],
            'scope': 'Captured native formulas and registered in-workbook dependencies; business event completeness is not inferred.'}
