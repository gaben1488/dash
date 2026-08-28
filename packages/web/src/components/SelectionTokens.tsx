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
 * его не было видно вовсе. Плюс режимы счёта: жетон единиц («млн») и жетон
 * живой ставки («живой N %») — они меняют числа так же, как отбор меняет
 * строки, и счётчик «Сбросить» их считает — угол обязан их называть.
 *
 * ГЕЙТ СТРАНИЦЕЙ (та же карта честности, что у барабанов шапки): ось, не
 * входящая в PAGE_FILTERS текущей вкладки, жетоном не показывается — жетон
 * обещал бы отбор, которого расчёт вкладки не ведёт (на Мониторинге угол
 * молчит о периоде, способе, поиске; управления показываются — п.127 их
 * применяет). Ставка гейтится как её барабан: везде, кроме «Системы».
 * Общий ✕ виден только при видимых жетонах.
 */
import { X } from 'lucide-react';
import {
  AVAILABLE_YEARS, MONTHS, PAGE_FILTERS, buildStavkaSumsLine, getProductMonday,
  hasExplicitPeriodFilter, isWeekShifted, useStore, type FilterGroup,
} from '../store';
import { getISOWeekNumber } from '../lib/week-number';
import { weekPosition } from '../lib/period-coverage';
import { fmtPct2 } from '../lib/report/mappers';
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
    page,
    year, setYear, periodMode, activeMonths, monthsByYear, period,
    focusedWeekStart, shiftFocusedWeek, clearAllPeriods,
    selectedMethods, clearMethods,
    selectedActivities, clearActivities,
    selectedBudgets, clearBudgets,
    selectedDepartments, selectAllDepartments,
    selectedSubordinates,
    searchQuery, setSearchQuery,
    moneyUnit, setMoneyUnit,
    stavkaMode, setStavkaMode, liveStavka,
    dashboardData, formatMoney,
    resetAllFilters,
  } = useStore();

  // Гейт страницей: та же карта осей, что у барабанов шапки (PAGE_FILTERS,
  // дом — store.ts). Ось не действует на вкладке — жетон о ней молчит.
  const axes = PAGE_FILTERS[page] ?? [];
  const has = (axis: FilterGroup) => axes.includes(axis);

  const now = new Date();
  // Понедельник — по продуктовому времени (Камчатка): тем же предикатом
  // считает isWeekShifted и, через него, счётчик кнопки «Сбросить».
  const currentMonday = getProductMonday(now);
  const defaultYear = AVAILABLE_YEARS.includes(now.getFullYear())
    ? now.getFullYear()
    : AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1];

  const tokens: Token[] = [];

  /* ── Срез недели. Только в week-режиме: в explicit барабан недель —
        чистая визуальная прокрутка (баг #13), жетон обещал бы срез,
        которого расчёт не ведёт. Предикат ЕДИНЫЙ со счётчиком
        (isWeekShifted) — жетон и счёт не смеют расходиться. ───────────── */
  if (has('period') && isWeekShifted(periodMode, focusedWeekStart, now)) {
    const weekNum = getISOWeekNumber(focusedWeekStart);
    const sunday = new Date(focusedWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    // Возврат — существующим действием: shiftFocusedWeek сам ведёт год за
    // неделей в week-режиме, отдельного сеттера не нужно.
    const deltaWeeks = Math.round(
      (currentMonday.getTime() - focusedWeekStart.getTime()) / WEEK_MS,
    );
    // Словарь барабана недель (weekWord): прошедшая — «срез», будущая —
    // «ещё не наступила». Будущую неделю жетон не смеет называть срезом:
    // среза ещё не существует.
    const pos = weekPosition(focusedWeekStart, now);
    const range = `${focusedWeekStart.getDate()}.${String(focusedWeekStart.getMonth() + 1).padStart(2, '0')}–${sunday.getDate()}.${String(sunday.getMonth() + 1).padStart(2, '0')}`;
    tokens.push({
      key: 'week',
      label: pos === 'future' ? `н${weekNum} · не наступила` : `срез н${weekNum}`,
      title: pos === 'future'
        ? `Неделя расчёта — ${weekNum}-я (${range}), ещё не наступила. Нажмите ✕ — вернуться к текущей неделе`
        : `Неделя расчёта — ${weekNum}-я (${range}), не текущая. Нажмите ✕ — вернуться к текущей неделе`,
      onRemove: () => shiftFocusedWeek(deltaWeeks),
    });
  }

  /* ── Даты. Умолчание — весь текущий год без явного периода. ────────── */
  const hasMonths = hasExplicitPeriodFilter(periodMode, activeMonths, monthsByYear);
  // Осиротевший квартал (канон п.134): `period` режет расчёт и без месяцев,
  // а приехать может адресом `?period=q2` — без жетона отбор был бы невидим.
  const hasQuarterOnly = period !== 'year' && !hasMonths;
  const yearShifted = year !== defaultYear;
  if (has('period') && (hasMonths || hasQuarterOnly || yearShifted)) {
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

  /* ── Организации: управления и подведы — одна ось, но гейт по частям:
        вкладка, применяющая только управления (Мониторинг, п.127), не смеет
        обещать жетоном отбор по подведам, которого её расчёт не ведёт. ── */
  const deptsShown = has('department') ? selectedDepartments : new Set<string>();
  const subsShown = has('subordinate') ? selectedSubordinates : new Set<string>();
  const orgCount = deptsShown.size + subsShown.size;
  if (orgCount > 0) {
    const names = [
      ...deptsShown,
      ...[...subsShown].map(subordinateLabel),
    ];
    tokens.push({
      key: 'orgs',
      label: `орг · ${orgCount}`,
      title: `Выбраны организации: ${names.join(', ')}. Нажмите ✕ — снять выбор организаций`,
      // selectAllDepartments снимает ось целиком: управления, подведы, deptOnly.
      onRemove: selectAllDepartments,
    });
  }

  /* ── Способ / вид / бюджет: пустое множество = «все» = молчание. ───── */
  if (has('procurement') && selectedMethods.size > 0) {
    const label = [...selectedMethods].map((m) => (m === 'competitive' ? 'КП' : 'ЕП')).join(', ');
    tokens.push({
      key: 'method',
      label,
      title: `Способ закупки сужен: ${label}. Нажмите ✕ — все способы`,
      onRemove: clearMethods,
    });
  }
  if (has('activity') && selectedActivities.size > 0) {
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
  if (has('budget') && selectedBudgets.size > 0) {
    const label = [...selectedBudgets].map((b) => b.toUpperCase()).join(', ');
    tokens.push({
      key: 'budget',
      label,
      title: `Источник финансирования сужен: ${label}. Нажмите ✕ — все бюджеты`,
      onRemove: clearBudgets,
    });
  }

  /* ── Единицы измерения: режим счёта, как ставка. Умолчание — тысячи;
        «млн» меняет каждое число экрана и считается счётчиком «Сбросить» —
        молчащий об этом угол расходился бы со счётом. ─────────────────── */
  if (has('currency') && moneyUnit !== 'тыс') {
    const unitWord = moneyUnit === 'млн' ? 'миллионах' : 'миллиардах';
    tokens.push({
      key: 'unit',
      label: moneyUnit,
      title: `Суммы показываются в ${unitWord} рублей (умолчание — тысячи). Нажмите ✕ — вернуть тысячи`,
      onRemove: () => setMoneyUnit('тыс'),
    });
  }

  /* ── Живая ставка: режим счёта переведён с норматива 8 % на живой
        коэффициент. Счётчик «Сбросить» это изменение считает (stavkaChanged)
        — угол обязан его называть, иначе счёт обещает отбор, которого не
        видно. Гейт — как у барабана ставки: везде, кроме «Системы». ───── */
  if (page !== 'settings' && stavkaMode === 'live') {
    const planTys = (dashboardData?.departmentSummaries ?? [])
      .reduce((acc, d) => acc + (d.planTotal ?? 0), 0);
    // Паспорт разницы в рублях — общий строитель с барабаном ставки.
    const sumsLine = buildStavkaSumsLine(planTys, liveStavka?.pct ?? null, formatMoney);
    tokens.push({
      key: 'stavka',
      label: liveStavka ? `живой ${fmtPct2(liveStavka.pct)} %` : 'живой',
      title: `Ставка счёта переведена с норматива 8 % на живой коэффициент. ${sumsLine} Нажмите ✕ — вернуть норматив 8 %`,
      onRemove: () => setStavkaMode('norm'),
    });
  }

  /* ── Поиск: режет таблицы наравне с фильтрами, а поле на узком экране
        уезжает — жетон обязан назвать отбор (умение строчных чипов). ── */
  if (has('search') && searchQuery.trim() !== '') {
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
