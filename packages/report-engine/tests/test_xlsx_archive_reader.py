"""Synthetic OOXML: cache evidence must not collapse missing values or coordinates."""
import io
import zipfile

import pytest
from procurement_engine.xlsx_raw import (
    WorkbookEvidence,
    XlsxEvidenceError,
    load_sheet_rows,
)


def workbook_bytes(sheet_xml, *, date1904=False, duplicate=False, extra=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<workbookPr date1904="{int(date1904)}"/><sheets><sheet name="ВСЕ" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr('xl/worksheets/sheet1.xml', sheet_xml)
        if duplicate:
            with pytest.warns(UserWarning):
                archive.writestr('xl/worksheets/sheet1.xml', sheet_xml)
        if extra:
            for name, value in extra.items():
                archive.writestr(name, value)
    return output.getvalue()


def sheet(rows):
    return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows + '</sheetData></worksheet>'


def test_sparse_coordinate_and_rich_inline_text_preserved(tmp_path):
    data = workbook_bytes(sheet('<row r="4"><c r="B4" t="inlineStr"><is><r><t>Причина </t></r><r><t>ЕП</t></r></is></c><c r="AH4"><v>7</v></c></row>'))
    wb = WorkbookEvidence(data)
    result = wb.sheet('ВСЕ')
    assert result.rows == [(4, [None, 'Причина ЕП'] + [None] * 31 + [7.0])]
    assert result.formulas == []
    path = tmp_path / 'book.xlsx'; path.write_bytes(data)
    assert load_sheet_rows(path, 'ВСЕ') == result.rows


def test_formula_and_cached_blank_are_distinct_from_missing_cache():
    valid = workbook_bytes(sheet('<row r="1"><c r="A1" t="str"><f>IF(1=1,"","x")</f><v/></c><c r="B1"><f>SUM(1,2)</f><v>3</v></c></row>'))
    result = WorkbookEvidence(valid).sheet('ВСЕ')
    assert result.rows == [(1, ['', 3.0])]
    assert result.formulas[1] == {'row': 1, 'column': 2, 'formula': '=SUM(1,2)'}
    for missing in ('<c r="A1"><f>SUM(1,2)</f></c>', '<c r="A1"><f>SUM(1,2)</f><v/></c>'):
        with pytest.raises(XlsxEvidenceError, match='XLSX_FORMULA_CACHE_MISSING'):
            WorkbookEvidence(workbook_bytes(sheet('<row r="1">' + missing + '</row>'))).sheet('ВСЕ')


@pytest.mark.parametrize('body,code', [
    ('<row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row>', 'XLSX_DUPLICATE_CELL'),
    ('<row r="1"/><row r="1"/>', 'XLSX_DUPLICATE_ROW'),
    ('<row r="4"><c r="A3"><v>1</v></c></row>', 'XLSX_CELL_ROW_MISMATCH'),
    ('<row r="1"><c r="A1"><f t="shared" si="0"/><v>1</v></c></row>', 'XLSX_SHARED_FORMULA_ANCHOR_MISSING'),
    ('<row r="1"><c r="A1"><v>NaN</v></c></row>', 'XLSX_NONFINITE_NUMBER'),
    ('<row r="1000001"/>', 'XLSX_GRID_LIMIT'),
])
def test_invalid_evidence_fails_with_specific_reason(body, code):
    with pytest.raises(XlsxEvidenceError, match=code):
        WorkbookEvidence(workbook_bytes(sheet(body))).sheet('ВСЕ')


def test_duplicate_members_path_escape_entities_and_epoch_rejected():
    for data, code in [
        (workbook_bytes(sheet(''), duplicate=True), 'XLSX_DUPLICATE_MEMBER'),
        (workbook_bytes(sheet(''), extra={'../outside.xml': 'x'}), 'XLSX_UNSAFE_MEMBER'),
        (workbook_bytes('<!DOCTYPE x [<!ENTITY a "expanded">]>' + sheet('')), 'XLSX_UNSAFE_XML'),
        (workbook_bytes(sheet(''), date1904=True), 'XLSX_DATE_EPOCH_UNSUPPORTED'),
    ]:
        with pytest.raises(XlsxEvidenceError, match=code):
            WorkbookEvidence(data).sheet('ВСЕ')


def test_shared_formula_uses_origin_and_preserves_absolute_references():
    content = workbook_bytes(sheet('<row r="4"><c r="K4"><f t="shared" si="0" ref="K4:K6">SUM(H4:J4)+$A$1+$B4+C$2</f><v>7</v></c></row>'
        '<row r="6"><c r="K6"><f t="shared" si="0"/><v>9</v></c></row>'))
    result = WorkbookEvidence(content).sheet('ВСЕ')
    assert result.formulas[1]['formula'] == '=SUM(H6:J6)+$A$1+$B6+C$2'
    assert result.rows[1] == (6, [None] * 10 + [9.0])
