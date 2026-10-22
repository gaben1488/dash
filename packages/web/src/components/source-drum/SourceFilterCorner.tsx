import { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, RotateCcw } from 'lucide-react';
import { useStore, PAGE_FILTERS, hasExplicitPeriodFilter, isWeekShifted } from '../../store';
import { SelectionTokens } from '../SelectionTokens';
import './source-corner.css';

/**
 * The twelve slots of the original source-shell filter corner, now derived
 * from the actual product store. Unsupported page filters do NOT light up.
 * The popover reuses SelectionTokens, preserving every existing axis action.
 */
export function SourceFilterCorner() {
  const {
    page, year, periodMode, activeMonths, monthsByYear, period, focusedWeekStart,
    selectedDepartments, selectedSubordinates, selectedMethods,
    selectedActivities, selectedBudgets, moneyUnit, stavkaMode, searchQuery,
    resetAllFilters,
  } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const applicable = PAGE_FILTERS[page] ?? [];
  const has = (key: string) => applicable.includes(key as never);
  const now = new Date();
  const yearActive = has('period') && year !== now.getFullYear();
  const periodActive = has('period') &&
    (hasExplicitPeriodFilter(periodMode, activeMonths, monthsByYear) || period !== 'year');
  const weekActive = has('period') && isWeekShifted(periodMode, focusedWeekStart, now);
  const definitions = [
    ['year','Год','когда',yearActive,has('period')],
    ['period','Месяцы и кварталы','когда',periodActive,has('period')],
    ['week','Неделя','когда',weekActive,has('period')],
    ['department','Управления','кто',has('department') && selectedDepartments.size>0,has('department')],
    ['organization','Подведомственные','кто',has('subordinate') && selectedSubordinates.size>0,has('subordinate')],
    ['category','Категория','кто',false,false],
    ['method','Способ закупки','что',has('procurement') && selectedMethods.size>0,has('procurement')],
    ['activity','Вид деятельности','что',has('activity') && selectedActivities.size>0,has('activity')],
    ['budget','Бюджет','что',has('budget') && selectedBudgets.size>0,has('budget')],
    ['rate','Ставка снижения','как',page!=='settings' && stavkaMode!=='norm',page!=='settings'],
    ['unit','Единицы','как',has('currency') && moneyUnit!=='тыс',has('currency')],
    ['search','Поиск','как',has('search') && !!searchQuery.trim(),has('search')],
  ] as const;
  const active = definitions.filter(d=>d[3]);
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key==='Escape') setOpen(false);
    };
    document.addEventListener('pointerdown',onClick);
    document.addEventListener('keydown',onKey);
    return () => {
      document.removeEventListener('pointerdown',onClick);
      document.removeEventListener('keydown',onKey);
    };
  }, [open]);
  return (
    <div className="dash-source-axis-corner" ref={ref}>
      <button className="dash-source-axis-toggle" type="button"
        onClick={()=>setOpen(v=>!v)} aria-expanded={open}
        title={active.length ? active.map(d=>d[1]).join(', ') : 'Условия отбора не изменены'}
        aria-label={active.length
          ? 'Показать текущие условия и режимы: '+active.map(d=>d[1]).join(', ')
          : 'Показать условия отбора. Сейчас все по умолчанию'}>
        <span className="dash-source-axis-grid" aria-hidden="true">
          {definitions.map(([key,label,family,isActive,available])=>
            <i key={key} data-axis={key} data-family={family}
              data-active={isActive?'true':'false'}
              data-supported={available?'true':'false'} title={label}/>)}
        </span>
        {active.length>0&&<span className="dash-source-axis-count" aria-hidden="true">{active.length}</span>}
        <ChevronsUpDown aria-hidden="true" size={11}/>
      </button>
      {open&&<div className="dash-source-axis-menu" role="group" aria-label="Отбор и режимы расчёта">
        <strong>Действующие условия</strong>
        {active.length===0
          ? <p>Все условия этой страницы — по умолчанию.</p>
          : <p>{active.length} изменённых условий. Снять конкретное можно на жетоне ниже.</p>}
        {active.length>0&&<SelectionTokens/>}
        {active.length>0&&<button type="button" className="dash-source-axis-clear"
          onClick={()=>{resetAllFilters();setOpen(false);}}>
          <RotateCcw size={12} aria-hidden="true"/> Сбросить всё
        </button>}
        <p className="dash-source-axis-note">Серые ячейки — оси, которые эта страница не поддерживает. Единицы и ставка — режимы расчёта, а не отбор строк.</p>
      </div>}
    </div>
  );
}
