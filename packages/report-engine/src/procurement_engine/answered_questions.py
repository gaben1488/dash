"""Keep a dated source answer separate from proof of current implementation."""
import hashlib
import re

from .normalize import clean_text
from .recommendation_links import _original_document


def saved_answer(record, origin, documents, rows=()):
    """Read neighbouring answer cells only after the original occurrence is verified.

    The caller supplies verify_saved_report_origin's result. Generated status
    appendices in column 4 are deliberately excluded from the source answer.
    """
    if not origin or origin.get('kind') or origin.get('cell') != 2:
        return None
    digest = origin['document_sha256']
    content = documents.get(digest)
    if not content or hashlib.sha256(content).hexdigest() != digest:
        return None
    table = _original_document(content).tables[origin['table'] - 1]
    if len(table.columns) != 4 or [clean_text(c.text) for c in table.rows[0].cells][1:3] != [
            'Рекомендация', 'Ответ ГРБС на рекомендацию']:
        return None
    cells = table.rows[origin['row'] - 1].cells
    response = clean_text(record.get('grbs_response_original'))
    decision = clean_text(record.get('uer_decision_original'))
    if response != clean_text(cells[2].text):
        return None
    # The saved report appends its own calculated status on a separate line.
    source_decision = re.split(r'(?:^|\n)\s*25\.09:', cells[3].text, maxsplit=1)[0]
    if decision != clean_text(source_decision):
        return None
    text = decision.casefold().replace('ё', 'е')
    kind = None
    if re.fullmatch(r'закупка удалена из плана\s*[-–]\s*реестра\.?', text):
        kind = 'WITHDRAWN_REPORTED'
    elif re.fullmatch(r'закупка не будет проводиться, нет финансирования\.?', text):
        kind = 'NO_FUNDING_REPORTED'
    elif (text == 'принято уэр' or text.startswith('принято уэр ')) and re.search(
            r'позиция не\s+принята|нецелесообраз|предлагают перераспределить', response.casefold()):
        kind = 'OBJECTION_ACCEPTED_REPORTED'
    elif re.fullmatch(r'закупка производится через еп|заключено с еп|'
                      r'закуплено через электронную процедуру, но не объединены в единую закупку\.|'
                      r'закуплено через электронную процедуру, сумма изменена на [\d ,]+ тыс\. руб\.|'
                      r'контракт заключен [\d ,]+ тыс\. руб\.', text):
        kind = 'RESULT_REPORTED'
    elif (re.fullmatch(r'при планировании закупочной деятельности на 2027 год учтут рекомендацию\.?', response.casefold())
          and 'проконсультироваться' in text):
        kind = 'FUTURE_PLANNING_REPORTED'
    elif ('объединить в единую закупку не представляется возможным' in response.casefold()
          and not decision):
        kind = 'GROUP_CONSTRAINT_REPORTED'
    coverage = _covered_group_answer(record, text, rows) if kind is None else None
    if coverage:
        kind = 'MEMBER_RESULTS_REPORTED'
    if kind is None:
        return None
    return {'kind': kind, 'as_of': origin['document_date'], 'response': response,
            'decision': decision, 'document_sha256': digest,
            'table': origin['table'], 'row': origin['row'], 'response_cell': 3,
            'decision_cell': 4, 'scope': 'DATED_SOURCE_ANSWER',
            'proves_current_implementation': False,
            **({'member_evidence': coverage} if coverage else {})}


def _covered_group_answer(record, decision, rows):
    """Account for EACH named member; a partial group answer cannot close the group."""
    from .recommendation_links import _text, _text_ids

    original = _text(record.get('recommendation_text'))
    if re.search(r'\b(?:если|возможно|ранее|пример|предположим|неизвестно)\b|'
                 r'не подтверждено|[?«»"“”]', decision):
        return False
    ids, _ = _text_ids(original, joint_method_reference=True)
    if not ids:
        match = re.match(r'^объединить в единую электронную процедуру ([\d, ]+) ', original)
        ids = re.findall(r'\d+', match[1]) if match else []
    if len(ids) < 2:
        return False
    covered = set()
    for match in re.finditer(r'(?<!\w)(\d+(?:\s*,\s*\d+)*)\s+(?:заключен[оы]? с еп|'
            r'закупк[аи] не (?:будет|будут) проводиться, нет финансирования|'
            r'удалена из плана\s*-\s*реестра|указан способ определения поставщика\s*-\s*еп)', decision):
        covered.update(re.findall(r'\d+', match[1]))
    if not covered or not covered <= set(ids):
        return False
    missing = set(ids) - covered
    # A current explicit full subject and the listed member can supplement a
    # dated partial answer. This is a source statement, not a group UID merge.
    current_quotes = []
    for number in missing:
        candidates = [r for r in rows if r.grbs == record.get('grbs') and r.source_row_no == number]
        if len(candidates) != 1 or not candidates[0].procurement_uid:
            return False
        candidate = candidates[0]
        subject = _text(candidate.subject)
        # Whole enumerated subjects only, never word similarity or prices.
        if not re.search(r'(?<!\w)' + re.escape(subject) + r'(?=\s*(?:,|–|—|на\s+общую\s+сумму|$))', original):
            return False
        if candidate.method != 'ЕП' or _text(candidate.grbs_comment) != 'договор заключен':
            return False
        current_quotes.append({'source_row_key': candidate.physical_row_key,
            'subject': candidate.subject, 'column': 'AF', 'quote': candidate.grbs_comment,
            'snapshot_id': candidate.snapshot_id})
    return {'member_ids': ids, 'dated_answer_member_ids': sorted(covered),
            'current_source_statements': current_quotes}


def yearlong_stage(row, sources):
    """Same structural stage as shared/yearlong-stage.ts, including RAW Q markers.

    Stage is not the curated procurement kind, contract count or completion.
    A missing kind is neutral under the owner's §83 decision.
    """
    if row.get('method') != 'ЕП':
        return False
    for source in sources:
        if source.get('provider_id') != row.get('source_id') or source.get('sheet') != row.get('sheet_name'):
            continue
        values = source.get('values') or []
        number = row.get('row_number')
        if not isinstance(number, int) or not 1 <= number <= len(values):
            return False
        raw = values[number - 1]
        return clean_text(raw[16] if len(raw) > 16 else '').casefold() in {'', 'х', 'x'}
    return False


def literal_action(record, rows, source_ids):
    """Recognise a complete instruction using the source's explicit plan label."""
    from .action_spec import compile_action
    from .recommendation_links import _text, literal_plan_label

    if len(source_ids) != 1 or len(rows) != 1:
        return None
    original = record.get('recommendation_text') or ''
    text = re.sub(r'(?i)\bна\s+единый\s+эа\b', 'на ЭА', original)
    subject = literal_plan_label(rows[0].subject, rows[0].grbs)
    result = compile_action(text, source_ids=source_ids,
        subjects=[(rows[0].source_row_no, subject)], reference_grammar=True,
        subject_reference_grammar=True, literal_open_quote=True, inflected_supply_subject=True)
    if result:
        return {**result, 'source_text': clean_text(original)}
    subject = _text(rows[0].subject)
    if subject.startswith('оказание услуг '):
        name = re.escape('оказанию услуг ' + subject[len('оказание услуг '):])
        amount = r'\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)?\s*(?:тыс\.?\s*)?руб(?:лей|ля|ль)?\.?'
        if re.fullmatch(r'замена\s+типа\s+процедуры\s+по\s+' + name
                + r'\s+' + amount + r'\s+с\s+еп\s+на\s+эп\s*[.;]?', _text(original)):
            return {'contract': 'original-action-v3', 'source_text': clean_text(original),
                    'source_ids': list(source_ids), 'type': 'CHANGE_METHOD_EP', 'target_method': 'ЭА'}
    return None


def saved_discussion_answer(record, origin, rows, sources, report_date):
    """A complete quoted subject owns the discussion; an opaque anchor is not guessed."""
    if not origin or record.get('recommendation_type') != 'MERGE_PROCUREMENTS':
        return None
    from .recommendation_links import _text

    names = re.findall('«([^»]+)»', record.get('recommendation_text') or '')
    if len(names) != 1:
        return None
    matches = []
    for source in sources:
        if source.get('grbs') != record.get('grbs') or source.get('role') != 'master':
            continue
        for discussion in (source.get('formula_evidence') or {}).get('discussions', []):
            if (discussion.get('deleted') or not discussion.get('id')
                    or any(reply.get('content') and not reply.get('deleted')
                           for reply in discussion.get('replies', []))):
                continue
            scope = re.fullmatch(r'объединение с мероприятием по монтажу/демонтажу (.+)',
                                 _text(discussion.get('content')))
            if not scope:
                continue
            phrase = 'изготовлению ' + scope[1]
            if phrase not in _text(names[0]):
                continue
            expanded = _text(names[0]).replace(phrase, 'изготовлению и монтажу/демонтажу ' + scope[1], 1)
            quoted = (discussion.get('quotedFileContent') or {}).get('value')
            if _text(quoted) != expanded:
                continue
            candidates = [r for r in rows if r.source_id == source['provider_id']
                and r.sheet_name == source['sheet'] and r.procurement_uid and _text(r.subject) == expanded]
            if len(candidates) == 1:
                matches.append((source, discussion, candidates[0]))
    if len(matches) != 1:
        return None
    source, discussion, row = matches[0]
    return {'kind': 'GROUP_SCOPE_REPORTED', 'as_of': report_date,
        'response': '', 'decision': discussion['content'] + '. Текущий предмет: ' + row.subject,
        'document_sha256': origin['document_sha256'], 'table': origin['table'], 'row': origin['row'],
        'response_cell': 3, 'decision_cell': 4, 'scope': 'QUOTED_GOOGLE_DISCUSSION',
        'discussion_evidence': {'source_id': source['provider_id'], 'sheet': source['sheet'],
            'row': row.row_number, 'id': discussion['id'], 'quote': discussion['content'],
            'quoted_subject': row.subject, 'author': (discussion.get('author') or {}).get('displayName'),
            'created_at': discussion.get('createdTime'), 'modified_at': discussion.get('modifiedTime'),
            'snapshot_id': row.snapshot_id},
        'proves_current_implementation': False}
