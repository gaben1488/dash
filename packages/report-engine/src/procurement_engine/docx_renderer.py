from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

from .renderer_guard import assert_renderer_inputs

BLUE = "95B3D7"
ORANGE = "E36C0A"
GRAY = "7F7F7F"
RED = "C00000"


def _set_font(run, *, size=9, bold=False, italic=False, color: str | None = None) -> None:
    run.font.name = "Arial"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def _paragraph(doc: Document, text: str = "", *, size=9, bold=False, italic=False,
               color: str | None = None, align=WD_ALIGN_PARAGRAPH.JUSTIFY,
               keep_with_next=False, space_after=0, first_line_mm: float | None = None):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1
    p.paragraph_format.keep_with_next = keep_with_next
    if first_line_mm is not None:
        p.paragraph_format.first_line_indent = Mm(first_line_mm)
    r = p.add_run(str(text))
    _set_font(r, size=size, bold=bold, italic=italic, color=color)
    return p


def _shade(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def _repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def _prevent_row_split(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def _set_cell_text(cell, text: str, *, bold=False, size=7, color: str | None = None) -> None:
    cell.text = ""
    p = cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_after = Pt(0)
    r = p.add_run(str(text or ""))
    _set_font(r, size=size, bold=bold, color=color)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP


def _money(v: Any) -> str:
    n = float(v or 0.0)
    return f"{n:,.2f}".replace(",", " ").replace(".", ",")


def _pct(v: Any) -> str:
    if v is None:
        return "—"
    return f"{float(v):.2f}".replace(".", ",") + "%"


def _plural(n: int, forms: tuple[str, str, str]) -> str:
    n = abs(int(n))
    n100 = n % 100
    n10 = n % 10
    if 11 <= n100 <= 14:
        return forms[2]
    if n10 == 1:
        return forms[0]
    if 2 <= n10 <= 4:
        return forms[1]
    return forms[2]


def _proc_word(n: int) -> str:
    return _plural(n, ("процедура", "процедуры", "процедур"))


def _position_word(n: int) -> str:
    return _plural(n, ("позиция", "позиции", "позиций"))


def _source_note(model: dict) -> str:
    s = model["snapshot"]
    return (
        f"Идентификатор среза: {s.get('snapshot_id')}; отсечение: {s.get('cutoff_at')}; "
        f"версия правил: {s.get('rules_version')}; версия формирования: {s.get('renderer_version')}."
    )


def _metric_sentence(metric: dict, *, noun: str, label: str) -> str:
    count = int(metric.get("plan_count") or 0)
    fact = int(metric.get("fact_count") or 0)
    remain = int(metric.get("remain_count") or 0)
    return (
        f"{label}: план — {count} {noun}; "
        f"исполнено — {fact}; осталось — {remain}; "
        f"плановая сумма — {_money(metric.get('plan_amount'))} тыс. руб.; "
        f"фактическая сумма — {_money(metric.get('fact_amount'))} тыс. руб.; "
        f"исполнение — {_pct(metric.get('execution_pct'))}."
    )


def _add_metric_section(doc: Document, title: str, metric_year: dict, metric_q: dict,
                        *, color: str, unit: str) -> None:
    _paragraph(doc, title, bold=True, color=color, keep_with_next=True)
    pc = int(metric_year.get("plan_count") or 0)
    fc = int(metric_year.get("fact_count") or 0)
    rc = int(metric_year.get("remain_count") or 0)
    noun = _proc_word(pc) if unit == "procedure" else _position_word(pc)
    _paragraph(
        doc,
        f"Год: план — {pc} {noun} на {_money(metric_year.get('plan_amount'))} тыс. руб.; "
        f"исполнено — {fc}; осталось — {rc}; исполнение — {_pct(metric_year.get('execution_pct'))}.",
        first_line_mm=12.5,
    )
    pcq = int(metric_q.get("plan_count") or 0)
    nounq = _proc_word(pcq) if unit == "procedure" else _position_word(pcq)
    _paragraph(
        doc,
        f"Текущий квартал: план — {pcq} {nounq}; исполнено — {int(metric_q.get('fact_count') or 0)}; "
        f"осталось — {int(metric_q.get('remain_count') or 0)}; исполнение — {_pct(metric_q.get('execution_pct'))}.",
        first_line_mm=12.5,
    )


def _add_recommendations(doc: Document, rows: Iterable[dict], report_date: str) -> None:
    rows = list(rows)
    if not rows:
        return
    _paragraph(doc, "РЕКОМЕНДАЦИИ (НАКОПИТЕЛЬНЫЙ РЕЕСТР):", bold=True, keep_with_next=True)
    table = doc.add_table(rows=1, cols=4)
    table.style = "Table Grid"
    table.autofit = False
    widths = (Mm(12), Mm(78), Mm(42), Mm(48))
    for col, w in zip(table.columns, widths):
        col.width = w
    grid_cols = list(table._tbl.tblGrid.gridCol_lst)
    for grid_col, w in zip(grid_cols, widths):
        grid_col.set(qn("w:w"), str(w.twips))
    hdr = table.rows[0]
    hdr.height = Mm(9)
    hdr.height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
    _repeat_table_header(hdr)
    _prevent_row_split(hdr)
    headers = ["№\nп/п", "Рекомендация", "Ответ ГРБС\nна рекомендацию", f"Решение УЭР / статус\nна {report_date}"]
    for c, h, w in zip(hdr.cells, headers, widths):
        c.width = w
        _set_cell_text(c, h, bold=True)
        _shade(c, "D9EAF7")
    for idx, r in enumerate(rows, 1):
        status = str(r.get("semantic_status_ru") or "")
        evidence = str(r.get("status_evidence") or "")
        decision = str(r.get("uer_decision") or "")
        last = "\n".join(x for x in [decision, f"{report_date}: {status}" if status else "", evidence] if x)
        vals = [r.get("row_no") or idx, r.get("recommendation") or "", r.get("grbs_response") or "", last]
        row_obj = table.add_row()
        # Normal rows should remain intact. A row taller than the printable page must be
        # allowed to split; otherwise LibreOffice/Word may clip its tail entirely.
        if sum(len(str(v or "")) for v in vals) <= 1700:
            _prevent_row_split(row_obj)
        cells = row_obj.cells
        for c, w in zip(cells, widths):
            c.width = w
        for c, v in zip(cells, vals):
            _set_cell_text(c, str(v))


def _add_narratives(doc: Document, blocks: list[dict], *, include_describe: bool = False) -> None:
    blocks = [b for b in blocks if include_describe or str(b.get("stage") or "").lower() != "describe"]
    if not blocks:
        return
    _paragraph(doc, "АНАЛИТИЧЕСКИЙ КОНТЕКСТ:", bold=True, keep_with_next=True)
    for b in blocks:
        stage = str(b.get("stage") or "").upper()
        label = {"DESCRIBE": "Факт", "EXPLAIN": "Объяснение", "JUDGE": "Оценка", "ACT": "Действие"}.get(stage, stage or "Контекст")
        _paragraph(doc, f"{label}: {b.get('text') or ''}", size=8, italic=stage in {"EXPLAIN", "JUDGE"}, color=GRAY, first_line_mm=8)


def _setup_main(doc: Document) -> None:
    sec = doc.sections[0]
    sec.page_width = Mm(210)
    sec.page_height = Mm(297)
    sec.top_margin = Mm(15.0)
    sec.bottom_margin = Mm(15.0)
    sec.left_margin = Mm(15.0)
    sec.right_margin = Mm(15.0)


def _setup_management(doc: Document) -> None:
    sec = doc.sections[0]
    sec.orientation = WD_ORIENT.LANDSCAPE
    sec.page_width, sec.page_height = Mm(297), Mm(210)
    sec.top_margin = Mm(12.7)
    sec.bottom_margin = Mm(8.0)
    sec.left_margin = Mm(12.7)
    sec.right_margin = Mm(12.7)


def _artifact_manifest(model: dict, *, view: str, narrative_mode: str, output: Path) -> dict:
    payload = json.dumps(model, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        "artifact": output.name,
        "artifact_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "view": view,
        "narrative_mode": narrative_mode,
        "snapshot_id": model["snapshot"].get("snapshot_id"),
        "cutoff_at": model["snapshot"].get("cutoff_at"),
        "rules_version": model["snapshot"].get("rules_version"),
        "renderer_version": model["snapshot"].get("renderer_version"),
        "report_model_version": (model.get("contract") or {}).get("report_model_version"),
        "report_model_sha256": hashlib.sha256(payload).hexdigest(),
        "trace_record_count": len(model.get("trace_records") or []),
    }


def _save_with_manifest(doc: Document, model: dict, output_path: str | Path, *, view: str, narrative_mode: str) -> tuple[Path, Path]:
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out)
    manifest = _artifact_manifest(model, view=view, narrative_mode=narrative_mode, output=out)
    sidecar = out.with_suffix(out.suffix + ".manifest.json")
    sidecar.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return out, sidecar


def render_main_docx(report_model: dict, output_path: str | Path, *, narrative_mode: str = "GENERIC_TEMPLATE") -> tuple[Path, Path]:
    assert_renderer_inputs(report_model=report_model)
    if narrative_mode not in {"GENERIC_TEMPLATE", "SMART_NARRATIVE"}:
        raise ValueError("Unsupported narrative mode")
    doc = Document()
    _setup_main(doc)
    s = report_model["snapshot"]
    _paragraph(doc, "ОТЧЕТ ПО ЗАКУПКАМ", bold=True, align=WD_ALIGN_PARAGRAPH.RIGHT)
    _paragraph(doc, f"срез на {s.get('report_date')}", bold=True, align=WD_ALIGN_PARAGRAPH.RIGHT)
    _paragraph(doc, _source_note(report_model), size=8, italic=True, color=GRAY)
    _add_release_notice(doc, report_model)

    _paragraph(doc, "ВСЕ ГРБС", size=12, bold=True, keep_with_next=True)
    h = report_model["headline"]
    _add_metric_section(doc, "КОНКУРЕНТНЫЕ ЗАКУПКИ В ПЛАНЕ:", h["competitive"]["year"], h["competitive"]["quarter"], color=BLUE, unit="position")
    _add_metric_section(doc, "ЕДИНСТВЕННЫЙ ПОСТАВЩИК:", h["single_supplier"]["year"], h["single_supplier"]["quarter"], color=ORANGE, unit="position")
    _add_narratives(doc, list((report_model.get("narratives") or {}).get(narrative_mode) or []))

    q = int(h.get("current_quarter") or 1)
    for grbs in report_model.get("grbs_order") or []:
        gm = (report_model.get("grbs_metrics") or {}).get(grbs)
        if not gm:
            continue
        _paragraph(doc, grbs, size=12, bold=True, keep_with_next=True)
        comp = gm.get("comp") or {}
        ep = gm.get("ep") or {}
        if comp.get("year"):
            _add_metric_section(doc, "КОНКУРЕНТНЫЕ ЗАКУПКИ В ПЛАНЕ:", comp["year"], comp.get(f"q{q}") or comp["year"], color=BLUE, unit="position")
        if ep.get("year"):
            _add_metric_section(doc, "ЕДИНСТВЕННЫЙ ПОСТАВЩИК:", ep["year"], ep.get(f"q{q}") or ep["year"], color=ORANGE, unit="position")
        tables = (report_model.get("recommendation_tables_by_grbs") or {}).get(grbs)
        if tables:
            for group in tables:
                _add_recommendations(doc, group["rows"], str(s.get("report_date") or ""))
        else:
            _add_recommendations(doc, (report_model.get("recommendations_by_grbs") or {}).get(grbs) or [], str(s.get("report_date") or ""))

    _add_future_plan(doc, report_model)
    return _save_with_manifest(doc, report_model, output_path, view="main", narrative_mode=narrative_mode)


def render_management_docx(report_model: dict, output_path: str | Path, *, narrative_mode: str = "SMART_NARRATIVE") -> tuple[Path, Path]:
    assert_renderer_inputs(report_model=report_model)
    if narrative_mode not in {"GENERIC_TEMPLATE", "SMART_NARRATIVE"}:
        raise ValueError("Unsupported narrative mode")
    doc = Document()
    _setup_management(doc)
    s = report_model["snapshot"]
    _paragraph(doc, "Для АВ дополнительно", bold=True, align=WD_ALIGN_PARAGRAPH.LEFT)
    _paragraph(doc, f"Актуальный срез на {s.get('report_date')}", bold=True)
    _paragraph(doc, _source_note(report_model), size=8, italic=True, color=GRAY)
    _add_release_notice(doc, report_model)
    h = report_model["headline"]
    _add_metric_section(doc, "КОНКУРЕНТНЫЕ ЗАКУПКИ В ПЛАНЕ:", h["competitive"]["year"], h["competitive"]["quarter"], color=BLUE, unit="position")
    _add_metric_section(doc, "ЕДИНСТВЕННЫЙ ПОСТАВЩИК:", h["single_supplier"]["year"], h["single_supplier"]["quarter"], color=ORANGE, unit="position")

    mgmt = report_model.get("management_summary") or {}
    pub = report_model.get("publication") or {}
    diff_counts = mgmt.get("diff_counts") or {}
    if diff_counts:
        previous_date = pub.get("previous_official_report_date") or "базового среза"
        _paragraph(doc, "ИЗМЕНЕНИЯ ОТНОСИТЕЛЬНО ПРЕДЫДУЩЕГО ОФИЦИАЛЬНОГО СРЕЗА:", bold=True, keep_with_next=True)
        if previous_date != "базового среза":
            _paragraph(doc, f"Базовый официальный срез: {previous_date}.", size=8, italic=True, color=GRAY)
        for event_type, count in diff_counts.items():
            _paragraph(doc, f"- {event_type}: {count}.", size=8, first_line_mm=4)

    comp_remaining = mgmt.get("competitive_remaining_by_grbs") or []
    if comp_remaining:
        _paragraph(doc, "ОСТАТОК ТЕКУЩЕГО КВАРТАЛА — КОНКУРЕНТНЫЕ ЗАКУПКИ В ПЛАНЕ:", bold=True, keep_with_next=True)
        for row in comp_remaining:
            _paragraph(doc, f"- {row['grbs']}: {row['remain_count']} {_position_word(row['remain_count'])} на {_money(row['remain_amount'])} тыс. руб.;", size=8, first_line_mm=4)

    ep_remaining = mgmt.get("single_supplier_remaining_by_grbs") or []
    if ep_remaining:
        _paragraph(doc, "ОСТАТОК ТЕКУЩЕГО КВАРТАЛА — ЕДИНСТВЕННЫЙ ПОСТАВЩИК:", bold=True, keep_with_next=True)
        for row in ep_remaining:
            _paragraph(doc, f"- {row['grbs']}: {row['remain_count']} {_position_word(row['remain_count'])} на {_money(row['remain_amount'])} тыс. руб.;", size=8, first_line_mm=4)

    procedures = list(mgmt.get("procedure_rows") or [])
    if procedures:
        _paragraph(doc, f"ОПЕРАЦИОННЫЙ КОНТРОЛЬ — {int(mgmt.get('procedure_count') or 0)} {_proc_word(int(mgmt.get('procedure_count') or 0))}:", bold=True, keep_with_next=True)
        for p in procedures:
            code = p.get("procedure_code") or p.get("code") or "—"
            stage = p.get("stage") or p.get("state") or "—"
            subject = p.get("subject") or ""
            _paragraph(doc, f"- {code}: {stage}. {subject}", size=8, first_line_mm=4)

    serious = mgmt.get("serious_issues") or []
    if serious:
        _paragraph(doc, "КЛЮЧЕВЫЕ ТОЧКИ КОНТРОЛЯ / КАЧЕСТВО ДАННЫХ:", bold=True, keep_with_next=True)
        for issue in serious:
            code = issue.get("code") or issue.get("id") or "ISSUE"
            msg = issue.get("message") or ""
            _paragraph(doc, f"- {code}: {msg}", size=8, color=RED, first_line_mm=4)

    _add_narratives(doc, list((report_model.get("narratives") or {}).get(narrative_mode) or []), include_describe=False)
    rec = report_model.get("recommendations") or {}
    _paragraph(doc, "РЕКОМЕНДАЦИИ:", bold=True, keep_with_next=True)
    _paragraph(
        doc,
        f"Активных — {int(rec.get('active') or 0)}; исторических уникальных — {int(rec.get('historical_unique') or 0)}; "
        f"замещённых исторических версий — {int(rec.get('superseded') or 0)}.",
    )
    execution = mgmt.get("recommendation_execution_counts") or {}
    if execution:
        _paragraph(doc, "Текущее исполнение: " + "; ".join(f"{k} — {v}" for k, v in execution.items()) + ".", size=8)
    _add_future_plan(doc, report_model)
    return _save_with_manifest(doc, report_model, output_path, view="management", narrative_mode=narrative_mode)


def _add_release_notice(doc, model):
    release = model.get("release") or {}
    if release.get("status") == "BLOCKED":
        _paragraph(doc, "ПРОВЕРОЧНЫЙ ОТЧЕТ  Официальный выпуск заблокирован", bold=True, color=RED)
        _paragraph(doc, "Показатели рассчитаны из текущих исходных строк. Факт здесь означает заполненную дату Q в плане. Денежный факт и число контрактов учитываются отдельно. Связи с процедурами и рекомендациями требуют завершения проверки.", size=9, space_after=6)
    if model.get("recommendation_review"):
        _paragraph(doc, "Рекомендации приведены как накопительная история. Ответы ГРБС и решения УЭР сохранены в первоначальной редакции; текущая проверка выделена отдельно. Старые статусы не подтверждают исполнение на новую дату.", size=8, italic=True, space_after=6)


def _add_future_plan(doc, model):
    future = model.get("future_plan") or {}
    rows = future.get("rows") or []
    if not rows:
        return
    _paragraph(doc, f"ЗАКУПКИ БУДУЩЕГО ПЕРИОДА {future['target_year']}", bold=True, keep_with_next=True)
    _paragraph(doc, "Отдельный контур вне текущего годового плана. Записи, выявленные в комментариях, требуют подтверждения структурированных полей. Неустановленный месяц не распределяется автоматически.", size=8)
    for row in rows:
        month = str(row['target_month']) if row.get('target_month') else "не установлен"
        _paragraph(doc, f"{row['grbs']}, строка {row['row_number']}: {row['subject']}. Сумма {_money(row['amount_thousand'])} тыс. руб. Месяц: {month}.", size=8, space_after=4)
