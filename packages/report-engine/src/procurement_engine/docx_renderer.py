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
        f"с датой факта — {fc} на {_money(metric_year.get('fact_amount'))} тыс. руб.; "
        f"осталось — {rc} на {_money(metric_year.get('remain_amount'))} тыс. руб.; "
        f"доля позиций с датой факта — {_pct(metric_year.get('execution_pct'))}.",
        first_line_mm=12.5,
    )
    pcq = int(metric_q.get("plan_count") or 0)
    nounq = _proc_word(pcq) if unit == "procedure" else _position_word(pcq)
    _paragraph(
        doc,
        f"Текущий квартал: план — {pcq} {nounq} на {_money(metric_q.get('plan_amount'))} тыс. руб.; "
        f"с датой факта — {int(metric_q.get('fact_count') or 0)} на {_money(metric_q.get('fact_amount'))} тыс. руб.; "
        f"осталось — {int(metric_q.get('remain_count') or 0)} на {_money(metric_q.get('remain_amount'))} тыс. руб.; "
        f"доля позиций с датой факта — {_pct(metric_q.get('execution_pct'))}.",
        first_line_mm=12.5,
    )


def _budget_text(metric, prefix):
    exact = metric['exact_decimal']
    return '(' + ', '.join(f"{label} — {_money(exact[prefix+'_'+budget+'_amount'])} тыс. руб."
        for label, budget in [('ФБ','fb'),('КБ','kb'),('МБ','mb')]) + ')'


def _add_complete_section(doc, title, scopes, *, year, quarter, color, remaining=None, global_section=False):
    _paragraph(doc, title, bold=True, color=color, keep_with_next=True)
    annual = scopes['year']
    _paragraph(doc, f"Всего на год запланировано {annual['plan_count']} {_position_word(annual['plan_count'])} "
        f"на сумму {_money(annual['plan_amount'])} тыс. руб. {_budget_text(annual, 'plan')}.", first_line_mm=12.5)
    for q in range(1, 5 if global_section else quarter + 1):
        block = scopes[f'q{q}']
        _paragraph(doc, f"Всего на {q} квартал {year} года запланировано {block['plan_count']} "
            f"{_position_word(block['plan_count'])} на общую сумму {_money(block['plan_amount'])} тыс. руб. "
            f"{_budget_text(block, 'plan')}.", first_line_mm=12.5)
        if not global_section:
            _paragraph(doc, f"Фактическое выполнение плана {q} квартала — {block['fact_count']} "
                f"{_position_word(block['fact_count'])} на сумму {_money(block['fact_amount'])} тыс. руб. "
                f"{_budget_text(block, 'fact')}.", first_line_mm=12.5)
            if block['remain_count']:
                _paragraph(doc, f"В {q} квартале осталось {block['remain_count']} {_position_word(block['remain_count'])} "
                    f"на общую сумму {_money(block['remain_amount'])} тыс. руб. {_budget_text(block, 'remain')}.",
                    first_line_mm=12.5, keep_with_next=bool((remaining or {}).get(f'q{q}')))
                for row in (remaining or {}).get(f'q{q}', []):
                    comment = f" ({row['comment']})" if row['comment'] else ''
                    _paragraph(doc, f"- {row['subject']} на сумму {_money(row['amount_thousand_decimal'])} тыс. руб.{comment};",
                               size=8, first_line_mm=4)
            _paragraph(doc, f"Исполнение плана {q} квартала — {_pct(block['execution_pct'])}.", first_line_mm=12.5)
    _paragraph(doc, f"Фактическое выполнение годового плана — {annual['fact_count']} "
        f"{_position_word(annual['fact_count'])} на сумму {_money(annual['fact_amount'])} тыс. руб. "
        f"{_budget_text(annual, 'fact')}.", first_line_mm=12.5)
    if global_section:
        for q in range(1, quarter + 1):
            block = scopes[f'q{q}']
            _paragraph(doc, f"Исполнение плана {q} квартала — {_pct(block['execution_pct'])} "
                f"({block['fact_count']} из {block['plan_count']}). Осталось {block['remain_count']} "
                f"{_position_word(block['remain_count'])} на {_money(block['remain_amount'])} тыс. руб. "
                f"{_budget_text(block, 'remain')}.", first_line_mm=12.5)
    _paragraph(doc, f"Исполнение годового плана — {_pct(annual['execution_pct'])}.", first_line_mm=12.5)


def _add_compact_section(doc, title, scopes, *, quarter, color):
    _paragraph(doc, title, bold=True, color=color, keep_with_next=True)
    annual = scopes['year']; current = scopes[f'q{quarter}']
    _paragraph(doc, f"Всего на год запланировано {annual['plan_count']} {_position_word(annual['plan_count'])} "
        f"на сумму {_money(annual['plan_amount'])} тыс. руб. {_budget_text(annual, 'plan')}.")
    _paragraph(doc, f"Фактическое выполнение — {annual['fact_count']} {_position_word(annual['fact_count'])} "
        f"на сумму {_money(annual['fact_amount'])} тыс. руб. {_budget_text(annual, 'fact')}.")
    _paragraph(doc, f"{quarter} квартал: выполнено {current['fact_count']} из {current['plan_count']} "
        f"позиций — {_pct(current['execution_pct'])}. Осталось {current['remain_count']} "
        f"{_position_word(current['remain_count'])} на сумму {_money(current['remain_amount'])} тыс. руб. "
        f"{_budget_text(current, 'remain')}.")


def _add_operational_control(doc, model):
    procedures = model.get('procedures') or []
    if not procedures:
        return
    _paragraph(doc, f"В РАБОТЕ — {len(procedures)} {_proc_word(len(procedures))}:", bold=True, keep_with_next=True)
    for row in procedures:
        deadline = str(row.get('deadline') or '')
        if len(deadline) == 10 and deadline[4] == '-':
            deadline = '.'.join(reversed(deadline.split('-')))
        date_note = f" Срок: {deadline}." if deadline else ''
        action = f" {row['action']}" if row.get('action') else ''
        _paragraph(doc, f"- {row['procedure_code']}: {row['stage']}. {row['subject']}.{date_note}{action}",
                   size=8, first_line_mm=4)


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
    headers = ["№\nп/п", "Рекомендация", "Ответ ГРБС\nна рекомендацию", "Решение УЭР"]
    for c, h, w in zip(hdr.cells, headers, widths):
        c.width = w
        _set_cell_text(c, h, bold=True)
        _shade(c, "D9EAF7")
    for idx, r in enumerate(rows, 1):
        status = str(r.get("semantic_status_ru") or "")
        evidence = str(r.get("business_finding") or "")
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
    doc.core_properties.identifier = str(model["snapshot"].get("snapshot_id") or "")
    doc.core_properties.subject = str(model["snapshot"].get("report_date") or "")
    doc.core_properties.comments = json.dumps({key: model["snapshot"].get(key) for key in
        ("cutoff_at", "rules_version", "renderer_version")}, ensure_ascii=False)
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
    _add_release_notice(doc, report_model)

    _paragraph(doc, "ВСЕ ГРБС", size=12, bold=True, keep_with_next=True)
    h = report_model["headline"]
    content = report_model.get('report_content')
    q = int(h.get("current_quarter") or 1)
    if content:
        for kind, title, color in [('comp', 'ПО КОНКУРЕНТНЫМ ЗАКУПКАМ:', BLUE),
                                   ('ep', 'ЕДИНСТВЕННЫЙ ПОСТАВЩИК:', ORANGE)]:
            _add_complete_section(doc, title, content['global'][kind], year=s['report_year'], quarter=q,
                                  color=color, global_section=True)
            _paragraph(doc, f"Исполнение плана {q} квартала по ГРБС:", bold=True, keep_with_next=True)
            for grbs in report_model['grbs_order']:
                block = content['by_grbs'][grbs][kind][f'q{q}']
                annual = content['by_grbs'][grbs][kind]['year']
                _paragraph(doc, f"- {grbs}: {_pct(block['execution_pct'])} "
                    f"(план на год — {annual['plan_count']}, на квартал — {block['plan_count']}, факт — {block['fact_count']});", size=8, first_line_mm=4)
            if kind == 'comp':
                _add_operational_control(doc, report_model)
    else:
        _add_metric_section(doc, "КОНКУРЕНТНЫЕ ЗАКУПКИ В ПЛАНЕ:", h["competitive"]["year"], h["competitive"]["quarter"], color=BLUE, unit="position")
        _add_metric_section(doc, "ЕДИНСТВЕННЫЙ ПОСТАВЩИК:", h["single_supplier"]["year"], h["single_supplier"]["quarter"], color=ORANGE, unit="position")
    _add_narratives(doc, list((report_model.get("narratives") or {}).get(narrative_mode) or []))
    _add_financial_metrics(doc, report_model)

    for grbs in report_model.get("grbs_order") or []:
        gm = (report_model.get("grbs_metrics") or {}).get(grbs)
        if not gm:
            continue
        _paragraph(doc, grbs, size=12, bold=True, keep_with_next=True)
        comp = gm.get("comp") or {}
        ep = gm.get("ep") or {}
        if content:
            for kind, title, color in [('comp', 'КОНКУРЕНТНЫЕ ЗАКУПКИ:', BLUE),
                                       ('ep', 'ЕДИНСТВЕННЫЙ ПОСТАВЩИК:', ORANGE)]:
                _add_complete_section(doc, title, content['by_grbs'][grbs][kind], year=s['report_year'],
                    quarter=q, color=color, remaining=content['remaining'][grbs][kind])
        elif comp.get("year"):
            _add_metric_section(doc, "КОНКУРЕНТНЫЕ ЗАКУПКИ В ПЛАНЕ:", comp["year"], comp.get(f"q{q}") or comp["year"], color=BLUE, unit="position")
        if not content and ep.get("year"):
            _add_metric_section(doc, "ЕДИНСТВЕННЫЙ ПОСТАВЩИК:", ep["year"], ep.get(f"q{q}") or ep["year"], color=ORANGE, unit="position")
        tables = (report_model.get("recommendation_tables_by_grbs") or {}).get(grbs)
        if tables:
            for group in tables:
                _add_recommendations(doc, group["rows"], str(s.get("report_date") or ""))
        else:
            _add_recommendations(doc, (report_model.get("recommendations_by_grbs") or {}).get(grbs) or [], str(s.get("report_date") or ""))

    _add_future_plan(doc, report_model)
    _add_data_notices(doc, report_model)
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
    _add_release_notice(doc, report_model)
    h = report_model["headline"]
    content = report_model.get('report_content')
    mgmt = report_model.get('management_summary') or {}
    if content:
        _add_compact_section(doc, 'ПО КОНКУРЕНТНЫМ ЗАКУПКАМ:', content['global']['comp'],
                             quarter=h['current_quarter'], color=BLUE)
    else:
        _add_metric_section(doc, "КОНКУРЕНТНЫЕ ЗАКУПКИ В ПЛАНЕ:", h["competitive"]["year"], h["competitive"]["quarter"], color=BLUE, unit="position")
    comp_remaining = mgmt.get("competitive_remaining_by_grbs") or []
    if comp_remaining:
        _paragraph(doc, "ОСТАТОК ТЕКУЩЕГО КВАРТАЛА — КОНКУРЕНТНЫЕ ЗАКУПКИ В ПЛАНЕ:", bold=True, keep_with_next=True)
        for row in comp_remaining:
            _paragraph(doc, f"- {row['grbs']}: {row['remain_count']} {_position_word(row['remain_count'])} на {_money(row['remain_amount'])} тыс. руб.;", size=8, first_line_mm=4)

    _add_operational_control(doc, report_model)
    if content:
        _add_compact_section(doc, 'ЕДИНСТВЕННЫЙ ПОСТАВЩИК:', content['global']['ep'],
                             quarter=h['current_quarter'], color=ORANGE)
    else:
        _add_metric_section(doc, "ЕДИНСТВЕННЫЙ ПОСТАВЩИК:", h["single_supplier"]["year"], h["single_supplier"]["quarter"], color=ORANGE, unit="position")
    ep_remaining = mgmt.get("single_supplier_remaining_by_grbs") or []
    if ep_remaining:
        _paragraph(doc, "ОСТАТОК ТЕКУЩЕГО КВАРТАЛА — ЕДИНСТВЕННЫЙ ПОСТАВЩИК:", bold=True, keep_with_next=True)
        for row in ep_remaining:
            _paragraph(doc, f"- {row['grbs']}: {row['remain_count']} {_position_word(row['remain_count'])} на {_money(row['remain_amount'])} тыс. руб.;", size=8, first_line_mm=4)

    _add_financial_metrics(doc, report_model)
    _add_published_comparison(doc, report_model)
    pub = report_model.get("publication") or {}
    diff_counts = mgmt.get("diff_counts") or {}
    if diff_counts:
        previous_date = pub.get("previous_official_report_date") or "базового среза"
        _paragraph(doc, "ИЗМЕНЕНИЯ ОТНОСИТЕЛЬНО ПРЕДЫДУЩЕГО ОФИЦИАЛЬНОГО СРЕЗА:", bold=True, keep_with_next=True)
        if previous_date != "базового среза":
            _paragraph(doc, f"Базовый официальный срез: {previous_date}.", size=8, italic=True, color=GRAY)
        for event_type, count in diff_counts.items():
            _paragraph(doc, f"- {event_type}: {count}.", size=8, first_line_mm=4)


    _add_narratives(doc, list((report_model.get("narratives") or {}).get(narrative_mode) or []), include_describe=False)
    rec = report_model.get("recommendations") or {}
    _paragraph(doc, "РЕКОМЕНДАЦИИ:", bold=True, keep_with_next=True)
    _paragraph(
        doc,
        f"Активных — {int(rec.get('active') or 0)}; исторических уникальных — {int(rec.get('historical_unique') or 0)}; "
        f"замещённых исторических версий — {int(rec.get('superseded') or 0)}.",
    )
    execution = {key: value for key, value in (mgmt.get("recommendation_execution_counts") or {}).items()
                 if key != "Не подтверждено" and value}
    if execution:
        _paragraph(doc, "Текущее исполнение: " + "; ".join(f"{k} — {v}" for k, v in execution.items()) + ".", size=8)
    _add_future_plan(doc, report_model)
    _add_data_notices(doc, report_model)
    return _save_with_manifest(doc, report_model, output_path, view="management", narrative_mode=narrative_mode)


def _add_release_notice(doc, model):
    release = model.get("release") or {}
    if release.get("status") == "BLOCKED":
        _paragraph(doc, "ПРОВЕРОЧНЫЙ ОТЧЕТ  Официальный выпуск заблокирован", bold=True, color=RED)


def _add_data_notices(doc, model):
    explanations = {
        'MONETARY_FACT_WITHOUT_COMPLETION_DATE': 'Указана фактическая сумма, но отсутствует дата факта.',
        'COMPLETION_DATE_WITH_ZERO_FACT': 'Указана дата факта, но фактическая сумма равна нулю.',
    }
    warnings = [x for x in model.get('issues', []) if x.get('severity') == 'WARN' and x.get('code') in explanations]
    if warnings:
        _paragraph(doc, "Сведения, требующие уточнения", bold=True, keep_with_next=True)
        details = {r['physical_row_key']: r for r in model.get('details', [])}
        for warning in warnings:
            context = warning.get('context') or {}
            row = details.get(context.get('row_key'), {})
            subject = row.get('subject') or ('закупка № ' + str(context.get('procurement_id') or 'не указан'))
            _paragraph(doc, f"{context.get('grbs') or ''}: {subject}. {explanations[warning['code']]}", size=8, space_after=3)


def _add_financial_metrics(doc, model):
    metrics = model.get('exact_metrics')
    if not metrics:
        return
    _paragraph(doc, 'Денежные показатели', bold=True, keep_with_next=True)
    for kind, label in (('competitive', 'Конкурентные закупки'), ('single_supplier', 'Единственный поставщик')):
        for period, period_label in (('year', 'год'), ('quarter', 'текущий квартал')):
            values = metrics[kind][period]['exact_decimal']
            _paragraph(doc, f"{label}, {period_label}: план — {_money(values['plan_amount'])}; денежный факт — {_money(values['monetary_fact_amount'])} тыс. руб. "
                f"Отклонение факт минус план — {_money(values['deviation_amount'])} тыс. руб. "
                f"Доля законтрактованного — {_pct(values['contracted_share_pct'])}. "
                f"Подтверждённая экономия — {_money(values['confirmed_saving_amount'])} тыс. руб.", size=8, space_after=3)


def _add_published_comparison(doc, model):
    comparison = model.get('comparison')
    if not comparison:
        return
    _paragraph(doc, 'Сравнение с предыдущим опубликованным выпуском', bold=True, keep_with_next=True)
    status = comparison['status']
    if status == 'FIRST_RELEASE':
        _paragraph(doc, 'Предыдущего проверенного выпуска за более раннюю дату нет. Сравнение не рассчитывается.', size=8)
        return
    _paragraph(doc, f"Предыдущий выпуск: {comparison['previous_report_date']}.", size=8)
    if status != 'COMPARABLE':
        reason = 'изменилась методика расчёта; показатели двух выпусков несопоставимы' if status == 'RULES_CHANGED' else 'изменён год плана'
        _paragraph(doc, f'Сравнение не рассчитывается: {reason}.', size=8)
        return
    if 'quarter' not in comparison['compared_periods']:
        _paragraph(doc, 'Текущий квартал изменился. Сравниваются только годовые показатели.', size=8)
    if not comparison['changes']:
        _paragraph(doc, 'Сопоставимые итоговые показатели не изменились.', size=8)
    labels = {'plan_count':'позиций в плане', 'fact_count':'позиций с датой факта', 'remain_count':'позиций без даты факта',
              'plan_amount':'плановая сумма', 'fact_amount':'сумма по позициям с датой факта', 'remain_amount':'плановая сумма оставшихся позиций'}
    for change in comparison['changes']:
        kind = 'Конкурентные закупки' if change['kind'] == 'competitive' else 'Единственный поставщик'
        period = 'год' if change['period'] == 'year' else 'текущий квартал'
        is_money = change['field'].endswith('_amount')
        before = _money(change['before']) if is_money else str(change['before'])
        after = _money(change['after']) if is_money else str(change['after'])
        unit = ' тыс. руб.' if is_money else ''
        _paragraph(doc, f"{kind}, {period}: {labels[change['field']]} — {before} → {after}{unit}.", size=8)


def _add_future_plan(doc, model):
    future = model.get("future_plan") or {}
    rows = future.get("rows") or []
    if not future:
        return
    _paragraph(doc, f"ЗАКУПКИ БУДУЩЕГО ПЕРИОДА {future['target_year']}", bold=True, keep_with_next=True)
    if not rows:
        _paragraph(doc, "В зарегистрированных источниках записи не обнаружены.", size=8)
        return
    _paragraph(doc, f"В план {model['snapshot'].get('report_year')} года не включены.", size=8)
    for row in rows:
        month = str(row['target_month']) if row.get('target_month') else "не установлен"
        note = " Период указан в комментарии; в плане пока не закреплён." if row.get("review_required") else ""
        _paragraph(doc, f"{row['grbs']}: {row['subject']}. Сумма {_money(row['amount_thousand'])} тыс. руб. Месяц: {month}.{note}", size=8, space_after=4)
