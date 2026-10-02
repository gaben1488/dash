"""Bounded, read-only OOXML evidence. No formulas are executed or recalculated."""
from __future__ import annotations

import hashlib
import io
import math
import posixpath
import re
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET

from openpyxl.formula.translate import Translator, TranslatorError

NS = {
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
# Resource bounds, not procurement thresholds. Enforced before dense allocation.
MAX_PACKAGE_BYTES = 128 * 1024 * 1024
MAX_EXPANDED_BYTES = 512 * 1024 * 1024
MAX_MEMBER_BYTES = 256 * 1024 * 1024
MAX_MEMBERS = 10000
MAX_ROWS = 200000
MAX_COLUMNS = 512
MAX_DENSE_CELLS = 8_000_000


class XlsxEvidenceError(ValueError):
    """Fixed code plus optional private source coordinate; never silently repaired."""


def _colnum(ref: str) -> int:
    match = re.fullmatch(r'([A-Z]+)([1-9][0-9]*)', ref)
    if not match:
        raise XlsxEvidenceError('XLSX_CELL_REFERENCE_INVALID')
    n = 0
    for char in match[1]:
        n = n * 26 + ord(char) - 64
    if n > MAX_COLUMNS or int(match[2]) > MAX_ROWS:
        raise XlsxEvidenceError('XLSX_GRID_LIMIT')
    return n - 1


def checked_members(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    members = archive.infolist()
    if len(members) > MAX_MEMBERS or sum(item.file_size for item in members) > MAX_EXPANDED_BYTES:
        raise XlsxEvidenceError('XLSX_PACKAGE_LIMIT')
    result = {}
    for item in members:
        name = item.filename
        normalized = str(PurePosixPath(name))
        if (not name or '\\' in name or ':' in name or name.startswith('/')
            or '..' in PurePosixPath(name).parts or normalized != name.rstrip('/')
            or stat.S_ISLNK(item.external_attr >> 16) or item.flag_bits & 1):
            raise XlsxEvidenceError('XLSX_UNSAFE_MEMBER')
        if normalized in result:
            raise XlsxEvidenceError('XLSX_DUPLICATE_MEMBER')
        if item.file_size > MAX_MEMBER_BYTES:
            raise XlsxEvidenceError('XLSX_PACKAGE_LIMIT')
        result[normalized] = item
    return result


def _xml(archive, name):
    content = archive.read(name)
    # OOXML parts do not need DTDs. Null removal also catches UTF-16/32 spelling.
    scan = content.replace(b'\x00', b'').upper()
    if b'<!DOCTYPE' in scan or b'<!ENTITY' in scan:
        raise XlsxEvidenceError('XLSX_UNSAFE_XML')
    try:
        return ET.fromstring(content)
    except ET.ParseError as error:
        raise XlsxEvidenceError('XLSX_XML_INVALID') from error


@dataclass(frozen=True)
class SheetEvidence:
    name: str
    sheet_id: int
    rows: list[tuple[int, list]]
    formulas: list[dict]

    def matrix(self, *, min_rows=1, min_columns=1):
        rows = max([min_rows, *(number for number, _ in self.rows)])
        columns = max([min_columns, *(len(row) for _, row in self.rows)])
        if rows > MAX_ROWS or columns > MAX_COLUMNS or rows * columns > MAX_DENSE_CELLS:
            raise XlsxEvidenceError('XLSX_GRID_LIMIT')
        result = [[] for _ in range(rows)]
        for number, row in self.rows:
            result[number - 1] = list(row)
        return result, columns


class WorkbookEvidence:
    """An immutable byte buffer; coordinate and cached-value proof for an export."""

    def __init__(self, content: bytes):
        if not isinstance(content, bytes) or len(content) > MAX_PACKAGE_BYTES:
            raise XlsxEvidenceError('XLSX_PACKAGE_LIMIT')
        self.content = content
        self.sha256 = hashlib.sha256(content).hexdigest()
        self.sheets: dict[str, tuple[int, str]] = {}
        self.named_ranges: list[dict] = []
        self._shared: list[str] = []
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                members = checked_members(archive)
                if any('vbaproject' in name.casefold() for name in members):
                    raise XlsxEvidenceError('XLSX_ACTIVE_CONTENT_UNSUPPORTED')
                workbook = _xml(archive, 'xl/workbook.xml')
                props = workbook.find('m:workbookPr', NS)
                if props is not None and props.get('date1904', '').lower() in {'1', 'true'}:
                    raise XlsxEvidenceError('XLSX_DATE_EPOCH_UNSUPPORTED')
                relationships = _xml(archive, 'xl/_rels/workbook.xml.rels')
                relations = {}
                for relation in relationships:
                    key = relation.get('Id')
                    if not key or key in relations:
                        raise XlsxEvidenceError('XLSX_RELATIONSHIP_INVALID')
                    relations[key] = relation
                identifiers = set()
                for sheet in workbook.findall('m:sheets/m:sheet', NS):
                    name = sheet.get('name'); key = sheet.get(f"{{{NS['r']}}}id")
                    identifier = int(sheet.get('sheetId', '-1'))
                    relation = relations.get(key)
                    if not name or name in self.sheets or identifier < 0 or identifier in identifiers or relation is None:
                        raise XlsxEvidenceError('XLSX_SHEET_IDENTITY_INVALID')
                    target = relation.get('Target', '')
                    if not target or relation.get('TargetMode') == 'External' or '\\' in target or ':' in target:
                        raise XlsxEvidenceError('XLSX_EXTERNAL_SHEET_UNSUPPORTED')
                    target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
                    if not target.startswith('xl/') or target not in members:
                        raise XlsxEvidenceError('XLSX_SHEET_TARGET_INVALID')
                    self.sheets[name] = identifier, target
                    identifiers.add(identifier)
                for item in workbook.findall('m:definedNames/m:definedName', NS):
                    self.named_ranges.append(dict(item.attrib, formula=item.text or ''))
                if 'xl/sharedStrings.xml' in members:
                    strings = _xml(archive, 'xl/sharedStrings.xml')
                    self._shared = [''.join(t.text or '' for t in si.iter(f"{{{NS['m']}}}t"))
                                    for si in strings.findall('m:si', NS)]
        except (zipfile.BadZipFile, KeyError, OverflowError) as error:
            raise XlsxEvidenceError('XLSX_PACKAGE_INVALID') from error

    def sheet(self, name: str, *, strict_cache=True) -> SheetEvidence:
        if name not in self.sheets:
            raise XlsxEvidenceError('XLSX_SHEET_MISSING:' + name)
        identifier, target = self.sheets[name]
        with zipfile.ZipFile(io.BytesIO(self.content)) as archive:
            root = _xml(archive, target)
        shared = {}
        for cell in root.findall('m:sheetData/m:row/m:c', NS):
            formula = cell.find('m:f', NS)
            if formula is None or formula.get('t') != 'shared' or not formula.text:
                continue
            key, span, reference = formula.get('si'), formula.get('ref', ''), cell.get('r', '')
            if key is None or key in shared or not re.fullmatch(r'[A-Z]+[1-9][0-9]*:[A-Z]+[1-9][0-9]*', span):
                raise XlsxEvidenceError('XLSX_SHARED_FORMULA_INVALID')
            first, last = span.split(':')
            bounds = (_colnum(first), int(re.search(r'[0-9]+$', first)[0]),
                      _colnum(last), int(re.search(r'[0-9]+$', last)[0]))
            if bounds[0] > bounds[2] or bounds[1] > bounds[3]:
                raise XlsxEvidenceError('XLSX_SHARED_FORMULA_INVALID')
            try:
                shared[key] = Translator('=' + formula.text, origin=reference), bounds
            except (ValueError, IndexError) as error:
                raise XlsxEvidenceError('XLSX_SHARED_FORMULA_INVALID') from error
        output, formulas, seen = [], [], set()
        for element in root.findall('m:sheetData/m:row', NS):
            number = int(element.get('r', '0'))
            if not 1 <= number <= MAX_ROWS:
                raise XlsxEvidenceError('XLSX_GRID_LIMIT')
            if number in seen:
                raise XlsxEvidenceError('XLSX_DUPLICATE_ROW')
            seen.add(number)
            values, columns = [], set()
            for cell in element.findall('m:c', NS):
                reference = cell.get('r', '')
                index = _colnum(reference)
                if int(re.search(r'[0-9]+$', reference)[0]) != number:
                    raise XlsxEvidenceError('XLSX_CELL_ROW_MISMATCH')
                if index in columns:
                    raise XlsxEvidenceError('XLSX_DUPLICATE_CELL')
                columns.add(index)
                values.extend([None] * (index + 1 - len(values)))
                typ = cell.get('t')
                cached = cell.find('m:v', NS)
                formula = cell.find('m:f', NS)
                if formula is not None:
                    if formula.get('t') == 'shared':
                        key = formula.get('si')
                        if key not in shared:
                            raise XlsxEvidenceError('XLSX_SHARED_FORMULA_ANCHOR_MISSING:' + reference)
                        translator, (left, top, right, bottom) = shared[key]
                        if not (left <= index <= right and top <= number <= bottom):
                            raise XlsxEvidenceError('XLSX_SHARED_FORMULA_RANGE_MISMATCH:' + reference)
                        try:
                            formula_text = translator.translate_formula(reference)
                        except (ValueError, TranslatorError) as error:
                            raise XlsxEvidenceError('XLSX_SHARED_FORMULA_INVALID:' + reference) from error
                    elif formula.get('t', 'normal') in {'normal', 'array'} and formula.text:
                        formula_text = '=' + formula.text
                    else:
                        raise XlsxEvidenceError('XLSX_FORMULA_UNSUPPORTED:' + reference)
                    if strict_cache and (cached is None or (cached.text is None and typ != 'str')):
                        raise XlsxEvidenceError('XLSX_FORMULA_CACHE_MISSING:' + reference)
                    formulas.append({'row': number, 'column': index + 1, 'formula': formula_text})
                if typ == 'inlineStr':
                    inline = cell.find('m:is', NS)
                    value = ''.join(x.text or '' for x in inline.iter(f"{{{NS['m']}}}t")) if inline is not None else ''
                elif cached is None:
                    value = None
                elif typ == 's':
                    try:
                        string_index = int(cached.text)
                        if string_index < 0:
                            raise IndexError
                        value = self._shared[string_index]
                    except (ValueError, TypeError, IndexError) as error:
                        raise XlsxEvidenceError('XLSX_SHARED_STRING_INVALID') from error
                elif typ == 'b':
                    if cached.text not in {'0', '1'}:
                        raise XlsxEvidenceError('XLSX_BOOLEAN_INVALID')
                    value = cached.text == '1'
                elif typ in {'str', 'e', 'd'}:
                    value = cached.text or ''
                elif cached.text is None:
                    value = None
                else:
                    try:
                        value = float(cached.text)
                    except (ValueError, OverflowError) as error:
                        raise XlsxEvidenceError('XLSX_NUMBER_INVALID') from error
                    if not math.isfinite(value):
                        raise XlsxEvidenceError('XLSX_NONFINITE_NUMBER')
                values[index] = value
            output.append((number, values))
        return SheetEvidence(name, identifier, sorted(output), formulas)


def load_sheet_rows(path: str | Path, sheet_name: str) -> list[tuple[int, list]]:
    """Compatibility for forensic callers; production intake uses strict caches."""
    path = Path(path)
    if path.is_symlink() or path.stat().st_size > MAX_PACKAGE_BYTES:
        raise XlsxEvidenceError('XLSX_PACKAGE_LIMIT')
    return WorkbookEvidence(path.read_bytes()).sheet(sheet_name, strict_cache=False).rows
