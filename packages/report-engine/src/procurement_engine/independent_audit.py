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
    result={k:{s:{'plan_count':0,'fact_count':0,'remain_count':0,
        **{n:Fraction(0) for n in ('plan_amount','fact_amount','remain_amount','monetary_fact_amount','confirmed_saving_amount')}}
        for s in ('year','quarter')} for k in ('competitive','single_supplier')}
    population={k:{s:[] for s in ('year','quarter')} for k in result}
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
            for scope in ['year']+(['quarter'] if plan_q==q else []):
                b=result[kind][scope];population[kind][scope].append(locator)
                b['plan_count']+=1;b['plan_amount']+=plan
                if is_fact:b['fact_count']+=1;b['fact_amount']+=fact
                else:b['remain_count']+=1;b['remain_amount']+=plan
                if not fact_date or is_fact:b['monetary_fact_amount']+=fact
                if is_fact and text(cell(29)).casefold()=='да':
                    b['confirmed_saving_amount']+=sum((number(cell(i)) for i in (25,26,27)),Fraction(0))
    for groups in result.values():
        for b in groups.values():
            b['deviation_amount']=b['monetary_fact_amount']-b['plan_amount']
    return result,population,events,event_amount

def audit_model(capture,model):
    expected,populations,events,event_amount=recount(capture)
    failures=[];checks=0
    def check(path,got,want):
        nonlocal checks
        checks+=1
        if got!=want:failures.append({'path':path,'observed':str(got),'expected':str(want)})
    for kind,scopes in expected.items():
        for scope,block in scopes.items():
            actual=model['exact_metrics'][kind][scope]
            for field,want in block.items():
                got=actual.get(field) if field.endswith('_count') else Fraction(actual['exact_decimal'][field])
                check(f'{kind}.{scope}.{field}',got,want)
                if field in model['headline'][kind][scope]:
                    # IEEE-754 values are only a compatibility/display boundary.
                    h=model['headline'][kind][scope][field]
                    check(f'headline.{kind}.{scope}.{field}',h,float(want) if isinstance(want,Fraction) else want)
            check(f'{kind}.{scope}.population',sorted(actual['contributors']),sorted(populations[kind][scope]))
    check('calendar_fact.population',sorted(model['calendar_fact']['contributors']),sorted(events))
    check('calendar_fact.amount',Fraction(model['calendar_fact']['amount_thousand_decimal']),event_amount)
    return {'pass':not failures,'implementation':'raw-cells Fraction recount v1.4',
            'scope':'master recorded facts; no procedure overlay','checks':checks,'failures':failures}
