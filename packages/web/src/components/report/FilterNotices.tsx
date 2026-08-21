/**
 * Плашки о фильтрах — общий дом зоны «Отчёт + Свод».
 *
 * Дословное требование владельца (канон п.58б): фильтр шапки, которому числа
 * НЕ подчиняются, объявляется словами, а не замалчивается. До 21.08 плашки
 * жили только на «Своде» (локальная `Notice` внутри `SvodView.tsx`), а
 * «Отчёт» молчал сразу о пяти осях: управления, подведомственные, способ,
 * бюджет, поиск. Читатель видел крошку фильтра в шапке и вправе был считать,
 * что числа под ней уже сужены — это и есть дефект P0-1 карты вкладки
 * (`docs/superpowers/audits/2026-08-20-cards-map/otchet-svod.md`).
 *
 * Один сигнал — один дом (канон п.112): плашка здесь ровно одна на обе
 * вкладки. Второй экземпляр `Notice` на соседнем экране означал бы две
 * редакции одной фразы и два разных тона у одного смысла.
 *
 * Обводок нет (канон п.129): плашку от карточки отделяет заливка, а не край.
 */
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Info } from 'lucide-react';
import type { FilterContext } from '../../lib/filter-context';
import { buildDrill, type DrillFilters } from '../../lib/drill';

/** Строка-пояснение под осями: что именно сейчас с числами делает фильтр. */
export function Notice({ tone, children }: { tone: 'info' | 'muted'; children: ReactNode }) {
  return (
    <p
      className={clsx(
        // Рамки нет (канон п.129): плашку от карточки отделяет тон заливки.
        'mt-3 flex items-start gap-2 text-[11px] leading-snug rounded-lg px-3 py-2',
        tone === 'info'
          ? 'text-blue-700 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-950/30'
          : 'text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900/40',
      )}
    >
      <Info size={13} className="mt-px flex-shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Единое фокус-кольцо плашек — клавиатурный обход виден на каждой ссылке. */
const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900';

/**
 * Дверь в строки-основания с сохранением периметра. Цель собирает
 * `buildDrill` (механизм М14), а не место клика: правила переноса осей в
 * Реестр живут в одном доме, и подпись «что откроется и чего в цели не
 * будет» приходит оттуда же, а не сочиняется здесь заново.
 */
export function RowsLink({ ctx, label, onNavigate }: {
  ctx: FilterContext;
  label: string;
  onNavigate: (filters: DrillFilters) => void;
}) {
  const target = buildDrill(
    {
      ...(ctx.grbs.length === 1 ? { dept: ctx.grbs[0] } : {}),
      ...(ctx.subordinates.length === 1 ? { subordinate: ctx.subordinates[0] } : {}),
      ...(ctx.year !== 'all' ? { year: ctx.year } : {}),
      ...(ctx.period !== 'year' ? { quarter: Number(ctx.period.slice(1)) } : {}),
      ...(ctx.methods.length === 1 ? { method: ctx.methods[0]! } : {}),
      ...(ctx.budgets.length === 1 ? { budget: ctx.budgets[0]! } : {}),
      ...(ctx.activities.length === 1 ? { activity: ctx.activities[0]! } : {}),
      ...(ctx.search !== '' ? { search: ctx.search } : {}),
    },
    'data',
  );
  const hint = target.warning === '' ? target.summary : `${target.summary} ${target.warning}`;
  return (
    <button
      type="button"
      onClick={() => onNavigate(target.filters)}
      title={hint}
      className={clsx('font-medium text-cyan-700 dark:text-cyan-300 hover:underline', FOCUS_RING)}
    >
      {label}
    </button>
  );
}

/** Короткое имя вида деятельности для фразы плашки. */
const ACTIVITY_PHRASE: Readonly<Record<string, string>> = {
  program: 'программные',
  current_program: 'текущие программные',
  current_non_program: 'текущие непрограммные',
};

/** Короткое имя бюджета для фразы плашки. */
const BUDGET_PHRASE: Readonly<Record<string, string>> = {
  fb: 'федеральный',
  kb: 'краевой',
  mb: 'местный',
};

/**
 * Плашки «Отчёта» о фильтрах шапки, которые эта страница не применяет.
 *
 * Почему отчёт их не применяет — решение владельца 03.08: отчёт остаётся
 * ПОЛНЫМ документом по всем восьми ГРБС, как бумага, которую он каждую
 * неделю подписывает. Фильтр секции не режет; вместо фильтра — навигация
 * шапкой. Это решение и делает плашки обязательными: раз фильтр виден в
 * шапке, но к числам не применён, продукт обязан сказать об этом словами.
 *
 * Каждая плашка называет три вещи: ЧТО выбрано, ЧТО с этим сделал отчёт и
 * КУДА идти за настоящим разрезом. Дверь в Реестр несёт периметр шапки —
 * читатель попадает не в «все строки района», а ровно в свой срез.
 */
export function ReportFilterNotices({ ctx, orgMode, onNavigateRows, onScrollUnfunded }: {
  ctx: FilterContext;
  /** Режим организаций из шапки: район целиком / только ГРБС / с подведами. */
  orgMode: 'district' | 'grbs' | 'withSubs';
  onNavigateRows: (filters: DrillFilters) => void;
  /** Прокрутка к секции «Закупки, не обеспеченные финансированием». */
  onScrollUnfunded: () => void;
}) {
  const deptWord = ctx.grbs.length === 1 ? 'управление' : 'управления';
  return (
    <>
      {/* Управления — п.127. Отчёт единственная вкладка продукта, где
          изоляция управлений НЕ включается: документ по построению общий.
          Молчать об этом нельзя, поэтому исключение объявлено вслух вместе
          с тем, где разрез по выбранным книгам всё-таки настоящий. */}
      {ctx.grbs.length > 0 && (
        <Notice tone="info">
          Выбрано {deptWord}: {ctx.grbs.join(', ')}. Отчёт — полный документ по всем восьми
          ГРБС сразу, поэтому секции ниже он не сужает: к нужной ведёт навигация слева.
          Разрез по выбранным книгам держат два места страницы — лента правок внизу
          (только выбранные книги) и{' '}
          <button
            type="button"
            onClick={onScrollUnfunded}
            title="Секция «Закупки, не обеспеченные финансированием» — там разбивка идёт по выбранному управлению и его учреждениям"
            className={clsx('font-medium text-cyan-700 dark:text-cyan-300 hover:underline', FOCUS_RING)}
          >
            закупки без финансирования
          </button>
          . Построчная выборка ровно по этому отбору:{' '}
          <RowsLink ctx={ctx} label="строки в Реестре" onNavigate={onNavigateRows} />.
        </Notice>
      )}

      {/* Подведомственные — правило (з) периметра: сумма управления не должна
          читаться как сумма выбранных учреждений. */}
      {ctx.subordinates.length > 0 && (
        <Notice tone="muted">
          Выбраны учреждения ({ctx.subordinates.length}), но числа секций считаются по
          управлению ЦЕЛИКОМ: книга ГРБС сведена на распорядителя, графы учреждения в её
          итогах нет. Разбивка по учреждениям на этой странице есть в одном месте —{' '}
          <button
            type="button"
            onClick={onScrollUnfunded}
            title="Секция «Закупки, не обеспеченные финансированием»: при выбранном управлении раскладывается по учреждениям"
            className={clsx('font-medium text-cyan-700 dark:text-cyan-300 hover:underline', FOCUS_RING)}
          >
            закупки без финансирования
          </button>
          {orgMode === 'grbs' && ', и режим «только ГРБС» на итоги секций тоже не действует'}.
          Настоящий построчный разрез:{' '}
          <RowsLink ctx={ctx} label="строки в Реестре" onNavigate={onNavigateRows} />.
        </Notice>
      )}

      {/* Способ закупки — болезнь «сужено, а подпись молчит» (правило «е»
          периметра): под фильтром «только ЕП» читатель считает, что видит
          все закупки. Отчёт способом не сужается вовсе. */}
      {ctx.methods.length > 0 && (
        <Notice tone="muted">
          Выбран способ: {ctx.methods.join(', ')}. К числам отчёта он не применяется —
          отчёт показывает все способы сразу, а разбивка по ним стоит отдельной таблицей
          в каждой секции ГРБС. Строки одного способа:{' '}
          <RowsLink ctx={ctx} label="строки в Реестре" onNavigate={onNavigateRows} />.
        </Notice>
      )}

      {/* Бюджет — деньги отчёта всегда все три уровня; состав показан тройкой
          ФБ/КБ/МБ у денежных плиток, но сами суммы не сужены. */}
      {ctx.budgets.length > 0 && (
        <Notice tone="muted">
          Выбран бюджет: {ctx.budgets.map((b) => BUDGET_PHRASE[b] ?? b).join(', ')}. Деньги
          отчёта он не сужает: планы, факт и экономия здесь всегда по всем трём уровням —
          так их считает официальный лист. Состав по уровням виден полосой ФБ/КБ/МБ под
          денежными плитками.
        </Notice>
      )}

      {/* Вид деятельности — та же ось среза; книга ГРБС отчёта её не режет. */}
      {ctx.activities.length > 0 && (
        <Notice tone="muted">
          Выбран вид деятельности: {ctx.activities.map((a) => ACTIVITY_PHRASE[a] ?? a).join(', ')}.
          Итоги секций по нему не сужены — вид деятельности отчёт показывает разбивкой
          этапности внутри секции, а не фильтром. Строки одного вида:{' '}
          <RowsLink ctx={ctx} label="строки в Реестре" onNavigate={onNavigateRows} />.
        </Notice>
      )}

      {/* Поиск — отчёт документ, а не выборка строк. */}
      {ctx.search !== '' && (
        <Notice tone="muted">
          Текстовый поиск «{ctx.search}» здесь не действует: отчёт — цельный документ по
          управлениям, а не выборка строк. Искать закупки по тексту:{' '}
          <RowsLink ctx={ctx} label="строки в Реестре" onNavigate={onNavigateRows} />.
        </Notice>
      )}
    </>
  );
}
