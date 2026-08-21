// ────────────────────────────────────────────────────────────────
// Общие части вкладки «Конкуренция»: каркас карточки и счёт ЕП/КП
// по периметру шапки.
//
// Правила вкладки (канон 14.08, пп. 53, 58, 69):
//   • каждая карточка сама объявляет период своих ДАННЫХ (PeriodBadge)
//     и момент чтения книг, из которых эти числа взяты (п.58);
//   • оговорки счёта видны на карточке, а не спрятаны в тултип;
//   • хром кремово-серый, цвет — только у данных;
//   • на экране нет латинских внутренних ключей;
//   • поверхности разделяет светлота, а не частокол обводок (п.129).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Calendar } from 'lucide-react';
import type { KBEntryData } from '@aemr/core';
import { useStore } from '../../store';
import { readingMoment } from '../../lib/reading-moment';
import { PeriodBadge } from '../PeriodBadge';
import { KBTooltip } from '../ui/kb-tooltip';
import { kbCardProps } from '../../pages/kb-additions';

/** Единое фокус-кольцо вкладки — клавиатурный обход виден на каждой кнопке. */
export const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900';

// ── Поверхности вкладки (канон п.129) ────────────────────────────
//
// Тёмная тема разделяет вложенные поверхности СВЕТЛОТОЙ: плитка внутри
// карточки светлее самой карточки, и обводка ей не нужна — обводка на каждом
// атоме и давала тот «частокол», которым владелец был недоволен. В светлой
// теме тонкая линия остаётся: на белом фоне разница светлот почти не читается.

/** Вложенная плитка карточки (число с подписью, элемент списка, группа). */
export const TILE =
  'rounded-lg border border-zinc-200/70 dark:border-transparent bg-zinc-50/60 dark:bg-white/[0.04]';

/** Линейка шапки таблицы — тише текста, но различима в обеих темах. */
export const RULE_HEAD = 'border-b border-zinc-200/70 dark:border-white/[0.06]';

/** Линейка между строками таблицы — самая тихая линия вкладки. */
export const RULE_ROW = 'border-b border-zinc-100 dark:border-white/[0.03]';

/**
 * Момент чтения книг у чисел карточки (канон п.58: у каждого числа виден не
 * только период, но и момент, на который оно верно). Книги живут: без этой
 * строки читатель не отличит «сегодня так» от «так было во вторник».
 */
export function ReadMoment() {
  const lastRefreshed = useStore((s) => s.lastRefreshed);
  // Фразу собирает единственный дом продукта (lib/reading-moment): незнание
  // момента там не выдаётся за свежесть, и своя копия подписи была бы вторым
  // домом одной фразы (канон п.112).
  const moment = readingMoment({ readAt: lastRefreshed });
  return (
    <span
      title={moment.phrase}
      className={clsx(
        'text-[9px] leading-tight text-right',
        // Остывшие числа говорят об этом сами: до подсказки читатель может и
        // не добраться.
        moment.stale ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400',
      )}
    >
      {moment.label}
    </span>
  );
}

/**
 * Оговорка режима подведов для карточек, которые разбивку по учреждениям
 * построить НЕ могут (приказ владельца 20.08: разбивка там, где осмысленна;
 * где невозможна — сказать словами, а не промолчать). `reason` называет
 * механизм: чего именно не хватает данным, чтобы разложить число по
 * организациям управления.
 */
export function SubScopeNote({ mode, deptLabel, reason, grbsNote }: {
  mode: 'district' | 'grbs' | 'withSubs';
  /** Короткое имя выбранного управления — оговорка адресная, а не общая. */
  deptLabel?: string | null;
  reason: string;
  /**
   * Чем заменить фразу режима «только ГРБС». По умолчанию — «числа по книге
   * целиком»; карточке, которая отбор управлений вовсе не применяет (кандидаты
   * на объединение), эта фраза была бы неправдой, и она передаёт `null` —
   * тогда в режиме «только ГРБС» оговорки нет: её место занимает собственная.
   */
  grbsNote?: string | null;
}) {
  if (mode === 'district') return null;
  const who = deptLabel ? `${deptLabel}` : 'выбранного управления';
  if (mode === 'grbs' && grbsNote === null) return null;
  return (
    <p className="mt-3 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
      {mode === 'grbs'
        ? (grbsNote
          ?? `Выбран режим «только ГРБС»: числа карточки — по книге ${who} целиком, включая закупки подведомственных учреждений. Режим скрывает разбивку, а не вычитает их из счёта.`)
        : `Разбивки по учреждениям ${who} на этой карточке нет: ${reason}`}
    </p>
  );
}

/**
 * Собственная плашка периметра — для карточек, чьи числа выбору шапки НЕ
 * подчиняются (канон п.58б, правило «б» паспорта периметра: унаследованный
 * бейдж при неподчиняющихся числах запрещён — образец дефекта «пирог с
 * бейджем недели, показывающий закупки года»).
 *
 * Плашка выглядит как обычная, но называет ФАКТИЧЕСКИЙ периметр числа
 * («весь год · все управления»), а не выбор читателя. Тон — янтарный:
 * расхождение с шапкой обязано быть заметно, а не притворяться нормой.
 */
function OwnPerimeterBadge({ label, hint }: { label: string; hint: string }) {
  return (
    <div
      title={hint}
      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-400/[0.12] text-[10px] font-medium text-amber-700 dark:text-amber-400"
    >
      <Calendar size={10} aria-hidden="true" />
      <span>{label}</span>
      <span className="sr-only">— собственный периметр карточки, выбору в шапке не подчиняется</span>
    </div>
  );
}

/**
 * Оси шапки, которые НЕ применяются НИ К ОДНОМУ блоку вкладки, — они
 * объявляются каркасом сразу, а не каждой карточкой заново.
 *
 * Бюджет и вид деятельности «Конкуренция» не читает: `sumEpKp` берёт
 * epCount/kpCount/epPlanTotal/kpPlanTotal без бюджетного разреза, облако
 * торгов и кандидаты на объединение о бюджете не знают вовсе. Соседняя
 * «Экономия» тот же фильтр применяет — читатель, включивший «МБ», получал
 * две вкладки с разной дисциплиной молча (болезнь Н4 атласа карточек).
 */
function useTabWideNotes(): string[] {
  const selectedBudgets = useStore((s) => s.selectedBudgets);
  const selectedActivities = useStore((s) => s.selectedActivities);
  const notes: string[] = [];
  if (selectedBudgets.size > 0) {
    notes.push(
      'Фильтр бюджета числа этой карточки не сужает: способ закупки в книгах уровнем бюджета не размечен — счёт идёт по всем бюджетам.',
    );
  }
  if (selectedActivities.size > 0) {
    notes.push(
      'Фильтр вида деятельности числа этой карточки не сужает: срез способа закупки видом деятельности не размечен.',
    );
  }
  return notes;
}

/**
 * Каркас карточки вкладки. Плашка периода стоит на каждой карточке (канон
 * п. 58): числа обязаны называть период, которому фактически подчиняются.
 * `caveats` — оговорки счёта; они янтарные и живут прямо под заголовком,
 * потому что метрика без оговорок выглядела бы точнее, чем она есть.
 *
 * `ownPerimeter` ставит карточка, чьи числа периоду шапки НЕ подчиняются: тогда
 * бейдж шапки подменяется собственным. Прежде плашка стояла безусловно, и на
 * карточке кандидатов на объединение (весь год · все управления) бейдж спорил
 * с собственной оговоркой карточки прямо в одном заголовке.
 */
export function CompetitionCard({ title, subtitle, icon: Icon, caveats = [], kb, ownPerimeter, children }: {
  title: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  caveats?: string[];
  /** Карточка БЗ метрики блока (kb-additions, п.91-2): наведение/тап на заголовок. */
  kb?: KBEntryData;
  /** Фактический периметр карточки, если он свой: «весь год · все управления». */
  ownPerimeter?: string;
  children: ReactNode;
}) {
  const tabWideNotes = useTabWideNotes();
  const allCaveats = [...caveats, ...tabWideNotes];
  const heading = <h2 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{title}</h2>;
  return (
    // Карточка — поверхность светлее страницы; в тёмной теме её и отделяет
    // светлота, обводка гаснет (п.129). В светлой остаётся тонкая линия.
    <section className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm dark:shadow-none border border-zinc-200/70 dark:border-transparent">
      {/* flex-wrap: на 360–430px плашка периода переносится под заголовок,
          а не ломает строку и не выдавливает текст за край. */}
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 flex-wrap">
        <div className="flex items-start gap-2.5 min-w-0">
          {Icon && (
            <Icon size={16} className="text-zinc-500 dark:text-zinc-400 mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0">
            {kb ? <KBTooltip {...kbCardProps(kb)} showIcon>{heading}</KBTooltip> : heading}
            {subtitle && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed max-w-2xl">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {/* Скоуп числа и момент его чтения стоят вместе: период отвечает на
            «за что посчитано», момент — на «когда это было верно» (п.58). */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {ownPerimeter
            ? (
              <OwnPerimeterBadge
                label={ownPerimeter}
                hint={`Числа этой карточки посчитаны за ${ownPerimeter} — выбор периода и управлений в шапке их не сужает. Почему — сказано в оговорках карточки.`}
              />
            )
            : <PeriodBadge />}
          <ReadMoment />
        </div>
      </header>
      {allCaveats.length > 0 && (
        <div className="px-5 pb-2 space-y-1">
          {allCaveats.map((c, i) => (
            <p
              key={i}
              className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle size={10} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{c}</span>
            </p>
          ))}
        </div>
      )}
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

/**
 * Процент — канонический форматтер продукта из дома форматирования
 * (web/src/lib/report/mappers.ts), не своя копия: страж canon-homes
 * запрещает новые дубли, и правильно делает.
 */
export { fmtPct } from '../../lib/report/mappers';

// ── Счёт ЕП/КП по периметру шапки ────────────────────────────────

/** Итоги способа закупки за периметр: счётчики процедур и плановые деньги (тыс. ₽). */
export interface EpKpTotals {
  epCount: number;
  kpCount: number;
  epPlan: number;
  kpPlan: number;
  /** Хоть одно ненулевое значение встретилось — иначе показывать нечего. */
  hasData: boolean;
}

/** Срез периода из useFilteredData, который нужен счёту (узкий контракт). */
export interface PeriodSel {
  periodKey: string;
  hasActiveMonths: boolean;
  coveredQuarters: string[];
  fullQuarters: string[];
  partialMonths: number[];
  useMonthLevel: boolean;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const present = (v: unknown): boolean => v !== null && v !== undefined;

/**
 * Суммирует ЕП/КП по ОТФИЛЬТРОВАННЫМ управлениям за выбранный период — тем же
 * правилом смешанной агрегации, что и общие тоталы (полные кварталы —
 * квартальным уровнем, частично выбранные — месячным): иначе доля ЕП этой
 * вкладки расходилась бы с числами «Пульта» при одном и том же выборе.
 */
export function sumEpKp(depts: Array<Record<string, unknown>>, sel: PeriodSel): EpKpTotals {
  const out: EpKpTotals = { epCount: 0, kpCount: 0, epPlan: 0, kpPlan: 0, hasData: false };

  let quarterKeys: string[];
  let monthKeys: number[] = [];
  if (!sel.hasActiveMonths) {
    quarterKeys = sel.periodKey === 'year' ? ['year'] : [sel.periodKey];
  } else if (sel.useMonthLevel) {
    quarterKeys = sel.fullQuarters;
    monthKeys = sel.partialMonths;
  } else {
    quarterKeys = sel.coveredQuarters;
  }

  const addRecord = (rec: Record<string, unknown> | undefined) => {
    if (!rec) return;
    if ([rec.epCount, rec.kpCount, rec.epPlanTotal, rec.kpPlanTotal].some(present)) {
      out.hasData = true;
    }
    out.epCount += num(rec.epCount);
    out.kpCount += num(rec.kpCount);
    out.epPlan += num(rec.epPlanTotal);
    out.kpPlan += num(rec.kpPlanTotal);
  };

  for (const d of depts) {
    const quarters = (d.quarters ?? {}) as Record<string, Record<string, unknown>>;
    const months = (d.months ?? {}) as Record<string | number, Record<string, unknown>>;
    // Годовой записи может не быть у книги без расчёта — тогда честный фолбэк
    // на сумму кварталов (та же величина, собранная из частей).
    if (quarterKeys.length === 1 && quarterKeys[0] === 'year' && !quarters.year) {
      for (const qk of ['q1', 'q2', 'q3', 'q4']) addRecord(quarters[qk]);
    } else {
      for (const qk of quarterKeys) addRecord(quarters[qk]);
    }
    for (const m of monthKeys) addRecord(months[m]);
  }
  return out;
}

/** Итоги одного квартала по quarter-level данным (для динамики по кварталам). */
export function sumEpKpQuarter(depts: Array<Record<string, unknown>>, qk: string): EpKpTotals {
  return sumEpKp(depts, {
    periodKey: qk,
    hasActiveMonths: false,
    coveredQuarters: [],
    fullQuarters: [],
    partialMonths: [],
    useMonthLevel: false,
  });
}
