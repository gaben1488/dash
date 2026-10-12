import { aggregateNodeTotals } from '../lib/selectors/totals-aggregation';
import { countNodeIssues } from '../lib/selectors/issues-filtering';
import { subordinateNameMatchKey } from '@aemr/shared';
// @vitest-environment jsdom
/**
 * Характеризационный замок ПЕРЕД упрощением W1 (SIMPLIFY_REGISTER_2026-06-05):
 * строка рейтинга рисовалась без memo, а три обработчика создавались заново
 * на каждый проход таблицы, поэтому memo и не дал бы ничего. Правка меняет
 * форму обработчиков (управление узнаётся по переданному коду), и поведение
 * таблицы обязано остаться прежним: раскрытие и складывание строки, переход
 * к управлению по щелчку, переход к реестру строк из раскрытой карточки.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RatingTableV2, type DeptRowV2 } from './RatingTableV2';
import { TooltipProvider } from './ui/tooltip';

const DEPTS: DeptRowV2[] = [
  {
    id: 'УО',
    name: 'Управление образования',
    nameShort: 'УО',
    execAmountPct: 0.8,
    execCountPct: 0.75,
    trustScore: 90,
    issueCount: 3,
    criticalIssueCount: 1,
    subordinates: [
      { name: 'Аппарат управления', execAmountPct: 0.8, execCountPct: 0.75, issueCount: 1, isSelf: true },
      { name: 'Школа №1', execAmountPct: 0.5, execCountPct: 0.5, issueCount: null },
    ],
  },
  {
    id: 'УЭР',
    name: 'Управление экономического развития',
    nameShort: 'УЭР',
    execAmountPct: 0.6,
    execCountPct: 0.5,
    trustScore: 70,
    issueCount: 5,
    criticalIssueCount: 0,
  },
];

function renderTable() {
  const onDeptClick = vi.fn();
  const onDeptDetail = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <RatingTableV2
        departments={DEPTS}
        showSubordinates
        onDeptClick={onDeptClick}
        onDeptDetail={onDeptDetail}
      />
    </TooltipProvider>,
  );
  return { onDeptClick, onDeptDetail };
}

/** Кнопка раскрытия строки живёт в ячейке наименования и подписана коротким именем. */
function expandButton(nameShort: string): HTMLElement {
  const found = screen.getAllByRole('button').find(b => b.textContent?.includes(nameShort));
  if (!found) throw new Error(`Кнопка раскрытия «${nameShort}» не найдена`);
  return found;
}

afterEach(() => cleanup());

describe('W1 — строка рейтинга: раскрытие и переходы', () => {
  it('щелчок по управлению раскрывает строку и сообщает код управления', () => {
    const { onDeptClick } = renderTable();
    fireEvent.click(expandButton('УО'));
    expect(onDeptClick).toHaveBeenCalledWith('УО');
    expect(screen.getByText('Школа №1')).toBeTruthy();
  });

  it('повторный щелчок складывает ту же строку', () => {
    renderTable();
    fireEvent.click(expandButton('УО'));
    expect(screen.queryByText('Школа №1')).toBeTruthy();
    fireEvent.click(expandButton('УО'));
    expect(screen.queryByText('Школа №1')).toBeNull();
  });

  it('раскрытие второй строки закрывает первую: раскрыта всегда одна', () => {
    renderTable();
    fireEvent.click(expandButton('УО'));
    fireEvent.click(expandButton('УЭР'));
    expect(screen.queryByText('Школа №1')).toBeNull();
  });

  it('из раскрытой карточки открывается реестр строк того же управления', () => {
    const { onDeptDetail } = renderTable();
    fireEvent.click(expandButton('УЭР'));
    fireEvent.click(screen.getByText('Открыть реестр строк'));
    expect(onDeptDetail).toHaveBeenCalledWith('УЭР');
  });
});


it('renders annual source-quarter execution and attributed remarks rather than zero and dash',()=>{
 const quarters=Object.fromEntries(['q1','q2','q3','q4'].map(k=>[k,{planCount:10,factCount:8,planTotal:100,factTotal:80}]));
 const n=aggregateNodeTotals({quarters,competitiveCount:20,epCount:20},
  {periodKey:'year',coveredQuarters:[],fullQuarters:[],partialMonths:[],useMonthLevel:false,hasActiveMonths:false},
  {showKP:true,showEP:true,activeMonths:new Set(),hasMonthData:false});
 const counts=countNodeIssues([{departmentId:'uo',subordinateId:'Школа №1',severity:'warning'},{departmentId:'uo',severity:'warning'}],'uo');
 render(<TooltipProvider><RatingTableV2 departments={[{...DEPTS[0],subordinates:[{
  name:'Школа №1',execCountPct:n.factCount/n.planCount*100,execAmountPct:n.factTotal/n.planTotal*100,
  issueCount:counts.subordinates.get(subordinateNameMatchKey('Школа №1'))??0,unattributedIssueCount:counts.unattributed,
 }]}]} showSubordinates onDeptClick={vi.fn()} onDeptDetail={vi.fn()}/></TooltipProvider>);
 fireEvent.click(expandButton('УО'));
 expect(screen.getAllByText('80,0 %').length).toBe(2);
 expect(screen.getByTitle(/Активных замечаний с привязкой к этой организации: 1.*Ещё 1/).textContent).toBe('1');
});
