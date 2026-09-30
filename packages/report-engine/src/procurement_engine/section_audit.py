"""Check rendered section populations against frozen cells and canonical records."""
import re
from collections import defaultdict
from dataclasses import replace
from fractions import Fraction

from .independent_audit import day, method, number, text
from .normalize import normalize_procedure_code
from .procedures import (
    normalize_procedure_values,
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
                'status_evidence':r.get('status_evidence') or ''})
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
        for rn,row in enumerate(source['values'][3:],4):
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
    quarter=(int(day(model['snapshot']['report_date'])[5:7])-1)//3+1
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
        for rowno, raw in enumerate(source['values'][3:], 4):
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
    if 'report_content' in model:
        actual = _normalized_remaining((model['report_content'] or {}).get('remaining') or {})
        if actual != _remaining_population(capture):
            errors.append('remaining_population')
    if ledger is not None:
        # Replay text and observations from frozen inputs, rather than accepting
        # mutually consistent but invented human-readable claims in projections.
        from .adapters import normalize_master_values
        from .raw_pipeline import review_recommendations

        sid=model['snapshot']['snapshot_id'];rows=[]
        for source in capture['sources']:
            if source.get('role')=='master':
                rows.extend(normalize_master_values(source['values'],snapshot_id=sid,expected_grbs=source['grbs'],
                    data_start_row=3,source_id=source['provider_id'],sheet_name=source['sheet']))
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
        expected={r['recommendation_id']:r for r in review_recommendations(ledger,rows,sid,model['snapshot']['report_date'], documents=documents, identity_evidence=identity_evidence, legacy=not model.get('contract', {}).get('recommendation_link_contract'))}
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
    active=[];closed=[];closed_block=False
    for rn,row in enumerate(queue['values'],1):
        c=lambda i,row=row:row[i] if i<len(row) else None
        if text(c(0)).casefold()=='данные по закрытым строкам':closed_block=True;continue
        code=normalize_procedure_code(c(3))
        if not code:continue
        item={'procedure_code':code,'stage':c(8),'subject':c(6),'action':c(2),
              'source_ref':f"{queue['provider_id']}::{queue['sheet']}::{rn}"}
        if closed_block:
            item.update(raw_cells=row,classification='closed_procedure_data_quality');closed.append(item)
        else:
            item['deadline']=day(c(0)) or c(0);active.append(item)
    expected={'procedures':active,'closed_procedure_quality':closed,'active_procedures_count':len(active)}
    for key,want in expected.items():
        if model.get(key)!=want:errors.append(key)
    mgmt=model.get('management_summary') or {}
    for key,want in [('procedure_rows',active),('procedure_count',len(active))]:
        if mgmt.get(key)!=want:errors.append('management_summary.'+key)
    return errors
