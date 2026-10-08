"""Check rendered section populations against frozen cells and canonical records."""
import re
from collections import defaultdict
from dataclasses import replace
from fractions import Fraction

from .independent_audit import day, method, number, text
from .normalize import normalize_procedure_code
from .procedures import (
    iter_operational_rows,
    normalize_procedure_values,
    operational_cells,
    validate_operational_view,
    validate_procedure_lineage,
    validate_procedure_shares,
    validate_procedure_uniqueness,
)


def audit_recommendation_projections(model):
    recs=model.get('recommendations') or {}
    grouped=defaultdict(list); rendered={}
    for table, records in (recs.get('tables') or {}).items():
        if records != sorted(records, key=lambda r:(int(r.get('row_no') or 0),r['recommendation_id'])):
            return False
        if any(str(int(r.get('table_no') or 0)) != table for r in records):
            return False
        rendered[table]=[]
        for r in records:
            original=(r.get('uer_decision_original') or '').strip()
            status=f"Статус на {model['snapshot']['report_date']}: {r.get('semantic_status_ru')}. {r.get('status_evidence') or ''}".strip()
            rendered[table].append({'row_no':r.get('row_no'),'recommendation_id':r['recommendation_id'],
                'recommendation':r.get('recommendation_text') or '', 'grbs_response':r.get('grbs_response_original') or '',
                'uer_decision_and_current_status':original+('\n' if original else '')+status})
            grouped[str(r.get('grbs') or '')].append({'row_no':r.get('row_no'),'table_no':r.get('table_no'),
                'section':r.get('section'),'recommendation_id':r['recommendation_id'],
                'recommendation':r.get('recommendation_text') or '', 'grbs_response':r.get('grbs_response_original') or '',
                'uer_decision':r.get('uer_decision_original') or '',
                'semantic_status_ru':r.get('semantic_status_ru', r.get('semantic_status') or ''),
                'status_evidence':r.get('status_evidence') or '',
                **({'business_finding': r.get('business_finding') or ''}
                   if model.get('contract', {}).get('business_context_contract') == 'source-context-v1' else {})})
    tables={}
    for grbs, records in grouped.items():
        records.sort(key=lambda r:(int(r.get('table_no') or 0),int(r.get('row_no') or 0),r['recommendation_id']))
        by_table=defaultdict(list)
        for r in records:by_table[r.get('table_no')].append(r)
        tables[grbs]=[{'table_no':key,'rows':rows} for key,rows in by_table.items()]
    return (model.get('recommendations_by_grbs')==dict(grouped)
            and model.get('recommendation_tables_by_grbs')==tables and recs.get('renderer_tables')==rendered)


def _future_population(capture):
    year=capture['report_year']+1; records=[]
    for source in capture['sources']:
        if source.get('role')!='master':continue
        for rn,row in enumerate(source['values'][source.get('header_rows', 3):], source.get('header_rows', 3) + 1):
            c=lambda i,row=row:row[i] if i<len(row) else None
            if not c(6):continue
            planned=day(c(13))
            # The legacy year contract treats zero and nonnumeric markers as absent.
            try: planned_year=int(number(c(15))) or None
            except ValueError: planned_year=None
            blob=' '.join(text(c(i)).casefold() for i in (4,6,12,20,30,31,32,33))
            structured=planned_year==year or bool(planned and planned.startswith(f'{year}-'))
            phrases=[f'поставили в план на {year}',
                f'за счет средств планового периода со сроком выполнения в {year}',
                f'за счёт средств планового периода со сроком выполнения в {year}',
                f'план на {year}',f'запланировано на {year}']
            # Independent date parser: new dates must work without a historical literal.
            explicit = set()
            for found in re.finditer(r'\bзапланировано\s+(?:на\s+)?(\d{2}\.\d{2}\.\d{4})(?!\d)', blob):
                prior_words = blob[:found.start()].split()
                if prior_words and prior_words[-1] in {'изготовление', 'исполнение', 'выполнение', 'оказание', 'оплата', 'поставка'}:
                    continue
                date = day(found[1])
                if date and date.startswith(f'{year}-'):
                    explicit.add(date)
            proposed=planned_year is None and planned is None and (any(x in blob for x in phrases) or bool(explicit))
            if not structured and not proposed:continue
            basis='structured_plan_date' if planned else None
            if not planned and len(explicit)==1:
                planned=explicit.pop();basis='explicit_current_plan_text'
            business_id=re.sub(r'^(\d+)\.0$',r'\1',text(c(0)))
            records.append({'grbs':source['grbs'],'provider_id':source['provider_id'],'sheet_id':source['sheet_id'],
                'sheet':source['sheet'],'row_number':rn,'business_id':business_id or None,'subject':text(c(6)),
                'amount_thousand':float(sum((number(c(i)) for i in (7,8,9)),Fraction(0))),
                'classification':f'STRUCTURED_PLAN_{year}' if structured else f'TARGET_PLAN_{year}_UNSTRUCTURED',
                'date_basis':basis,'target_year':year,'target_month':int(planned[5:7]) if planned and planned.startswith(str(year)) else None,
                'evidence':' | '.join(text(c(i)) for i in (20,30,31,32,33) if c(i)), 'review_required':not structured})
    return {'target_year':year,'rows':records,'unknown_month_count':sum(r['target_month'] is None for r in records)}


def audit_management_projection(model):
    summary=model.get('management_summary') or {}
    quarter=(model['snapshot'].get('report_scope') or {}).get('quarter', (int(day(model['snapshot']['report_date'])[5:7])-1)//3+1)
    if summary.get('current_quarter')!=quarter:return False
    for field,kind in [('competitive_remaining_by_grbs','comp'),('single_supplier_remaining_by_grbs','ep')]:
        expected=[]
        for grbs in model.get('grbs_order') or []:
            block=model['grbs_metrics'][grbs][kind][f'q{quarter}']
            if block['remain_count']>0:
                expected.append({'grbs':grbs,'remain_count':block['remain_count'],'remain_amount':block['remain_amount']})
        if summary.get(field)!=expected:return False
    from .recommendation_evidence import recommendation_counts
    records=[r for table in (model.get('recommendations') or {}).get('tables', {}).values() for r in table]
    counts=recommendation_counts(records)
    if 'identity_review_evidence' not in model and not records:
        counts={key:{'Не подтверждено':0} for key in counts}
    return all(summary.get(key) == value for key, value in counts.items())


def _remaining_population(capture):
    scopes = ('year', 'q1', 'q2', 'q3', 'q4')
    result = {s['grbs']: {kind: {scope: [] for scope in scopes} for kind in ('comp', 'ep')}
              for s in capture['sources'] if s.get('role') == 'master'}
    as_of = day(capture['report_date'])
    for source in capture['sources']:
        if source.get('role') != 'master':
            continue
        for rowno, raw in enumerate(source['values'][source.get('header_rows', 3):], source.get('header_rows', 3) + 1):
            c = lambda i, raw=raw: raw[i] if i < len(raw) else None
            kind = method(c(11)); planned = day(c(13)); actual = day(c(16))
            try:
                year = int(number(c(15))); quarter = int(number(c(14)))
            except (ValueError, ZeroDivisionError):
                continue
            if (not (text(c(5)) and text(c(6)) and kind and planned)
                    or year != capture['report_year'] or (actual and actual <= as_of)):
                continue
            business = re.sub(r'^(\d+)\.0$', r'\1', text(c(0))) or None
            label = business or f"__ROW__::{source['provider_id']}::{source['sheet']}::{rowno}"
            item = {'source_row_key': f"{source['provider_id']}::{source['sheet']}::{rowno}::{label}",
                    'business_id': business, 'institution': text(c(2)), 'subject': text(c(6)),
                    'amount_thousand_decimal': sum((number(c(i)) for i in (7,8,9)), Fraction(0)),
                    'comment': ' | '.join(dict.fromkeys(text(c(i)) for i in (20,31)
                        if text(c(i)) and text(c(i)).casefold() not in {'x','х','-','—'}))}
            key = 'comp' if kind == 'competitive' else 'ep'
            result[source['grbs']][key]['year'].append(item)
            if quarter in (1,2,3,4):
                result[source['grbs']][key][f'q{quarter}'].append(item)
    return result


def _normalized_remaining(records):
    try:
        return {grbs: {kind: {scope: [{**r, 'amount_thousand_decimal': number(r['amount_thousand_decimal'])}
            for r in rows] for scope, rows in scopes.items()} for kind, scopes in kinds.items()}
            for grbs, kinds in records.items()}
    except (TypeError, KeyError, ValueError, ZeroDivisionError):
        return None


def audit_source_sections(capture,model,*,ledger=None,identity_evidence=None):
    errors=[]
    if (model.get('contract', {}).get('business_context_contract') == 'source-context-v1'
        and not audit_context(capture, model)):
        errors.append('source_context')
    if 'report_content' in model:
        actual = _normalized_remaining((model['report_content'] or {}).get('remaining') or {})
        if actual != _remaining_population(capture):
            errors.append('remaining_population')
    if ledger is not None:
        # Replay text and observations from frozen inputs, rather than accepting
        # mutually consistent but invented human-readable claims in projections.
        from .adapters import normalize_master_values
        from .raw_pipeline import review_recommendations
        from .recommendation_links import primary_budget_years

        sid=model['snapshot']['snapshot_id'];rows=[]
        for source in capture['sources']:
            if source.get('role')=='master':
                rows.extend(normalize_master_values(source['values'],snapshot_id=sid,expected_grbs=source['grbs'],
                    data_start_row=source.get('header_rows', 3),source_id=source['provider_id'],sheet_name=source['sheet']))
        identity = capture.get('identity_evidence') or {}
        if not model.get('contract', {}).get('recommendation_link_contract'):
            identity = identity or model.get('identity_observations') or {}
        if model.get('contract', {}).get('recommendation_link_contract'):
            from .identity_store import signature

            evidence = {item['source_row_key']: item for item in identity.get('rows', [])}
            if (set(evidence) != {row.physical_row_key for row in rows}
                or any(evidence[row.physical_row_key].get('evidence', {}).get('signature') != signature(row) for row in rows)):
                errors.append('identity_evidence')
        uids = {item['source_row_key']: item['procurement_uid'] for item in identity.get('rows', [])}
        rows = [replace(row, procurement_uid=uids.get(row.physical_row_key)) for row in rows]
        documents = {}
        if capture.get('recommendation_history_evidence') is not None:
            from .recommendation_history import enroll_history_package

            _, documents = enroll_history_package(capture['recommendation_history_evidence']['package'], ledger)
        expected={r['recommendation_id']:r for r in review_recommendations(ledger,rows,sid,model['snapshot']['report_date'], documents=documents, identity_evidence=identity_evidence, legacy=not model.get('contract', {}).get('recommendation_link_contract'),
            link_contract=model.get('contract', {}).get('recommendation_link_contract'),
        context_contract=model.get('contract', {}).get('business_context_contract'),
        budget_years=primary_budget_years(capture['sources']))}
        if 'recommendation_records' in model and model['recommendation_records'] != list(expected.values()):
            errors.append('recommendation_records')

        for records in (model.get('recommendations') or {}).get('tables',{}).values():
            for row in records:
                wanted=expected.get(row['recommendation_id'])
                if wanted is not None and 'identity_review_evidence' not in model:
                    wanted.pop('business_finding', None)
                if wanted is None or any(row.get(key)!=value for key,value in wanted.items()):
                    errors.append('recommendation_evidence')
                    break
    if model.get('future_plan')!=_future_population(capture):errors.append('future_plan')
    master=next(s for s in capture['sources'] if s['sheet']=='Рабочий реестр процедур')
    queue=next(s for s in capture['sources'] if s['sheet']=='Процедуры в работе')
    attempts,shares=normalize_procedure_values(master['values'])
    raw_issues=(validate_operational_view(master['values'],queue['values'],as_of=capture['report_date'])
        + validate_procedure_uniqueness(attempts)+validate_procedure_lineage(attempts)
        + validate_procedure_shares(attempts,shares))
    if any(i.severity=='ERROR' for i in raw_issues):errors.append('procedure_source_contract')
    active=[];closed=[]
    for block,rn,offset,row in iter_operational_rows(queue['values']):
        cells = operational_cells(row, offset)
        c=lambda i,cells=cells:cells[i] if i<len(cells) else None
        code=normalize_procedure_code(c(3))
        source_ref=f"{queue['provider_id']}::{queue['sheet']}::{rn}"
        if offset: source_ref += f"::column_offset={offset}"
        item={'procedure_code':code,'stage':c(8),'subject':c(6),'action':c(2),
              'source_ref':source_ref}
        if block == 'closed_quality':
            item.update(raw_cells=row,classification='closed_procedure_data_quality');closed.append(item)
        else:
            item['deadline']=day(c(0)) or c(0);active.append(item)
    expected={'procedures':active,'closed_procedure_quality':closed,'active_procedures_count':len(active)}
    for key,want in expected.items():
        if model.get(key)!=want:errors.append(key)
    mgmt=model.get('management_summary') or {}
    for key,want in [('procedure_rows',active),('procedure_count',len(active))]:
        if mgmt.get(key)!=want:errors.append('management_summary.'+key)
    assurance_contract = (model.get('contract') or {}).get('automation_assurance_contract')
    if assurance_contract in {'actionable-assurance-v1', 'actionable-assurance-v2'}:
        from .automation_assurance import assess_automation
        if model.get('automation_assurance') != assess_automation(
                model, capture['sources'], legacy_scope=assurance_contract == 'actionable-assurance-v1'):
            errors.append('automation_assurance')
    return errors


def audit_context(capture, model):
    """Independently reconstruct every displayed explanation from frozen cells.

    Do not call the producer's context_rows/explanations: the audit must notice a
    forgotten column in that producer, not repeat the omission.
    """
    fields = [(12, 'M', 'single_supplier_reason', 'Основание выбора ЕП'),
              (20, 'U', 'deviation_reason', 'Пояснение отклонения'),
              (30, 'AE', 'necessity_reason', 'Обоснование необходимости'),
              (31, 'AF', 'grbs_comment', 'Комментарий ГРБС'),
              (32, 'AG', 'uer_comment', 'Комментарий УЭР'),
              (33, 'AH', 'monitoring_note', 'Примечание мониторинга')]
    details = {(r['source_id'], r['sheet_name'], r['row_number']): r for r in model.get('details', [])}
    from .source_context import is_technical_note
    expected = []
    for source in capture['sources']:
        if source.get('role') != 'master':
            continue
        for number_row, raw in enumerate(source['values'][source.get('header_rows', 3):],
                                          source.get('header_rows', 3) + 1):
            detail = details.get((source['provider_id'], source['sheet'], number_row))
            if detail is None:
                continue  # The row-population audit handles whether this is a procurement.
            cell = lambda i, raw=raw: raw[i] if i < len(raw) else None
            c = lambda i, cell=cell: text(cell(i))
            try:
                raw_year = number(cell(15))
                plan_year = int(raw_year) if raw_year.denominator == 1 and 1 <= raw_year <= 9999 else None
            except (ValueError, ZeroDivisionError):
                plan_year = None
            primary = {'source_row_no': re.sub(r'^(\d+)\.0$', r'\1', c(0)) or None,
                       'subject': c(6), 'planned_year': plan_year, 'planned_date': day(cell(13)),
                       'actual_date': day(cell(16)),
                       'method': {'competitive': 'ЭА', 'single_supplier': 'ЕП'}.get(method(cell(11)))}
            if any(detail.get(key) != value for key, value in primary.items()):
                return False
            entries = []
            for index, column, field, label in fields:
                value = '' if column == 'AG' and normalize_procedure_code(c(index)) else c(index)
                if detail.get(field) != value:
                    return False
                if value.casefold() not in {'', 'x', 'х', '-', '—'}:
                    entries.append({'field': field, 'column': column, 'label': label, 'text': value,
                                    'source_row_key': detail['physical_row_key'], 'assertion_kind': 'SOURCE_STATEMENT',
                                    'visibility': 'diagnostic_only' if is_technical_note(value) else 'business'})
            if detail.get('program') != c(3) or detail.get('subprogram') != c(4):
                return False
            if entries:
                expected.append({'source_row_key': detail['physical_row_key'], 'business_id': primary['source_row_no'],
                                 'grbs': source['grbs'], 'subject': primary['subject'], 'planned_year': plan_year,
                                 'planned_date': primary['planned_date'], 'actual_date': primary['actual_date'],
                                 'method': primary['method'],
                                 'in_report_year': plan_year == capture['report_year'], 'explanations': entries})
    recorded = model.get('source_context')
    if (not isinstance(recorded, list)
            or any(not isinstance(row, dict) or not isinstance(row.get('source_row_key'), str)
                   or not isinstance(row.get('grbs'), str) for row in recorded)):
        return False
    def by_grbs(rows):
        grouped = {}
        for row in rows:
            grouped.setdefault(row['grbs'], []).append(row)
        return grouped
    # Each registered master belongs to one GRBS. Book order may change when
    # persisted, but row order, content, completeness and duplicates must match.
    if by_grbs(recorded) != by_grbs(expected):
        return False
    if model.get('contract', {}).get('context_presentation_contract') == 'relevant-context-v1':
        from .context_presentation import group_context
        # Acquisition follows registry order; persisted payloads sort source IDs.
        # Verify every row independently, then preserve the recorded display order.
        return model.get('source_context_groups') == group_context(recorded, year=capture['report_year'], as_of=capture['report_date'])
    return True
