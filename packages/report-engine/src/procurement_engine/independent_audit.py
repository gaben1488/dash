"""Separate raw-cell recount using Fraction, with no production parser/aggregator imports.

This checks the approved master-recorded-fact scope, not procedure overlays or
unrecorded contracts. Counts, amounts, populations and event periods are compared.
"""
import re
import unicodedata
from datetime import date, datetime, timedelta
from fractions import Fraction


def text(v):
    return ' '.join(unicodedata.normalize('NFKC',str(v if v is not None else '')).split())

def day(v):
    if isinstance(v,bool):return None
    if isinstance(v,(int,float)) and 1<=v<=200000:
        return (date(1899,12,30)+timedelta(days=v)).isoformat()
    for fmt in ('%d.%m.%Y','%Y-%m-%d','%d.%m.%y'):
        try:return datetime.strptime(text(v),fmt).date().isoformat()  # noqa: DTZ007 — civil report date, not an instant.
        except ValueError:pass
    return None

def number(v):
    if v is None or not text(v):return Fraction(0)
    return Fraction(text(v).replace(' ','').replace(',','.'))

def method(v):
    t=text(v).upper().replace('E','Е').replace('Ё','Е');compact=re.sub('[^А-ЯA-Z0-9]','',t)
    if compact=='ЕП' or 'ЕДИНСТВ' in t:return 'single_supplier'
    if compact in {'ЭА','ЭК','ЭЗК','ЭП','ЭАС'} or any(s in t for s in ('АУКЦ','КОНКУР','ЗАПРОС КОТИРОВОК')):return 'competitive'
    return None

def recount(capture):
    as_of=day(capture['report_date']);year=capture['report_year'];q=(int(as_of[5:7])-1)//3+1
    def empty():
        return {'plan_count':0,'fact_count':0,'remain_count':0,
            **{n:Fraction(0) for n in ('plan_amount','fact_amount','remain_amount',
                'monetary_fact_amount','confirmed_saving_amount','partial_fact_without_completion_amount',
                *(prefix+'_'+budget+'_amount' for prefix in ('plan','fact','remain') for budget in ('fb','kb','mb')))}}
    periods=('year','q1','q2','q3','q4')
    kinds=('competitive','single_supplier')
    result={k:{s:empty() for s in periods} for k in kinds}
    grouped={source['grbs']:{k:{s:empty() for s in periods} for k in kinds}
             for source in capture['sources'] if source['role']=='master'}
    population={k:{s:[] for s in periods} for k in result}
    events=[];event_amount=Fraction(0)
    for source in capture['sources']:
        if source['role']!='master':continue
        for rowno,raw in enumerate(source['values'][3:],4):
            cell=lambda i, raw=raw:raw[i] if i<len(raw) else None
            kind=method(cell(11));plan_date=day(cell(13));fact_date=day(cell(16))
            try:plan_year=int(float(text(cell(15)).replace(',','.')))
            except (ValueError,OverflowError):continue
            if not(text(cell(5)) and text(cell(6)) and kind and plan_date):continue
            label=text(cell(0));label=re.sub(r'^(\d+)\.0$',r'\1',label)
            if not label:label=f"__ROW__::{source['provider_id']}::{source['sheet']}::{rowno}"
            locator=f"{source['provider_id']}::{source['sheet']}::{rowno}::{label}"
            is_fact=bool(fact_date and fact_date<=as_of)
            plan=sum((number(cell(i)) for i in (7,8,9)),Fraction(0))
            fact=sum((number(cell(i)) for i in (21,22,23)),Fraction(0))
            if is_fact and int(fact_date[:4])==year and (int(fact_date[5:7])-1)//3+1==q:
                events.append(locator);event_amount+=fact
            if plan_year!=year:continue
            try:plan_q=int(float(text(cell(14)).replace(',','.')))
            except ValueError:plan_q=None
            for scope in ['year']+([f'q{plan_q}'] if plan_q in (1,2,3,4) else []):
                population[kind][scope].append(locator)
                for b in (result[kind][scope],grouped[source['grbs']][kind][scope]):
                    b['plan_count']+=1;b['plan_amount']+=plan
                    if is_fact:b['fact_count']+=1;b['fact_amount']+=fact
                    else:b['remain_count']+=1;b['remain_amount']+=plan
                    if not fact_date or is_fact:b['monetary_fact_amount']+=fact
                    if not fact_date and fact>0:b['partial_fact_without_completion_amount']+=fact
                    if is_fact and text(cell(29)).casefold()=='да':
                        b['confirmed_saving_amount']+=sum((number(cell(i)) for i in (25,26,27)),Fraction(0))
                    for budget, plan_column, fact_column in [('fb',7,21),('kb',8,22),('mb',9,23)]:
                        b['plan_'+budget+'_amount'] += number(cell(plan_column))
                        b[('fact_' if is_fact else 'remain_')+budget+'_amount'] += number(cell(fact_column if is_fact else plan_column))
    for groups in [*result.values(),*(scopes for grbs in grouped.values() for scopes in grbs.values())]:
        for b in groups.values():
            b['deviation_amount']=b['monetary_fact_amount']-b['plan_amount']
            b['execution_pct']=Fraction(100*b['fact_count'],b['plan_count']) if b['plan_count'] else None
            b['contracted_share_pct']=100*b['monetary_fact_amount']/b['plan_amount'] if b['plan_amount'] else None
    for kind in kinds:
        result[kind]['quarter']=result[kind][f'q{q}']
        population[kind]['quarter']=population[kind][f'q{q}']
    return result,population,events,event_amount,grouped

def audit_model(capture,model):
    expected,populations,events,event_amount,grouped=recount(capture)
    failures=[];checks=0
    def check(path,got,want):
        nonlocal checks
        checks+=1
        if got!=want:failures.append({'path':path,'observed':str(got),'expected':str(want)})
    def decimal_check(path,got,want,*,ratio=False):
        if want is None:
            check(path,got,None)
            return
        try:
            parsed=Fraction(got) if isinstance(got,str) else None
        except (ValueError,ZeroDivisionError):
            parsed=None
        # Money is exact. A repeating percentage is serialized at Decimal's
        # 28-digit precision; allow only its bounded decimal rounding residual.
        if ratio and parsed is not None:
            check(path,abs(parsed-want)<=max(abs(want),Fraction(1))*Fraction(1,10**26),True)
        else:
            check(path,parsed,want)
    def display_check(path,actual,block,fields):
        for field in fields:
            want=block[field]
            check(path+'.'+field,actual.get(field),float(want) if isinstance(want,Fraction) else want)
    display_fields=('plan_count','fact_count','remain_count','plan_amount','fact_amount','remain_amount','execution_pct')
    content=model.get('report_content') or {}
    check('report_content.version',content.get('version'),'business-sections-v1')
    check('report_content.by_grbs.coverage',set(content.get('by_grbs') or {}),set(grouped))
    def content_check(path,actual,block):
        for field,want in block.items():
            display_check(path,actual,block,(field,))
            if not field.endswith('_count') and field!='execution_pct':
                decimal_check(path+'.exact_decimal.'+field,(actual.get('exact_decimal') or {}).get(field),
                              want,ratio=field=='contracted_share_pct')
    check('grbs_metrics.coverage',set(model.get('grbs_metrics') or {}),set(grouped))
    check('grbs_order.coverage',sorted(model.get('grbs_order') or []),sorted(grouped))
    for grbs,kinds in grouped.items():
        for kind,scopes in kinds.items():
            legacy='comp' if kind=='competitive' else 'ep'
            for scope,block in scopes.items():
                actual=((model.get('grbs_metrics',{}).get(grbs) or {}).get(legacy) or {}).get(scope) or {}
                display_check(f'grbs_metrics.{grbs}.{legacy}.{scope}',actual,block,display_fields)
                section=(((content.get('by_grbs') or {}).get(grbs) or {}).get(legacy) or {}).get(scope) or {}
                content_check(f'report_content.by_grbs.{grbs}.{legacy}.{scope}',section,block)
    for kind,scopes in expected.items():
        legacy='comp' if kind=='competitive' else 'ep'
        for scope,block in scopes.items():
            if scope!='quarter':
                actual=((model.get('global_quarters') or {}).get(legacy) or {}).get(scope) or {}
                display_check(f'global_quarters.{legacy}.{scope}',actual,block,display_fields)
                section=((content.get('global') or {}).get(legacy) or {}).get(scope) or {}
                content_check(f'report_content.global.{legacy}.{scope}',section,block)
            if scope not in {'year','quarter'}:
                continue
            actual=((model.get('exact_metrics') or {}).get(kind) or {}).get(scope) or {}
            for field,want in block.items():
                display_check(f'exact_metrics.{kind}.{scope}',actual,block,(field,))
                if not field.endswith('_count') and field!='execution_pct':
                    decimal_check(f'exact_metrics.{kind}.{scope}.exact_decimal.{field}',
                        (actual.get('exact_decimal') or {}).get(field),want,ratio=field=='contracted_share_pct')
            headline=((model.get('headline') or {}).get(kind) or {}).get(scope) or {}
            display_check(f'headline.{kind}.{scope}',headline,block,display_fields)
            check(f'{kind}.{scope}.population',sorted(actual.get('contributors') or []),sorted(populations[kind][scope]))
    calendar=model.get('calendar_fact') or {}
    check('calendar_fact.population',sorted(calendar.get('contributors') or []),sorted(events))
    check('calendar_fact.recorded_position_count',calendar.get('recorded_position_count'),len(events))
    check('calendar_fact.amount_thousand',calendar.get('amount_thousand'),float(event_amount))
    decimal_check('calendar_fact.amount_thousand_decimal',calendar.get('amount_thousand_decimal'),event_amount)
    return {'pass':not failures,'implementation':'raw-cells Fraction recount v1.5',
            'scope':'master recorded facts; no procedure overlay','checks':checks,'failures':failures}
