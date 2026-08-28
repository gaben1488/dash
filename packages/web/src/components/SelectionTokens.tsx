/**
 * Состояние отбора — жетоны в правом углу шапки (контракт пробы, раздел «угол»).
 *
 * ПРАВИЛА КОНТРАКТА.
 *   • Жетоны СЧИТАЮТСЯ из хранилища, а не рисуются: срез недели (выбранная
 *     неделя ≠ текущая), даты ≠ умолчание (умолчание — весь текущий год),
 *     организации ≠ все, способ/вид/бюджет ≠ все, поиск.
 *   • Каждый жетон — кремовая пилюля продукта (канон vf-btn-active: отбор и
 *     есть включённый фильтр) с ✕, снимающим ровно свою ось СУЩЕСТВУЮЩИМИ
 *     действиями хранилища.
 *   • Общий ✕ возвращает умолчание целиком (resetAllFilters).
 *   • На умолчании предмет МОЛЧИТ: ничего не рендерится — ни рамки, ни нуля.
 *   • Подпись жетона дат точная: «2026», «2026·3 мес», «2025+2026».
 *
 * ПЕРЕНОС УМЕНИЙ. Компонент заменяет FilterBreadcrumb variant="inline" в шапке
 * (панельный variant="panel" на Пульте живёт как жил). Перенесено всё, что
 * умели строчные чипы: организации (selectAllDepartments), подведы
 * (clearSubordinates), месяцы и осиротевший квартал (clearAllPeriods, канон
 * п.134), способ (clearMethods), вид (clearActivities, канон п.30 — легаси-ключ
 * current_program подписывается как ТД без дубля), бюджет (clearBudgets),
 * поиск (setSearchQuery('')), молчание при пустом отборе. Сверх того — жетон
 * среза недели и жетон года: год ≠ текущий — тоже отбор, у строчных чипов
 * его не было видно вовсе.
 */
import { X } from 'lucide-react';
import {
  AVAILABLE_YEARS, MONTHS, getMondayOfWeek, hasExplicitPeriodFilter, useStore,
} from '../store';
import { getISOWeekNumber } from '../lib/week-number';
import { subordinateLabel } from '../lib/subordinate-label';

/** Подписи кварталов — в стиле подписи дат («2026·2 кв»). */
const QUARTER_SHORT: Record<string, string> = {
  q1: '1 кв', q2: '2 кв', q3: '3 кв', q4: '4 кв',
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface Token {
  key: string;
  label: string;
  title: string;
  onRemove: () => void;
}

export function SelectionTokens() {
  const {
    year, setYear, periodMode, activeMonths, monthsByYear, period,
    focusedWeekStart, shiftFocusedWeek, clearAllPeriods,
    selectedMethods, clearMethods,
    selectedActivities, clearActivities,
    selectedBudgets, clearBudgets,
    selectedDepartments, selectAllDepartments,
    selectedSubordinates, clearSubordinates,
    searchQuery, setSearchQuery,
    resetAllFilters,
  } = useStore();

  const now = new Date();
  const currentMonday = getMondayOfWeek(now);
  const defaultYear = AVAILABLE_YEARS.includes(now.getFullYear())
    ? now.getFullYear()
    : AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1];

  const tokens: Token[] = [];

  /* ── Срез недели. Только в week-режиме: в explicit барабан недель —
        чистая визуальная прокрутка (баг #13), жетон обещал бы срез,
        которого расчёт не ведёт. ─────────────────────────────────────── */
  if (periodMode === 'week' && focusedWeekStart.getTime() !== currentMonday.getTime()) {
    const weekNum = getISOWeekNumber(focusedWeekStart);
    const sunday = new Date(focusedWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    // Возврат — существующим действием: shiftFocusedWeek сам ведёт год за
    // неделей в week-режиме, отдельного сеттера не нужно.
    const deltaWeeks = Math.round(
      (currentMonday.getTime() - focusedWeekStart.getTime()) / WEEK_MS,
    );
    tokens.push({
      key: 'week',
      label: `срез н${weekNum}`,
      title: `Неделя расчёта — ${weekNum}-я (${focusedWeekStart.getDate()}.${String(focusedWeekStart.getMonth() + 1).padStart(2, '0')}–${sunday.getDate()}.${String(sunday.getMonth() + 1).padStart(2, '0')}), не текущая. Нажмите ✕ — вернуться к текущей неделе`,
      onRemove: () => shiftFocusedWeek(deltaWeeks),
    });
  }

  /* ── Даты. Умолчание — весь текущий год без явного периода. ────────── */
  const hasMonths = hasExplicitPeriodFilter(periodMode, activeMonths, monthsByYear);
  // Осиротевший квартал (канон п.134): `period` режет расчёт и без месяцев,
  // а приехать может адресом `?period=q2` — без жетона отбор был бы невидим.
  const hasQuarterOnly = period !== 'year' && !hasMonths;
  const yearShifted = year !== defaultYear;
  if (hasMonths || hasQuarterOnly || yearShifted) {
    let label: string;
    let detail: string;
    const entries = Object.entries(monthsByYear)
      .filter(([, months]) => months.size > 0)
      .sort(([a], [b]) => Number(a) - Number(b));
    if (entries.length > 0) {
      // Точная подпись контракта: полный год — «2026», частичный — «2026·3 мес»,
      // несколько лет — «2025+2026».
      label = entries
        .map(([yr, months]) => (months.size === 12 ? yr : `${yr}·${months.size} мес`))
        .join('+');
      detail = entries
        .map(([yr, months]) => `${yr}: ${[...months].sort((a, b) => a - b)
          .map((m) => MONTHS[m - 1]?.short ?? String(m)).join(', ')}`)
        .join('; ');
    } else if (hasMonths) {
      // Легаси-писатель положил месяцы только в activeMonths (toggleMonth) —
      // барабан о них не знает, но отбор действует и обязан быть назван.
      const yr = typeof year === 'number' ? year : now.getFullYear();
      label = activeMonths.size === 12 ? String(yr) : `${yr}·${activeMonths.size} мес`;
      detail = [...activeMonths].sort((a, b) => a - b)
        .map((m) => MONTHS[m - 1]?.short ?? String(m)).join(', ');
    } else if (hasQuarterOnly) {
      const yr = typeof year === 'number' ? year : now.getFullYear();
      label = `${yr}·${QUARTER_SHORT[period] ?? period}`;
      detail = `квартал без месяцев (${QUARTER_SHORT[period] ?? period})`;
    } else {
      label = year === 'all' ? 'все годы' : String(year);
      detail = year === 'all' ? 'данные всех лет' : `данные ${year} года целиком`;
    }
    tokens.push({
      key: 'dates',
      label,
      title: `Даты отличаются от умолчания «весь ${defaultYear}»: ${detail}. Нажмите ✕ — вернуть весь ${defaultYear} год`,
      onRemove: () => {
        // Ось дат целиком: период — существующей точкой clearAllPeriods
        // (п.134: она гасит и осиротевший квартал), год — setYear.
        clearAllPeriods();
        if (useStore.getState().year !== defaultYear) setYear(defaultYear);
      },
    });
  }

  /* ── Организации: управления и подведы — одна ось. ─────────────────── */
  const orgCount = selectedDepartments.size + selectedSubordinates.size;
  if (orgCount > 0) {
    const names = [
      ...selectedDepartments,
      ...[...selectedSubordinates].map(subordinateLabel),
    ];
    tokens.push({
      key: 'orgs',
      label: `орг · ${orgCount}`,
      title: `Выбраны организации: ${names.join(', ')}. Нажмите ✕ — снять выбор организаций`,
      onRemove: () => {
        // selectAllDepartments при непустом выборе снимает и подведы разом;
        // если выбраны только подведы — чистим их напрямую (иначе
        // selectAllDepartments ВЫБРАЛ бы все управления).
        if (selectedDepartments.size > 0) selectAllDepartments();
        else clearSubordinates();
      },
    });
  }

  /* ── Способ / вид / бюджет: пустое множество = «все» = молчание. ───── */
  if (selectedMethods.size > 0) {
    const label = [...selectedMethods].map((m) => (m === 'competitive' ? 'КП' : 'ЕП')).join(', ');
    tokens.push({
      key: 'method',
      label,
      title: `Способ закупки сужен: ${label}. Нажмите ✕ — все способы`,
      onRemove: clearMethods,
    });
  }
  if (selectedActivities.size > 0) {
    // Канон п.30: подписи две — ПМ и ТД; легаси-ключ current_program («ТД-ПМ»)
    // подписывается как ТД, дубль «ТД, ТД» схлопывается.
    const label = [...new Set([...selectedActivities]
      .map((a) => (a === 'program' ? 'ПМ' : 'ТД')))].join(', ');
    tokens.push({
      key: 'activity',
      label,
      title: `Вид деятельности сужен: ${label}. Нажмите ✕ — оба вида`,
      onRemove: clearActivities,
    });
  }
  if (selectedBudgets.size > 0) {
    const label = [...selectedBudgets].map((b) => b.toUpperCase()).join(', ');
    tokens.push({
      key: 'budget',
      label,
      title: `Источник финансирования сужен: ${label}. Нажмите ✕ — все бюджеты`,
      onRemove: clearBudgets,
    });
  }

  /* ── Поиск: режет таблицы наравне с фильтрами, а поле на узком экране
        уезжает — жетон обязан назвать отбор (умение строчных чипов). ── */
  if (searchQuery.trim() !== '') {
    tokens.push({
      key: 'search',
      label: `поиск: ${searchQuery.trim()}`,
      title: `Строки сужены поиском «${searchQuery.trim()}». Нажмите ✕ — очистить поиск`,
      onRemove: () => setSearchQuery(''),
    });
  }

  // Молчание на умолчании: ни пустой рамки, ни нуля.
  if (tokens.length === 0) return null;

  return (
    <div className="sel-tokens" role="group" aria-label="Отбор отличается от умолчания">
      {tokens.map((t) => (
        <button
          key={t.key}
          type="button"
          className="sel-chip vf-btn-active"
          title={t.title}
          aria-label={t.title}
          onClick={t.onRemove}
        >
          <span className="sel-chip-label">{t.label}</span>
          <X size={8} strokeWidth={3} className="sel-chip-x" aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        className="sel-clear"
        title="Снять весь отбор — вернуть умолчание: весь текущий год, все организации, прямой эфир"
        aria-label="Снять весь отбор и вернуть умолчание"
        onClick={resetAllFilters}
      >
        <X size={10} aria-hidden="true" />
      </button>
    </div>
  );
}
