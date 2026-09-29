from __future__ import annotations

import os
import re
import zipfile
from xml.etree import ElementTree as ET

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def _colnum(ref: str) -> int:
    m = re.match(r"([A-Z]+)", ref)
    if not m:
        raise ValueError(ref)
    n = 0
    for ch in m.group(1):
        n = n * 26 + ord(ch) - 64
    return n - 1


def load_sheet_rows(path: str, sheet_name: str) -> list[tuple[int, list]]:
    """Read cached values from xlsx using stdlib only.

    This is a forensic reader for frozen evidence, not the production Google adapter. Formula cells are
    read from their cached values, exactly as stored in the exported file.
    """
    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rid = None
        sheets = wb.find("m:sheets", NS)
        if sheets is None:
            raise KeyError(sheet_name)
        for s in sheets:
            if s.attrib.get("name") == sheet_name:
                rid = s.attrib.get(f"{{{NS['r']}}}id")
                break
        if rid is None:
            raise KeyError(sheet_name)

        rel = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = None
        for x in rel:
            if x.attrib.get("Id") == rid:
                target = x.attrib["Target"]
                break
        if target is None:
            raise KeyError(sheet_name)
        xml_path = target.lstrip("/") if target.startswith("/") else os.path.normpath("xl/" + target)
        root = ET.fromstring(z.read(xml_path))

        out: list[tuple[int, list]] = []
        for row in root.findall(".//m:sheetData/m:row", NS):
            arr: list = []
            for c in row.findall("m:c", NS):
                idx = _colnum(c.attrib["r"])
                while len(arr) <= idx:
                    arr.append(None)
                typ = c.attrib.get("t")
                v = c.find("m:v", NS)
                if typ == "inlineStr":
                    inline = c.find("m:is", NS)
                    val = "".join(x.text or "" for x in inline.iter(f"{{{NS['m']}}}t")) if inline is not None else ""
                elif v is None:
                    val = None
                else:
                    raw = v.text
                    if typ == "s":
                        val = shared[int(raw)]
                    elif typ == "b":
                        val = raw == "1"
                    elif typ in ("str", "e"):
                        val = raw
                    else:
                        try:
                            val = float(raw)
                        except (TypeError, ValueError):
                            val = raw
                arr[idx] = val
            out.append((int(row.attrib["r"]), arr))
        return out
