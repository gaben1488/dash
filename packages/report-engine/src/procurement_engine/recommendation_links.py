"""Evidence-based current links; legacy statuses never prove current fulfillment."""
import hashlib
import io
import re
import unicodedata
import zipfile
from decimal import Decimal
from functools import lru_cache

from docx import Document
from docx.text.paragraph import Paragraph

from .canonical_metrics import money
from .normalize import clean_text, normalize_grbs, normalize_id, parse_date


def _text(value):
    return clean_text(str(value or '').replace('№', '#')).casefold().replace('ё', 'е')


def _text_ids(text):
    # Scope numbers to an explicit position marker, excluding amounts and dates.
    number = r'[0-9]+[a-zа-я]*(?:[/.-][0-9a-zа-я]+)*(?![\w/.-])'
    group = f'({number}(?:\\s*[,;]\\s*{number}|\\s+и\\s+{number})*)'
    explicit = re.findall(r'(?:позици(?:ю|и|й|я)\s*#?|#)\s*' + group, text)
    leading = re.findall(r'(?:^|(?:вынести|перевести)\s+на\s+эа\s+)' + group + r'\s+(?!тыс\b|руб\b)', text)
    return list(dict.fromkeys(normalize_id(x) for values in explicit + leading
                             for x in re.split(r'\s*[,;]\s*|\s+и\s+', values))), explicit


def _subject_amounts(text, subject, business_id):
    business_id = normalize_id(business_id)
    if not business_id or not _text(subject):
        return set()
    phrase = _text(subject)
    # The full subject must belong to this number, not another sentence or a
    # longer procurement subject containing the same words.
    prefix = r'(?<!\w)(?:позици(?:ю|и|й|я)\s*#?\s*|#\s*|^|(?:вынести|перевести)\s+на\s+эа\s+)'
    reference = prefix + re.escape(business_id) + r'(?![\w/.-])\s+'
    instruction = r'(?:(?:вынести|перевести)\s+на\s+эа\s+)?'
    end = r'(?:[«"(—–-]*\s*)'
    subject_end = (r'\s*[)»"]*(?:\s+на\s+сумму\b|[.;,]?\s+планов\w*\s+сумм\w*\b'
                   r'|\s*[—–])\s*')
    amount = r'([-−]?\s*\d+(?:[ \u00a0]\d{3})*(?:[,.]\d+)?)\s*(тыс\.?\s*)?руб(?:лей|ля|ль)?\.?(?!\w)'
    output = set()
    for match in re.finditer(reference + instruction + end + re.escape(phrase) + subject_end + amount, text):
        value = Decimal(match[1].replace(' ', '').replace('\u00a0', '').replace('−', '-').replace(',', '.'))
        if value < 0:
            continue
        value = value if match[2] else value / 1000
        output.add(value)
    return output if len(output) == 1 else set()



def _exact_subject_reference(text, subject, business_id, *, shared_group_subject=False):
    """An explicit number owns the complete subject, not a price or a substring.

    Amounts are historical attributes. They cannot be invariant identity keys.
    Only recognised boundaries delimit a full subject; prose similarity is not used.
    """
    business_id = normalize_id(business_id)
    if not business_id or not _text(subject):
        return False
    prefix = r'(?<!\w)(?:позици(?:ю|и|й|я)\s*#?\s*|#\s*|^|(?:вынести|перевести)\s+на\s+эа\s+)'
    reference = prefix + re.escape(business_id) + r'(?![\w/.-])\s*(?:[—–:]\s*)?'
    instruction = r'(?:(?:вынести|перевести|провести)\s+на\s+эа\s+)?'
    subject_start = r'[«"(]*\s*'
    boundary = r'(?=\s*(?:[)»";.]|$|на\s+сумму\b|[—–]|планов\w*\s+сумм\w*\b))'
    suffix = instruction + subject_start + re.escape(_text(subject)) + boundary
    if re.search(reference + suffix, text):
        return True
    if shared_group_subject:
        # A literal shared description owns every explicitly listed member.
        # Each member still needs a unique row, the full subject, year and UID.
        number = r'[0-9]+[a-zа-я]*(?:[/.-][0-9a-zа-я]+)*(?![\w/.-])'
        group = f'({number}(?:\\s*[,;]\\s*{number}|\\s+и\\s+{number})+)'
        for match in re.finditer(prefix + group + r'\s*(?:[—–:]\s*)?' + suffix, text):
            if business_id in {normalize_id(item) for item in re.split(r'\s*[,;]\s*|\s+и\s+', match[1])}:
                return True
    return False

def _origin_registered(rec, as_of, verified_origin):
    """Require independently verified document bytes, not ledger metadata alone."""
    if not isinstance(verified_origin, dict) or verified_origin.get('grbs') != rec.get('grbs'):
        return None
    text = rec.get('recommendation_text') or ''
    digest = hashlib.sha256(text.encode()).hexdigest()
    for evidence in rec.get('origin_evidence') or []:
        if not isinstance(evidence, dict):
            continue
        date = parse_date(evidence.get('document_date'))
        doc_hash = evidence.get('document_sha256')
        if (evidence.get('kind') == 'SAVED_REPORT_RECOMMENDATION_TEXT'
            and evidence.get('text') == text and evidence.get('text_sha256') == digest
            and isinstance(doc_hash, str) and re.fullmatch(r'[0-9a-f]{64}', doc_hash)
            and date and as_of and date <= as_of
            and verified_origin.get('document_sha256') == doc_hash
            and verified_origin.get('document_date') == date
            and verified_origin.get('text_sha256') == digest
            and all(verified_origin.get(key) == evidence.get(key) for key in ('table', 'row', 'cell'))):
            return dict(verified_origin)
    return None


@lru_cache(maxsize=1)
def _original_document(content):
    # One immutable original at a time; keys are verified complete bytes, not metadata.
    return Document(io.BytesIO(content))


def verify_saved_report_origin(rec, documents):
    """Verify the exact saved DOCX occurrence; metadata alone is not provenance.

    documents maps SHA-256 to original bytes acquired and frozen by the caller.
    This establishes occurrence on the document date, not an earlier origin or fulfillment.
    """
    text = rec.get('recommendation_text') or ''
    text_hash = hashlib.sha256(text.encode()).hexdigest()
    for evidence in rec.get('origin_evidence') or []:
        if not isinstance(evidence, dict) or evidence.get('kind') != 'SAVED_REPORT_RECOMMENDATION_TEXT':
            continue
        digest = evidence.get('document_sha256')
        if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
            continue
        content = documents.get(digest)
        coordinates = [evidence.get(key) for key in ('table', 'row', 'cell')]
        day = parse_date(evidence.get('document_date'))
        if (not isinstance(content, bytes) or len(content) > 16 * 1024 * 1024
            or hashlib.sha256(content).hexdigest() != digest or not day
            or evidence.get('text') != text or evidence.get('text_sha256') != text_hash
            or any(type(value) is not int or value < 1 for value in coordinates)):
            continue
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if sum(info.file_size for info in archive.infolist()) > 64 * 1024 * 1024:
                    continue
            document = _original_document(content)
        except (zipfile.BadZipFile, ValueError, KeyError, SyntaxError):
            continue
        caption_dates = {parse_date(match[1]) for paragraph in document.paragraphs[:3]
                         if (match := re.fullmatch(r'срез на (\d{2}\.\d{2}\.\d{4})', _text(paragraph.text)))}
        if caption_dates != {day}:
            continue
        table_no, row_no, cell_no = coordinates
        if table_no > len(document.tables):
            continue
        table = document.tables[table_no - 1]
        if row_no > len(table.rows) or cell_no > len(table.rows[row_no - 1].cells):
            continue
        observed = table.cell(row_no - 1, cell_no - 1).text
        normalization = evidence.get('normalization')
        if normalization == 'NFKC_WHITESPACE_V1':
            # Normalise typography only under an explicit proof contract. Keep
            # the complete raw cell and its hash; never fuzzy-match source words.
            if (evidence.get('observed_text') != observed
                or evidence.get('observed_text_sha256') != hashlib.sha256(observed.encode()).hexdigest()
                or ' '.join(unicodedata.normalize('NFKC', observed).split())
                   != ' '.join(unicodedata.normalize('NFKC', text).split())):
                continue
        elif observed != text:
            continue
        heading = None
        for element in document.element.body:
            if element is table._tbl:
                break
            if element.tag.endswith('}p'):
                value = Paragraph(element, document).text
                # Short department headings, not arbitrary references inside body prose.
                if len(clean_text(value)) <= 80 and _heading_grbs(value):
                    heading = clean_text(value)
        if heading != clean_text(evidence.get('grbs_heading')) or _heading_grbs(heading) != rec.get('grbs'):
            continue
        return {'document_sha256': digest, 'document_date': day, 'text_sha256': text_hash,
                'table': table_no, 'row': row_no, 'cell': cell_no, 'grbs': rec['grbs']}
    return None


def _heading_grbs(value):
    # Grammar of the restored canonical report's department headings.
    match = re.fullmatch(r'(УЭР|УИО|УАГЗО|УАГИЗО|УФБП|УД|УДТХ|УКСиМП|УО)(?: АЕМР)?'
                         r'(?: \+ (?:МКУ «[^»]+»|подведомственные учреждения))?',
                         clean_text(value), re.IGNORECASE)
    return normalize_grbs(match[1]) if match else None



def _exact_subject_mention(text, subject):
    """Require the whole current subject as a literal source phrase, never fuzzy similarity."""
    phrase = _text(subject)
    return len(phrase) >= 8 and bool(re.search(r'(?<!\w)' + re.escape(phrase) + r'(?!\w)', text))


def _subject_only_candidate(rec, rows, text, snapshot_id, source_years):
    """v5 fallback for old prose that names one exact subject but no plan position.

    Group/merge wording is deliberately excluded because one visible subject cannot
    prove every historical member.  Price is not an identity key.
    """
    if rec.get('recommendation_type') == 'MERGE_PROCUREMENTS' or re.search(
            r'объедин\w*|раздроб\w*|совместн\w*|един(?:ую|ой)\s+закуп\w*|единый\s+эа', text):
        return 'GROUP_EVIDENCE_REQUIRED', None
    matches = [
        row for row in rows
        if row.grbs == rec.get('grbs')
        and row.snapshot_id == snapshot_id
        and row.subject and row.source_row_no
        and str(row.planned_year) in source_years
        and _exact_subject_mention(text, row.subject)
    ]
    if not matches:
        return 'TEXT_REFERENCE_MISSING', None
    if len(matches) != 1:
        return 'AMBIGUOUS', None
    if not matches[0].procurement_uid:
        return 'CURRENT_EVIDENCE_MISSING', None
    return 'CONFIRMED', matches[0]


def resolve_current_link(rec, rows, *, report_date, snapshot_id, verified_origin=None, legacy_group_rules=False,
                         entity_link_rules=False, exact_subject_fallback=False, shared_group_subject=False):
    """Separate current linkage from fulfillment, contract execution and payment."""
    as_of = parse_date(report_date)
    origin = _origin_registered(rec, as_of, verified_origin)
    result = {'status': 'ORIGIN_UNPROVEN', 'procurement_uids': [], 'business_ids': [],
              'source_row_keys': [], 'fulfillment': 'UNKNOWN', 'evidence_snapshot_id': snapshot_id,
              'origin': origin, 'matches': []}
    if origin is None:
        return result
    text = _text(rec.get('recommendation_text'))
    ids, _ = _text_ids(text)
    result['required_business_ids'] = ids
    explicit_years = set(re.findall(r'\b(20\d{2})(?:[-–](?:м|й|го|му|е))?\s*(?:год(?:а|у|ом|е)?\b|г\.)', text))
    explicit_years.update(re.findall(r'\b(?:план|период)\w*\s+(20\d{2})\b', text))
    source_years = explicit_years or {origin['document_date'][:4]}
    if len(source_years) != 1:
        result['status'] = 'PERIOD_EVIDENCE_REQUIRED'
        return result
    if not ids:
        if not exact_subject_fallback:
            result['status'] = 'TEXT_REFERENCE_MISSING'
            return result
        status, row = _subject_only_candidate(rec, rows, text, snapshot_id, source_years)
        result['status'] = status
        if row is None:
            return result
        result.update(status='CONFIRMED', procurement_uids=[row.procurement_uid],
            business_ids=[row.source_row_no], source_row_keys=[row.physical_row_key],
            matches=[{'source_row_key': row.physical_row_key, 'procurement_uid': row.procurement_uid,
                      'business_id': row.source_row_no, 'subject': row.subject,
                      'plan_amount_thousand_decimal': format(money(row, 'plan'), 'f'),
                      'planned_year': row.planned_year, 'method': row.method,
                      'recorded_fact_date': row.actual_date,
                      'match_basis': 'EXACT_DOCUMENT_SUBJECT_AND_CURRENT_UID',
                      'amount_is_identity_key': False}])
        return result
    if entity_link_rules:
        # A new calendar year does not erase the still observed prior-year plan.
        candidates = [row for row in rows if row.grbs == rec.get('grbs')
            and normalize_id(row.source_row_no) in ids and row.snapshot_id == snapshot_id
            and row.subject and str(row.planned_year) in source_years
            and _exact_subject_reference(text, row.subject, normalize_id(row.source_row_no),
                                         shared_group_subject=shared_group_subject)]
    else:
        if explicit_years - {as_of[:4]}:
            result['status'] = 'PERIOD_EVIDENCE_REQUIRED'
            return result
        candidates = [row for row in rows if row.grbs == rec.get('grbs')
            and normalize_id(row.source_row_no) in ids
            and row.snapshot_id == snapshot_id and row.subject
            and money(row, 'plan') in _subject_amounts(text, row.subject, normalize_id(row.source_row_no))
            and (not row.planned_year or not explicit_years or str(row.planned_year) in explicit_years)
            and (not row.planned_year or int(row.planned_year) == int(as_of[:4]))]
    if legacy_group_rules and (len(ids) != 1 or re.search(r'объедин|совместн|единую закуп|раздроб', text)):
        # Replay old immutable releases with their original single-only contract.
        result['status'] = 'GROUP_EVIDENCE_REQUIRED'
        return result
    # Every explicitly named member needs its own full subject, own amount and
    # unique current identity. A group sum or an incomplete subset is not proof.
    by_id = {business_id: [row for row in candidates if normalize_id(row.source_row_no) == business_id]
             for business_id in ids}
    if any(len(matches) > 1 for matches in by_id.values()):
        result['status'] = 'AMBIGUOUS'
        return result
    if any(not matches or not matches[0].procurement_uid for matches in by_id.values()):
        result['status'] = 'GROUP_EVIDENCE_REQUIRED' if len(ids) > 1 else 'CURRENT_EVIDENCE_MISSING'
        return result
    linked = [by_id[business_id][0] for business_id in ids]
    if len({row.procurement_uid for row in linked}) != len(linked):
        # A proven merge needs a separate dated relation, not UID reuse in a row.
        result['status'] = 'AMBIGUOUS'
        return result
    result.update(status='CONFIRMED', procurement_uids=[row.procurement_uid for row in linked],
        business_ids=[row.source_row_no for row in linked], source_row_keys=[row.physical_row_key for row in linked],
        matches=[{'source_row_key': row.physical_row_key, 'procurement_uid': row.procurement_uid,
                  'business_id': row.source_row_no, 'subject': row.subject,
                  'plan_amount_thousand_decimal': format(money(row, 'plan'), 'f'),
                  'planned_year': row.planned_year, 'method': row.method,
                  'recorded_fact_date': row.actual_date} for row in linked])
    if entity_link_rules:
        for match in result['matches']:
            match['match_basis'] = 'EXACT_DOCUMENT_REFERENCE_AND_CURRENT_UID'
            match['amount_is_identity_key'] = False
    return result
