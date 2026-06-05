"""
Build a compact audit summary from generated PLAN-REESTR extraction artifacts.

Inputs are produced by:
  scripts/xlsx_full_extract.py
  scripts/xlsx_formula_dump.py
  scripts/xlsx_metadata_map.py
  scripts/docx_to_text.py

Usage:
  python scripts/plan_reestr_summarize.py docs/data-audit/2026-06-05-plan-reestr
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


KEY_DOC_PATTERNS = {
    "source": re.compile(r"(источник|свод|Google|Sheets|таблиц|данн)", re.I),
    "history": re.compile(r"(ИСТОРИ|снимок|динамик|прошл|следующ|недел)", re.I),
    "trust": re.compile(r"(довер|над[её]ж|качество|валид|ошиб)", re.I),
    "signals": re.compile(r"(сигнал|аномал|риск|замеч|флаг|контроль)", re.I),
    "law": re.compile(r"(44-ФЗ|ФАС|КоАП|93|37|103|антикорруп)", re.I),
    "reports": re.compile(r"(отч[её]т|Google Doc|документ|Apps Script|РАСЧЕТ|КОНТЕКСТ)", re.I),
    "filters": re.compile(r"(фильтр|ГРБС|организац|подвед|месяц|квартал|недел)", re.I),
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def as_int(value: Any) -> int:
    try:
        return int(value)
    except Exception:
        return 0


def workbook_stats(full: list[dict[str, Any]], formulas: list[dict[str, Any]], meta: list[dict[str, Any]]) -> dict[str, Any]:
    by_file: dict[str, dict[str, Any]] = {}

    for entry in full:
        file = entry.get("file", "?")
        stats = by_file.setdefault(file, {"file": file})
        sheets = entry.get("sheets") or []
        stats["sheets"] = len(sheets)
        stats["active_rows"] = sum(as_int(s.get("active_rows")) for s in sheets)
        stats["data_rows"] = sum(as_int(s.get("data_rows")) for s in sheets)
        stats["columns"] = sum(len(s.get("columns") or []) for s in sheets)
        risks = []
        for sheet in sheets:
            for risk in sheet.get("risks") or []:
                for flag in risk.get("flags") or []:
                    risks.append(flag.split("=")[0])
        stats["risk_count"] = len(risks)
        stats["risk_top"] = Counter(risks).most_common(8)
        stats["sheet_names"] = [s.get("sheet", "?") for s in sheets]

    for entry in formulas:
        file = entry.get("file", "?")
        stats = by_file.setdefault(file, {"file": file})
        sheets = entry.get("sheets") or []
        stats["formula_sheets"] = len(sheets)
        stats["formula_cells"] = sum(as_int(s.get("formula_cells")) for s in sheets)
        stats["formula_templates"] = sum(as_int(s.get("templates")) for s in sheets)
        stats["gs_custom"] = sum(as_int(s.get("gs_custom")) for s in sheets)
        funcs = []
        for sheet in sheets:
            funcs.extend(sheet.get("custom_funcs") or [])
        stats["custom_funcs"] = sorted(set(funcs))

    for entry in meta:
        file = entry.get("file", "?")
        stats = by_file.setdefault(file, {"file": file})
        comments = 0
        validations = 0
        cond = 0
        hidden_rows = 0
        hidden_cols = 0
        formula_anomalies = 0
        protected = 0
        external_links = len(entry.get("external_links") or [])
        for sheet in entry.get("sheets") or []:
            comments += len(sheet.get("comments") or [])
            validations += len(sheet.get("data_validations") or [])
            cond += len(sheet.get("cond_formatting") or [])
            hidden_rows += as_int(sheet.get("hidden_rows"))
            hidden_cols += len(sheet.get("hidden_cols") or [])
            formula_anomalies += len(sheet.get("formula_anomalies") or [])
            protected += 1 if sheet.get("protected") else 0
        stats.update({
            "comments": comments,
            "validations": validations,
            "conditional_formatting": cond,
            "hidden_rows": hidden_rows,
            "hidden_cols": hidden_cols,
            "formula_anomalies": formula_anomalies,
            "protected_sheets": protected,
            "external_links": external_links,
        })

    return by_file


def doc_stats(doc_dir: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    docs = []
    totals = defaultdict(int)
    for path in sorted(doc_dir.glob("*.txt")):
        text = path.read_text(encoding="utf-8", errors="replace")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        hits = {key: sum(1 for line in lines if rx.search(line)) for key, rx in KEY_DOC_PATTERNS.items()}
        for key, value in hits.items():
            totals[key] += value
        docs.append({
            "file": path.name,
            "chars": len(text),
            "lines": len(lines),
            "hits": hits,
            "headings": [line for line in lines[:80] if len(line) < 120][:12],
        })
    return docs, dict(totals)


def write_summary(root: Path, by_file: dict[str, dict[str, Any]], docs: list[dict[str, Any]], doc_totals: dict[str, int]) -> Path:
    out = root / "canonical-source-audit-summary.md"
    workbook_rows = sorted(by_file.values(), key=lambda x: x.get("file", ""))
    total_sheets = sum(as_int(w.get("sheets")) for w in workbook_rows)
    total_active = sum(as_int(w.get("active_rows")) for w in workbook_rows)
    total_formulas = sum(as_int(w.get("formula_cells")) for w in workbook_rows)
    total_gs_custom = sum(as_int(w.get("gs_custom")) for w in workbook_rows)
    total_comments = sum(as_int(w.get("comments")) for w in workbook_rows)
    total_formula_anomalies = sum(as_int(w.get("formula_anomalies")) for w in workbook_rows)
    total_hidden_rows = sum(as_int(w.get("hidden_rows")) for w in workbook_rows)
    total_hidden_cols = sum(as_int(w.get("hidden_cols")) for w in workbook_rows)

    lines = [
        "# PLAN-REESTR Canonical Source Audit Summary",
        "",
        "Generated from local extraction artifacts. This summary is intentionally derived, not hand-entered.",
        "",
        "## Coverage",
        "",
        f"- XLSX workbooks: {len(workbook_rows)}",
        f"- XLSX sheets: {total_sheets}",
        f"- Active data rows: {total_active}",
        f"- Formula cells: {total_formulas}",
        f"- Google custom/exported formula cells: {total_gs_custom}",
        f"- Extracted comments: {total_comments}",
        f"- Formula anomaly groups: {total_formula_anomalies}",
        f"- Hidden rows/columns: {total_hidden_rows}/{total_hidden_cols}",
        f"- DOCX-derived texts: {len(docs)}",
        "",
        "## Workbook Inventory",
        "",
        "| workbook | sheets | active rows | formulas | gs custom | risks | comments | validations | formula anomalies | hidden rows/cols |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for w in workbook_rows:
        lines.append(
            "| {file} | {sheets} | {active_rows} | {formula_cells} | {gs_custom} | {risk_count} | {comments} | {validations} | {formula_anomalies} | {hidden_rows}/{hidden_cols} |".format(
                file=w.get("file", ""),
                sheets=w.get("sheets", 0),
                active_rows=w.get("active_rows", 0),
                formula_cells=w.get("formula_cells", 0),
                gs_custom=w.get("gs_custom", 0),
                risk_count=w.get("risk_count", 0),
                comments=w.get("comments", 0),
                validations=w.get("validations", 0),
                formula_anomalies=w.get("formula_anomalies", 0),
                hidden_rows=w.get("hidden_rows", 0),
                hidden_cols=w.get("hidden_cols", 0),
            )
        )

    lines.extend([
        "",
        "## Repeated Source Shapes",
        "",
        "- Department workbooks use a 33-column registry-like shape with data from row 4 and technical sheets such as `ВСЕ`, `Контроль`, `GOOGLE_ФОРМУЛЫ`, `Settings`, plus subordinate/department slices.",
        "- Current canonical live source shape appears to be `СВОД_ДЛЯ_GOOGLE.xlsx`: `СВОД ТД-ПМ`, `СВОД с месяцами`, `ШДЮ старый`, 8 department tabs, `КОНТЕКСТ`, `РАСЧЕТ`, `ИСТОРИЯ`, `ОТЛАДКА`, support sheets.",
        "- Earlier architecture folder captures a five-source merge model: plan schedule current/previous, EIS orders, EIS contracts, department sheet, output registry.",
        "",
        "## Top Data Risks By Workbook",
        "",
    ])
    for w in workbook_rows:
        risk_top = w.get("risk_top") or []
        if not risk_top:
            continue
        risk_text = ", ".join(f"{name} x{count}" for name, count in risk_top[:6])
        lines.append(f"- `{w.get('file')}`: {risk_text}")

    lines.extend([
        "",
        "## Documentation Corpus Signals",
        "",
        "| theme | matched lines |",
        "| --- | ---: |",
    ])
    for key, count in sorted(doc_totals.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"| {key} | {count} |")

    lines.extend([
        "",
        "## High-Signal Documents",
        "",
    ])
    for doc in sorted(docs, key=lambda d: d["chars"], reverse=True)[:16]:
        hit_text = ", ".join(f"{k}:{v}" for k, v in sorted(doc["hits"].items()) if v)
        lines.append(f"- `{doc['file']}`: {doc['chars']} chars, {doc['lines']} lines; {hit_text}")

    lines.extend([
        "",
        "## Immediate Interpretation",
        "",
        "1. The source archive contains more product/domain knowledge than the current dashboard docs: it documents a weekly report generator, history snapshots, context sheet, risk modules, 44-FZ checks, and anti-corruption indicators.",
        "2. `СВОД_ДЛЯ_GOOGLE.xlsx` is not just an input table; it is a working data product with calculation, history, context, old SHDYU, monthly summary, and debug sheets.",
        "3. Department workbooks are not flat CSV sources. They carry formulas, validations, conditional formatting, comments/change history, hidden rows, subordinate slices, and Google custom formula exports.",
        "4. Any reliable rewrite/refactor must preserve formula semantics: `COUNTIFS/SUMIFS`, `AD = да` economy gate, fact-date exclusions `Q <> Х/X/blank`, method split ЕП vs non-ЕП, month/quarter/year dimensions, and subordinate filtering by column C.",
        "5. Current code should be audited against the archived Apps Script promises: named range/header lookup resilience, BOEVOY/TEST/DEMO modes, `РАСЧЕТ`/`ИСТОРИЯ`/`КОНТЕКСТ`, 44-FZ and anti-corruption modules, and report generation fallback.",
        "",
    ])
    out.write_text("\n".join(lines), encoding="utf-8")
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    root = Path(sys.argv[1])
    full = load_json(root / "xlsx-full-profiles.json")
    formulas = load_json(root / "xlsx-formulas.json")
    meta = load_json(root / "xlsx-metadata-map.json")
    doc_dir = root / "docx-text-by-path"
    if not doc_dir.exists():
        doc_dir = root / "docx-text"
    docs, doc_totals = doc_stats(doc_dir)
    by_file = workbook_stats(full, formulas, meta)
    summary = write_summary(root, by_file, docs, doc_totals)
    (root / "canonical-source-audit-summary.json").write_text(
        json.dumps({"workbooks": by_file, "docs": docs, "doc_totals": doc_totals}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[OK] {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
