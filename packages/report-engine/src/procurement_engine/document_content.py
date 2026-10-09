"""Validate the visible OOXML against an independently stored business text plan.

Checks ordered paragraphs, table rows/cells, unplanned stories, hidden/revision
content and the complete block catalogue. ZIP checksums alone are insufficient.
The trusted input is the source-audited model, not the writer's DOCX manifest.
"""
from __future__ import annotations

import zipfile
from pathlib import Path

from lxml import etree

from .document_plan import build_main_plan, build_management_plan
from .operational_plan import build_operational_plan
from .snapshot import canonical_semantic_hash

CONTRACT = 'document-plan-v1'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
MAX_UNPACKED = 64 * 1024 * 1024


def planned_documents(model):
    plans = {'main': build_main_plan(model), 'management': build_management_plan(model)}
    if (model.get('contract') or {}).get('operational_document_contract') == 'operational-report-v1':
        plans['operational'] = build_operational_plan(model)
    return plans


def _value(model, pointer):
    value = model
    for key in pointer.strip('/').split('/'):
        key = key.replace('~1', '/').replace('~0', '~')
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def validate_document_plans(model):
    try:
        expected = planned_documents(model)
        if canonical_semantic_hash(model.get('document_plans')) != canonical_semantic_hash(expected):
            return False
        for plan in expected.values():
            seen = set()
            for block in plan['blocks']:
                if block['block_id'] in seen or not block['model_paths'] or not block['template_rule_id']:
                    return False
                seen.add(block['block_id'])
                for item in [block, *block.get('cells', [])]:
                    if not item['model_paths'] or not item['template_rule_id']:
                        return False
                    for path in item['model_paths']:
                        _value(model, path)
        return True
    except (KeyError, IndexError, TypeError, ValueError):
        return False


def _paragraph_text(node):
    result = []
    for child in node.iter():
        if child.tag == W + 't':
            result.append(child.text or '')
        elif child.tag in {W + 'br', W + 'cr'}:
            result.append('\n')
        elif child.tag == W + 'tab':
            result.append('\t')
    return ''.join(result)


def _body_blocks(root):
    body = root.find(W + 'body')
    if body is None:
        raise ValueError('DOCUMENT_CONTENT_BODY_MISSING')
    result = []
    for child in body:
        if child.tag == W + 'p':
            result.append({'kind': 'paragraph', 'text': _paragraph_text(child)})
        elif child.tag == W + 'tbl':
            rows = []
            for row in child.findall(W + 'tr'):
                cells = []
                for cell in row.findall(W + 'tc'):
                    if cell.find('.//' + W + 'tbl') is not None:
                        raise ValueError('DOCUMENT_CONTENT_NESTED_TABLE')
                    cells.append('\n'.join(_paragraph_text(p) for p in cell.findall(W + 'p')))
                rows.append(cells)
            result.append({'kind': 'table', 'rows': rows})
        elif child.tag != W + 'sectPr':
            raise ValueError('DOCUMENT_CONTENT_UNEXPECTED_BLOCK')
    return result


def read_document_content(path):
    """Inspect all Word story parts, including content normal doc.paragraphs omits."""
    try:
        with zipfile.ZipFile(Path(path)) as archive:
            files = archive.infolist()
            if (len(files) != len({item.filename for item in files}) or len(files) > 256
                or sum(item.file_size for item in files) > MAX_UNPACKED):
                raise ValueError('DOCUMENT_CONTENT_PACKAGE_LIMIT')
            main = None
            forbidden = {'ins', 'del', 'moveFrom', 'moveTo', 'vanish', 'webHidden', 'sdt',
                         'fldSimple', 'instrText', 'fldChar', 'drawing', 'pict', 'object', 'altChunk',
                         'commentRangeStart', 'commentReference', 'footnoteReference', 'endnoteReference'}
            forbidden = {W + tag for tag in forbidden}
            for item in files:
                name = item.filename
                if not name.endswith(('.xml', '.rels')):
                    continue
                data = archive.read(item)
                if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
                    raise ValueError('DOCUMENT_CONTENT_ENTITY')
                root = etree.fromstring(data, parser=etree.XMLParser(resolve_entities=False, no_network=True))
                if name == '_rels/.rels':
                    main_links = [node for node in root if node.get('Type', '').endswith('/officeDocument')]
                    if (len(main_links) != 1 or main_links[0].get('Target') != 'word/document.xml'
                            or main_links[0].get('TargetMode') == 'External'):
                        raise ValueError('DOCUMENT_CONTENT_MAIN_RELATIONSHIP')
                if any(node.tag in forbidden for node in root.iter()):
                    raise ValueError('DOCUMENT_CONTENT_UNSUPPORTED_MARKUP')
                if name == 'word/document.xml':
                    main = _body_blocks(root)
                elif any(node.text for node in root.iter(W + 't')):
                    raise ValueError('DOCUMENT_CONTENT_UNPLANNED_STORY')
            if main is None or '_rels/.rels' not in archive.namelist():
                raise ValueError('DOCUMENT_CONTENT_BODY_MISSING')
            return main
    except (OSError, zipfile.BadZipFile, etree.XMLSyntaxError) as exc:
        raise ValueError('DOCUMENT_CONTENT_INVALID_PACKAGE') from exc


def validate_document_content(path, plan):
    expected = [{'kind': block['kind'], **({
        'text': block['text']} if block['kind'] == 'paragraph' else {'rows': block['rows']})}
                for block in plan['blocks']]
    if read_document_content(path) != expected:
        raise ValueError('DOCUMENT_CONTENT_MISMATCH')
