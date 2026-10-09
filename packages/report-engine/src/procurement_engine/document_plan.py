"""Renderer-independent business document plans.

Each paragraph and table cell is enumerated, tied to a template rule and model
paths. Selection/wording lives here; the DOCX writer handles formatting only.
The publication reader rebuilds this plan and compares ordered OOXML content.
This is not an NLP assertion that arbitrary source prose is factually true.
"""
import json
import re
from contextlib import contextmanager
from functools import wraps
from typing import Any

from .renderer_guard import assert_renderer_inputs

BLUE = "95B3D7"
ORANGE = "E36C0A"
GRAY = "7F7F7F"
RED = "C00000"


def _escape(value):
    return str(value).replace('~', '~0').replace('/', '~1')


class DocumentPlan:
    def __init__(self, model, view, mode):
        # Only fields consumed by the document. Do not clone identity databases,
        # origin packages, formula grids or already-built document plans.
        keys = ('snapshot', 'headline', 'grbs_order', 'report_content', 'grbs_metrics',
                'management_summary', 'procedures', 'narratives', 'publication', 'comparison',
                'recommendations', 'recommendations_by_grbs', 'recommendation_tables_by_grbs',
                'source_context', 'source_context_groups', 'future_plan', 'issues', 'details', 'exact_metrics', 'release', 'contract', 'weekly_evidence')
        projection = {key: model[key] for key in keys if key in model}
        if 'details' in projection:
            projection['details'] = [{key: value for key, value in row.items()
                                      if key in {'physical_row_key', 'subject'}} for row in model['details']]
        if 'recommendations' in projection:
            projection['recommendations'] = {key: value for key, value in model['recommendations'].items()
                                              if key in {'active', 'historical_unique', 'superseded'}}
        self.model = json.loads(json.dumps(projection, ensure_ascii=False, allow_nan=False))
        self.view = view
        self.mode = mode
        self.blocks = []
        self.paths = {}
        self.current = ('DOC.STRUCTURE', ['/snapshot', '/headline', '/grbs_order'])
        self.counts = {}

        def index(value, path):
            if isinstance(value, (dict, list)):
                self.paths.setdefault(id(value), path)
                for key, item in (value.items() if isinstance(value, dict) else enumerate(value)):
                    if path == '' and key in {'document_plans'}:
                        continue
                    index(item, path + '/' + _escape(key))
        index(self.model, '')

    def path(self, value):
        return self.paths.get(id(value))

    @contextmanager
    def binding(self, rule, paths):
        prior = self.current
        self.current = (rule, list(dict.fromkeys(path for path in paths if path)))
        try:
            yield
        finally:
            self.current = prior

    def _block(self, kind, payload):
        rule, paths = self.current
        scope = self.view + ':' + rule + ':' + '|'.join(paths)
        ordinal = self.counts.get(scope, 0)
        self.counts[scope] = ordinal + 1
        self.blocks.append({'block_id': scope + ':' + str(ordinal), 'kind': kind,
                            'template_rule_id': rule, 'model_paths': paths, **payload})

    def paragraph(self, text, **style):
        self._block('paragraph', {'text': str(text), 'style': style})

    def table(self, headers, rows, records):
        cells = []
        fields = (('row_no',), ('recommendation',), ('grbs_response',),
                  ('uer_decision', 'semantic_status_ru', 'business_finding'))
        for column, text in enumerate(headers):
            cells.append({'row': 0, 'column': column, 'text': text,
                          'template_rule_id': 'DOC.RECOMMENDATIONS.HEADER',
                          'model_paths': list(self.current[1])})
        for number, (values, record) in enumerate(zip(rows, records, strict=True), 1):
            base = self.path(record)
            if base is None:
                raise ValueError('DOCUMENT_PLAN_UNBOUND_TABLE_RECORD')
            for column, (text, names) in enumerate(zip(values, fields, strict=True)):
                paths = [base + '/' + name for name in names if name in record]
                if column == 3:
                    paths.append('/snapshot/report_date')
                cells.append({'row': number, 'column': column, 'text': text,
                              'template_rule_id': 'DOC.RECOMMENDATIONS.CELL',
                              'model_paths': paths or [base]})
        self._block('table', {'rows': [headers, *rows], 'cells': cells})

    def export(self):
        return {'version': 'document-plan-v1', 'view': self.view, 'narrative_mode': self.mode,
                'snapshot_id': self.model['snapshot']['snapshot_id'], 'blocks': self.blocks}


def section_rule(rule, *, roots=None):
    def decorate(function):
        @wraps(function)
        def wrapped(doc, *args, **kwargs):
            paths = ['/' + key for key in roots if key in doc.model] if roots is not None else [
                doc.path(value) for value in (*args, *kwargs.values())
                if isinstance(value, (list, dict))]
            with doc.binding(rule, [p for p in paths if p] or ['/snapshot']):
                return function(doc, *args, **kwargs)
        return wrapped
    return decorate


def _paragraph(doc, text='', *, source=None, sources=None, **style):
    references = list(sources or []) + ([source] if source is not None else [])
    if references:
        paths = [doc.path(reference) for reference in references]
        if any(path is None for path in paths):
            raise ValueError('DOCUMENT_PLAN_UNBOUND_PARAGRAPH')
        with doc.binding(doc.current[0], paths):
            doc.paragraph(text, **style)
    else:
        doc.paragraph(text, **style)


def _money(v: Any) -> str:
    n = float(v or 0.0)
    return f"{n:,.2f}".replace(",", " ").replace(".", ",")


def _pct(v: Any) -> str:
    if v is None:
        return "не рассчитывается при нулевой базе"
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


@section_rule('DOC.METRIC_SECTION', roots=None)
def _add_metric_section(doc, title: str, metric_year: dict, metric_q: dict,
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


@section_rule('DOC.COMPLETE_SECTION', roots=None)
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
                    comment = (f" ({row['comment']})" if row['comment'] and not doc.model.get('source_context') else '')
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


@section_rule('DOC.COMPACT_SECTION', roots=None)
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


@section_rule('DOC.OPERATIONAL_CONTROL', roots=['procedures'])
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
        action_value = row.get('action') or ''
        if _executive_contract(doc) and _internal_annotation(action_value):
            action_value = ''
        action = f" {action_value}" if action_value else ''
        _paragraph(doc, f"- {row['procedure_code']}: {row['stage']}. {row['subject']}.{date_note}{action}",
                   size=8, first_line_mm=4)


@section_rule('DOC.RECOMMENDATIONS', roots=None)
def _add_recommendations(doc, rows, report_date):
    rows = list(rows)
    if not rows:
        return
    _paragraph(doc, "РЕКОМЕНДАЦИИ (НАКОПИТЕЛЬНЫЙ РЕЕСТР):", bold=True, keep_with_next=True)
    headers = ["№\nп/п", "Рекомендация", "Ответ ГРБС\nна рекомендацию", "Решение УЭР"]
    if doc.model.get('contract', {}).get('business_context_contract') == 'source-context-v1':
        _paragraph(doc, 'Ответы и решения приведены по сохранённым записям. '
                   'Текущие сведения указаны отдельно на дату отчёта.', size=8, italic=True)

    values = []
    for idx, record in enumerate(rows, 1):
        status = str(record.get("semantic_status_ru") or "")
        finding = str(record.get("business_finding") or "")
        if _executive_contract(doc) and _internal_annotation(finding):
            finding = ""
        decision = str(record.get("uer_decision") or "")
        last = "\n".join(x for x in [decision, f"{report_date}: {status}" if status else "", finding] if x)
        values.append([str(record.get("row_no") or idx), record.get("recommendation") or "",
                       record.get("grbs_response") or "", last])
    doc.table(headers, values, rows)


@section_rule('DOC.NARRATIVES', roots=None)
def _add_narratives(doc, blocks: list[dict], *, include_describe: bool = False) -> None:
    blocks = [b for b in blocks if include_describe or str(b.get("stage") or "").lower() != "describe"]
    if not blocks or _executive_contract(doc):
        return
    _paragraph(doc, "АНАЛИТИЧЕСКИЙ КОНТЕКСТ:", bold=True, keep_with_next=True)
    for b in blocks:
        stage = str(b.get("stage") or "").upper()
        label = {"DESCRIBE": "Факт", "EXPLAIN": "Объяснение", "JUDGE": "Оценка", "ACT": "Действие"}.get(stage, stage or "Контекст")
        _paragraph(doc, f"{label}: {b.get('text') or ''}", size=8, italic=stage in {"EXPLAIN", "JUDGE"}, color=GRAY, first_line_mm=8, source=b)




def _executive_contract(doc):
    return doc.model.get('contract', {}).get('weekly_evidence_contract') == 'weekly-evidence-v1'


def _internal_annotation(value):
    """Narrow signatures of machine notes, never arbitrary business explanations."""
    text = str(value or '').strip()
    return bool(re.match(
        r'^(?:\[сверка кодов\]|(?:identity|review)_required\b|'
        r'⚠\s*(?:нет формулы|формула|автокод)|'
        r'(?:ошибка формулы|отсутствует формула кода)\b)', text, re.IGNORECASE))


@section_rule('DOC.WEEKLY_REVIEW', roots=['weekly_evidence'])
def _add_weekly_review(doc, model, *, detailed=False):
    """Executive explanation from immutable, source-proven before/after positions."""
    from .weekly_evidence import LABELS, event_sentence

    weekly = model.get('weekly_evidence')
    if not weekly:
        return
    _paragraph(doc, 'ИЗМЕНЕНИЯ ПО СРАВНЕНИЮ С ПРОШЛОЙ НЕДЕЛЕЙ',
               bold=True, color=BLUE, keep_with_next=True)
    if weekly['status'] != 'COMPARABLE':
        _paragraph(doc, weekly['message'], color=ORANGE, italic=True, size=8)
        return
    baseline_human = '.'.join(reversed(weekly['baseline_date'].split('-')))
    _paragraph(doc, f"Сравнение с проверенным отчётом от {baseline_human}. "
               "Показаны изменения записей, а не только события по дате заключения.",
               size=8, italic=True, color=GRAY)
    for kind, label in (('competitive', 'Конкурентные закупки'), ('single_supplier', 'Единственный поставщик')):
        block = weekly['totals'][kind]
        count = block['plan_count']; fact = block['fact_count']
        def shift(value):
            number = int(value)
            return f"+{number}" if number > 0 else str(number)
        _paragraph(doc, f"{label}: план на год {count['before']} → {count['after']} "
                   f"({shift(count['delta'])}); позиций с датой факта {fact['before']} → {fact['after']} "
                   f"({shift(fact['delta'])}).", size=8, source=block)
    counts = weekly.get('event_counts') or {}
    if counts:
        selected = [f"{LABELS[k].lower()} — {n}" for k, n in counts.items() if n]
        _paragraph(doc, 'По подтверждённым связям закупок: ' + '; '.join(selected) + '.',
                   size=8, source=weekly['event_counts'])
    else:
        _paragraph(doc, 'По однозначно сопоставленным закупкам изменений реквизитов не обнаружено.',
                   size=8, source=weekly)
    if weekly['recommendations_added']:
        _paragraph(doc, f"Новых официальных рекомендаций УЭР относительно прошлого выпуска: "
                   f"{weekly['recommendations_added']}.", size=8, source=weekly)
    if weekly.get('recommendations_revised'):
        _paragraph(doc, f"Рекомендаций УЭР с изменённой формулировкой: "
                   f"{weekly['recommendations_revised']}. Ранее опубликованные редакции сохранены.",
                   size=8, source=weekly)
    if weekly.get('procedure_stage_changes'):
        _paragraph(doc, 'Изменения стадий процедур, остающихся в работе:', size=8,
                   bold=True, source=weekly)
        for row in weekly['procedure_stage_changes'][:(8 if detailed else 3)]:
            _paragraph(doc, f"— {row['code']}: {row['before']} → {row['after']}. "
                       f"{row['subject']}", size=8, first_line_mm=4, source=row)
        remaining = len(weekly['procedure_stage_changes']) - (8 if detailed else 3)
        if remaining > 0:
            _paragraph(doc, f"Ещё {remaining} изменений стадий отражены в данных выпуска.",
                       color=GRAY, size=8, source=weekly)

    limit = 12 if detailed else 4
    for event in (weekly.get('events') or [])[:limit]:
        _paragraph(doc, '— ' + event_sentence(event, baseline_date=weekly['baseline_date']),
                   size=8, source=event, first_line_mm=4)
    extra = len(weekly.get('events') or []) - limit
    if extra > 0:
        _paragraph(doc, f"Остальные {extra} изменений сохранены в проверенной аналитике этого выпуска.",
                   size=8, color=GRAY, source=weekly)
    if weekly['unmatched_positions']:
        _paragraph(doc, f"Записей, связь которых с прошлой неделей пока не подтверждена: "
                   f"{weekly['unmatched_positions']}. Их нельзя считать новыми или отменёнными закупками.",
                   size=8, color=ORANGE, italic=True, source=weekly)

def build_main_plan(report_model: dict, *, narrative_mode: str = "GENERIC_TEMPLATE") -> dict:
    assert_renderer_inputs(report_model=report_model)
    if narrative_mode not in {"GENERIC_TEMPLATE", "SMART_NARRATIVE"}:
        raise ValueError("Unsupported narrative mode")
    doc = DocumentPlan(report_model, "main", narrative_mode)
    report_model = doc.model
    s = report_model["snapshot"]
    _paragraph(doc, "ОТЧЕТ ПО ЗАКУПКАМ", bold=True, align="right")
    _paragraph(doc, f"срез на {s.get('report_date')}", bold=True, align="right")
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
                    f"(план на год — {annual['plan_count']}, на квартал — {block['plan_count']}, факт — {block['fact_count']});", size=8, first_line_mm=4, sources=(block, annual))
            if kind == 'comp':
                _add_operational_control(doc, report_model)
    else:
        _add_metric_section(doc, "КОНКУРЕНТНЫЕ ЗАКУПКИ В ПЛАНЕ:", h["competitive"]["year"], h["competitive"]["quarter"], color=BLUE, unit="position")
        _add_metric_section(doc, "ЕДИНСТВЕННЫЙ ПОСТАВЩИК:", h["single_supplier"]["year"], h["single_supplier"]["quarter"], color=ORANGE, unit="position")
    _add_narratives(doc, (report_model.get("narratives") or {}).get(narrative_mode) or [])
    _add_financial_metrics(doc, report_model)
    if _executive_contract(doc):
        _add_weekly_review(doc, report_model, detailed=False)

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

    _add_source_context(doc, report_model)
    _add_future_plan(doc, report_model)
    _add_data_notices(doc, report_model)
    return doc.export()


def build_management_plan(report_model: dict, *, narrative_mode: str = "SMART_NARRATIVE") -> dict:
    assert_renderer_inputs(report_model=report_model)
    if narrative_mode not in {"GENERIC_TEMPLATE", "SMART_NARRATIVE"}:
        raise ValueError("Unsupported narrative mode")
    doc = DocumentPlan(report_model, "management", narrative_mode)
    report_model = doc.model
    s = report_model["snapshot"]
    _paragraph(doc, "Для АВ дополнительно", bold=True, align="left")
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
            _paragraph(doc, f"- {row['grbs']}: {row['remain_count']} {_position_word(row['remain_count'])} на {_money(row['remain_amount'])} тыс. руб.;", size=8, first_line_mm=4, source=row)

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
            _paragraph(doc, f"- {row['grbs']}: {row['remain_count']} {_position_word(row['remain_count'])} на {_money(row['remain_amount'])} тыс. руб.;", size=8, first_line_mm=4, source=row)

    _add_financial_metrics(doc, report_model)
    if _executive_contract(doc):
        _add_weekly_review(doc, report_model, detailed=True)
    else:
        _add_published_comparison(doc, report_model)
    pub = report_model.get("publication") or {}
    diff_counts = mgmt.get("diff_counts") or {}
    if diff_counts and not _executive_contract(doc):
        previous_date = pub.get("previous_official_report_date") or "базового среза"
        _paragraph(doc, "ИЗМЕНЕНИЯ ОТНОСИТЕЛЬНО ПРЕДЫДУЩЕГО ОФИЦИАЛЬНОГО СРЕЗА:", bold=True, keep_with_next=True)
        if previous_date != "базового среза":
            _paragraph(doc, f"Базовый официальный срез: {previous_date}.", size=8, italic=True, color=GRAY, source=pub)
        for event_type, count in diff_counts.items():
            _paragraph(doc, f"- {event_type}: {count}.", size=8, first_line_mm=4, source=diff_counts)


    _add_narratives(doc, (report_model.get("narratives") or {}).get(narrative_mode) or [], include_describe=False)
    rec = report_model.get("recommendations")
    if rec is not None:
        _paragraph(doc, "РЕКОМЕНДАЦИИ:", bold=True, keep_with_next=True)
        _paragraph(
            doc,
            f"Активных — {int(rec.get('active') or 0)}; исторических уникальных — {int(rec.get('historical_unique') or 0)}; "
            f"замещённых исторических версий — {int(rec.get('superseded') or 0)}.", source=rec,
        )
    execution = {key: value for key, value in (mgmt.get("recommendation_execution_counts") or {}).items()
                 if key != "Не подтверждено" and value}
    if execution:
        _paragraph(doc, "Текущее исполнение: " + "; ".join(f"{k} — {v}" for k, v in execution.items()) + ".", size=8, source=mgmt["recommendation_execution_counts"])
    _add_source_context(doc, report_model)
    _add_future_plan(doc, report_model)
    if _executive_contract(doc):
        _paragraph(doc, 'Сведения о свободных остатках местного бюджета из оперативного финансового учёта '
                   'в этот выпуск пока не включены.', color=ORANGE, size=8, italic=True)
    _add_data_notices(doc, report_model)
    return doc.export()


@section_rule('DOC.RELEASE_NOTICE', roots=['release'])
def _add_release_notice(doc, model):
    release = model.get("release") or {}
    if release.get("status") == "BLOCKED":
        _paragraph(doc, "ПРОВЕРОЧНЫЙ ОТЧЕТ  Официальный выпуск заблокирован", bold=True, color=RED)


@section_rule('DOC.DATA_NOTICES', roots=['issues', 'details'])
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


@section_rule('DOC.FINANCIAL_METRICS', roots=['exact_metrics'])
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
                f"Денежный факт к плановой сумме — {_pct(values['contracted_share_pct'])}. "
                f"Подтверждённая экономия — {_money(values['confirmed_saving_amount'])} тыс. руб.", size=8, space_after=3)


@section_rule('DOC.PUBLISHED_COMPARISON', roots=['comparison'])
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
        reason = {'RULES_CHANGED': 'изменилась методика расчёта; показатели двух выпусков несопоставимы',
                  'REPORT_SCOPE_CHANGED': 'изменился состав управлений, включённых в отчёт',
                  'REPORT_YEAR_CHANGED': 'изменён год плана'}.get(status, 'сопоставимость выпусков не подтверждена')
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


@section_rule('DOC.FUTURE_PLAN', roots=['future_plan', 'snapshot'])
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


@section_rule('DOC.SOURCE_CONTEXT', roots=['source_context', 'source_context_groups'])
def _add_source_context(doc, model):
    if model.get('contract', {}).get('context_presentation_contract') == 'relevant-context-v1':
        return _add_grouped_context(doc, model)
    records = [row for row in model.get('source_context', [])
               if any(entry['visibility'] == 'business' for entry in row['explanations'])]
    if not records:
        return
    _paragraph(doc, 'ПОЯСНЕНИЯ К ПОЗИЦИЯМ ПЛАНА', bold=True, keep_with_next=True)
    for row in records:
        with doc.binding('DOC.SOURCE_CONTEXT_ROW', [doc.path(row)]):
            number = f" № {row['business_id']}" if row['business_id'] else ''
            period = str(row['planned_year']) if row['planned_year'] else 'не указан'
            date = '.'.join(reversed(row['planned_date'].split('-'))) if row['planned_date'] else 'не указана'
            _paragraph(doc, f"{row['grbs']}{number}: {row['subject']}. Год плана — {period}; плановая дата — {date}.",
                       size=8, bold=True, keep_with_next=True)
            for entry in row['explanations']:
                if entry['visibility'] != 'business' or (_executive_contract(doc) and _internal_annotation(entry['text'])):
                    continue
                with doc.binding('DOC.SOURCE_EXPLANATION', [doc.path(entry)]):
                    _paragraph(doc, f"{entry['label']}: «{entry['text']}».", size=8, first_line_mm=4)


def _add_grouped_context(doc, model):
    groups = model.get('source_context_groups', [])
    if _executive_contract(doc):
        groups = [group for group in groups if any(
            not _internal_annotation(entry['text'])
            for entry in group.get('explanations', []))]
    if not groups:
        return
    _paragraph(doc, 'ПОЯСНЕНИЯ К ПОЗИЦИЯМ ПЛАНА', bold=True, keep_with_next=True)
    for group in groups:
        members = group['members']
        with doc.binding('DOC.CONTEXT_GROUP', [doc.path(group)]):
            labels = [f"№ {member['business_id']}" if member['business_id'] else f"«{member['subject']}»"
                      for member in members]
            subjects = '; '.join(dict.fromkeys(member['subject'] for member in members))
            plan = '.'.join(reversed(group['planned_date'].split('-'))) if group['planned_date'] else 'не указана'
            _paragraph(doc, f"{group['grbs']}, план {group['planned_year']} года: {', '.join(labels)}. "
                       f"Предмет: {subjects}; плановая дата — {plan}.", size=8, bold=True, keep_with_next=True)
            for entry in group['explanations']:
                if _executive_contract(doc) and _internal_annotation(entry['text']):
                    continue
                # The entry lists EVERY source in the group, not only the first.
                with doc.binding('DOC.GROUPED_EXPLANATION', [doc.path(entry), *[doc.path(member) for member in members]]):
                    _paragraph(doc, f"{entry['label']}: «{entry['text']}».", size=8, first_line_mm=4)
