/**
 * Страница «Отчёт» — еженедельный отчёт по закупкам (дуга-3, волна 2B).
 *
 * Первая страница целиком на Page Contract: собрана ТОЛЬКО из контрактных
 * элементов components/contract/* (KpiTile, SectionCard, ReportTable,
 * DiffText, SourceBadge внутри них); каждый элемент получает FilterContext
 * (buildFilterContext) и source-бейдж. Данные — GET /api/report (проекция
 * buildReport из @aemr/core плюс обвязка ответа: methodology — подвал
 * «Методология», svodOnlineUrl — ссылка «СВОД онлайн» в шапке); загрузка по
 * образцу CentralizationCard (useEffect + useState, без TanStack). История
 * снимков грузится один раз на срез (asOfDay) и питает секцию «Что изменилось за
 * неделю» вместе с дельта-бейджами KPI-плиток. Кнопка «Копировать текстом»
 * отдаёт плоский текст generateReportText для вставки в письмо.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Building2, ClipboardCopy, ClipboardCheck, ExternalLink, FileDown, History } from 'lucide-react';
import clsx from 'clsx';
import {
  SEVERITY_COLORS,
  SEVERITY_LABELS,
  SVOD_SHEET_NAME,
  buildSheetUrl,
  SVOD_SPREADSHEET_ID,
  dayNumberOf,
  getMetricByKey,
  productLabel,
  quarterLabel,
  subordinateKey,
} from '@aemr/shared';
import type { MetricDelta, PendingPosition, ReportSignal } from '@aemr/core';
import { api, type ReportResponse } from '../api';
import { useStore } from '../store';
import { buildFilterContext, type FilterContext } from '../lib/filter-context';
import { perimeterLabel, type Perimeter } from '../lib/perimeter';
import { useOrgScope } from '../lib/selectors/org-scope';
import { freshImport } from '../lib/fresh-import';
import { KpiTile } from '../components/contract/KpiTile';
import { SectionCard } from '../components/contract/SectionCard';
import { ReportTable, type ReportTableColumn } from '../components/contract/ReportTable';
import { DiffText } from '../components/contract/DiffText';
import {
  buildGrbsSection,
  buildIntegralSummary,
  fmtAsOfDate,
  fmtCount,
  fmtThousands,
  type GrbsSectionVM,
  type KpiVM,
} from '../lib/report/mappers';
import { RemainderLedger } from '../components/report/RemainderLedger';
import { LifecycleStrip, type OpenLifecycleRows } from '../components/report/LifecycleStrip';
import { ReasonsPanel } from '../components/report/ReasonsPanel';
import { ExpandableRows } from '../components/contract/ExpandableRows';
import { BudgetTriple } from '../components/contract/BudgetTriple';
import { KbHover } from '../components/contract/KbHover';
import { ProofOverlay, type ProofData } from '../components/contract/ProofOverlay';
import {
  officialYearMoneyProof,
  quarterPendingProof,
  svodCellProof,
  unfundedProof,
} from '../lib/report/proof';
import { generateReportText } from '../lib/report/text';
import { reportRequestParams, type ReportMode } from '../lib/report/request';
import { kpiDeltaFor } from '../lib/report/kpi-delta';
import { bookCellUrl, bookLinkHint, bookRowUrl } from '../lib/report/book-link';
import { reportPerimeter } from '../lib/report/perimeter';
import { activeSectionOf } from '../lib/report/active-section';
import { pickWeekSnapshots } from '../lib/report/week-delta';
import { DeltaBadge } from '../components/DeltaBadge';
import { ChangesSection } from '../components/report/ChangesSection';
import { ReportFilterNotices } from '../components/report/FilterNotices';
import { fmtMetricValue } from '../lib/delta-format';
import { EmptyState } from '../components/EmptyState';
import { SkeletonKPIRow, SkeletonChart } from '../components/Skeleton';
import { KBTooltip } from '../components/ui/kb-tooltip';
import { DASHBOARD_REPORT_KB_ADDITIONS, kbCardProps } from './kb-additions';

type Quarter = 1 | 2 | 3 | 4;
const QUARTERS: readonly Quarter[] = [1, 2, 3, 4];

const METHOD_COLUMNS: readonly ReportTableColumn[] = [
  { key: 'method', label: 'Способ' },
  { key: 'plan', label: 'План', align: 'right' },
  { key: 'fact', label: 'Заключено', align: 'right' },
  { key: 'pct', label: 'Исполнение', align: 'right' },
];

const SVOD_COLUMNS: readonly ReportTableColumn[] = [
  { key: 'metric', label: 'Показатель' },
  { key: 'calc', label: 'Расчёт', align: 'right' },
  { key: 'svod', label: 'СВОД', align: 'right' },
  // Провенанс: адрес ячейки официального листа — куда смотреть в живой книге.
  { key: 'cell', label: 'Ячейка', align: 'right' },
];

/**
 * Состав денежной плитки: полоса долей ФБ/КБ/МБ и те же числа текстом
 * (канон «текстовый дубль визуального»). Тройки нет — плитка без подвала.
 */
function moneyFooter(tile: KpiVM) {
  if (!tile.budget) return undefined;
  return (
    <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
      <BudgetTriple
        fb={tile.budget.fb}
        kb={tile.budget.kb}
        mb={tile.budget.mb}
        metricPrefix={tile.metricKey === 'economy_total' ? 'economy' : tile.metricKey === 'fact_total' ? 'fact' : 'plan'}
        bar
      />
    </div>
  );
}

/**
 * Честная расшифровка ошибки загрузки для EmptyState (503 = снимка ещё нет).
 * Заголовок — причина, описание — что это значит и что делать; технический
 * текст сервера уезжает в мелкую строку подробности, а не подменяет объяснение.
 */
function errorContent(error: string): { title: string; description: string } {
  return error.includes('503')
    ? {
      title: 'Сервер ещё не прочитал книги управлений',
      description:
        'Снимка данных на сервере пока нет, поэтому отчёту не из чего собраться. ' +
        'Запустите чтение книг на Пульте и вернитесь сюда.',
    }
    : {
      title: 'Отчёт не удалось загрузить',
      description:
        'Сервер не ответил на запрос отчёта. Проверьте связь с сервером данных ' +
        'и повторите запрос.',
    };
}

/**
 * Адрес первички ссылкой (работа P1-2 карты вкладки): «строка 128» и
 * «ячейка W59» перестают быть серым текстом и открывают книгу управления.
 * Книги управления нет в реестре либо адрес непонятной формы — остаётся тот
 * же текст, что и раньше: ссылка в никуда хуже честного текста.
 */
function BookAddress({ href, hint, children }: { href: string | null; hint: string; children: ReactNode }) {
  if (href === null) {
    return <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={hint}
      className="font-mono text-[10px] text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700 dark:text-blue-400"
    >
      {children}
    </a>
  );
}

/** Открыть доказательство числа — прокидывается вглубь секций страницы. */
type OpenProof = (proof: ProofData) => void;

/**
 * Число-кнопка: клик раскрывает доказательство ПРЯМО ЗДЕСЬ (требование
 * владельца — никаких переходов в Реестр). Кнопка появляется только там, где
 * доказательство действительно собралось: сборщик вернул null — число
 * остаётся обычным текстом, а не кнопкой в пустой оверлей.
 *
 * Хром нейтральный (лупа курсора и подложка на наведении, без краски):
 * цвет на странице принадлежит данным, а не управлению.
 */
function ProofButton({ proof, onOpen, children }: { proof: ProofData; onOpen: OpenProof; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(proof)}
      aria-haspopup="dialog"
      title="Показать доказательство: формула, строки-атомы, ячейка листа"
      className="-mx-0.5 cursor-zoom-in rounded px-0.5 text-left hover:bg-zinc-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-400 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

/**
 * Строка сигнала: полный текст (обрезка запрещена — закон «сигналы целиком»),
 * слово критичности рядом с точкой, описание и адрес первички
 * (лист · ячейка) — путь к таблице от каждого пункта.
 */
function SignalRow({ s, dept }: { s: ReportSignal; dept: string }) {
  return (
    <div className="text-[11px] leading-relaxed">
      <div className="flex items-baseline gap-2">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0 self-center"
          style={{ backgroundColor: SEVERITY_COLORS[s.severity].text }}
        />
        <span className="shrink-0 text-[10px] uppercase tracking-wide" style={{ color: SEVERITY_COLORS[s.severity].text }}>
          {SEVERITY_LABELS[s.severity]?.label ?? s.severity}
        </span>
        <span className="text-zinc-700 dark:text-zinc-200">{s.title}</span>
      </div>
      {(s.description || s.sheet || s.cell) && (
        <div className="ml-3.5 text-zinc-500 dark:text-zinc-400">
          {s.description}
          {(s.sheet || s.cell) && (
            <span className="ml-1">
              {' — '}
              <BookAddress
                href={s.cell ? bookCellUrl(dept, s.cell) : null}
                hint={bookLinkHint(dept, s.cell ? `выделение встанет на ячейку ${s.cell}` : 'адрес ячейки')}
              >
                {s.sheet ? `лист «${s.sheet}»` : ''}{s.sheet && s.cell ? ' · ' : ''}{s.cell ? `ячейка ${s.cell}` : ''}
              </BookAddress>
            </span>
          )}
        </div>
      )}
      {/* Карточка диагноста целиком (канон п.53): у сигнала виден не только
          диагноз, но и ответ. Рекомендации нет — молчать нельзя: читатель
          иначе решает, что действие очевидно и он один его не понимает.
          Проверки без рекомендации остаются в ядре (работа 4.10 плана),
          здесь экран честно говорит, чего у сигнала пока нет, и оставляет
          дорогу к строке — она выше, адресом листа и ячейки. */}
      {s.recommendation ? (
        <div className="ml-3.5 text-zinc-500 dark:text-zinc-400">Рекомендация: {s.recommendation}</div>
      ) : (
        <div className="ml-3.5 text-zinc-400 dark:text-zinc-500">
          Рекомендации у этой проверки пока нет — что делать, видно по адресу строки выше.
        </div>
      )}
    </div>
  );
}

/**
 * Незаключённая позиция: предмет целиком (обрезка запрещена), способ,
 * плановые дата и деньги, адрес строки листа и пояснения исполнителя с
 * подписями источника. Отсутствие пояснений — честная строка: качество
 * заполнения листа — тоже информация для читателя.
 */
function PendingPositionRow({ p, dept }: { p: PendingPosition; dept: string }) {
  return (
    <div className="text-[11px] leading-relaxed">
      <div className="text-zinc-700 dark:text-zinc-200">
        {p.subject || 'Без наименования'}
        <span className="text-zinc-400 dark:text-zinc-500">
          {' — '}{p.method || 'способ не указан'}
          {p.planDate && ` · план ${p.planDate}`}
          {p.planTotal > 0 && ` · ${fmtCount(p.planTotal)} тыс. руб.`}
          {' '}
          <BookAddress
            href={bookRowUrl(dept, p.sheetRow)}
            hint={bookLinkHint(dept, `выделение встанет на строку ${p.sheetRow}`)}
          >
            строка {p.sheetRow}
          </BookAddress>
        </span>
        {/* Бейдж «ожидается <дата>» удалён 14.08.2026 (канон п.27 интервью,
            пп.31/40/41): дата вынималась машинно из свободного текста
            исполнителя и врала («лицензия до 30.08.2027» → «ожидается
            30.08.2027»). Пояснения ниже показываются как есть. */}
      </div>
      {p.explanations.length > 0 ? (
        p.explanations.map((e) => (
          <div key={e.label} className="ml-3 text-zinc-500 dark:text-zinc-400">
            {e.label}: {e.text}
          </div>
        ))
      ) : (
        <div className="ml-3 text-[10px] text-amber-600 dark:text-amber-400">
          пояснений в листе нет
        </div>
      )}
    </div>
  );
}

/** Позиция секции «Закупки, не обеспеченные финансированием» (тип ответа сервера). */
type UnfundedPositionVM = NonNullable<ReportResponse['unfunded']>['byDept'][number]['positions'][number];

/** Ключ-ведро подведа для org-scope: дословная колонка C, пусто = аппарат. */
const unfundedSubKey = (p: UnfundedPositionVM): string => subordinateKey(p.subordinate);

/**
 * Строка закупки без финансирования: предмет целиком, подвед (в разбивке по
 * подведам не повторяется — его называет заголовок группы), способ, деньги,
 * адрес строки листа.
 */
function UnfundedPositionRow({ p, dept, showSubordinate = true }: { p: UnfundedPositionVM; dept: string; showSubordinate?: boolean }) {
  return (
    <div className="text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200">
      {p.subject || 'Без наименования'}
      <span className="text-zinc-400 dark:text-zinc-500">
        {showSubordinate && p.subordinate && ` — ${p.subordinate}`}
        {p.method && ` · ${p.method}`}
        {` · ${fmtThousands(p.planTotal)} тыс. руб. `}
        <BookAddress
          href={bookRowUrl(dept, p.sheetRow)}
          hint={bookLinkHint(dept, `выделение встанет на строку ${p.sheetRow}`)}
        >
          строка {p.sheetRow}
        </BookAddress>
      </span>
    </div>
  );
}

/**
 * Процент строки таблицы способов: бар + число (закон «текстовый дубль
 * визуального»); null — «нет плана», бар не рисуется.
 */
function MethodPct({ pct, pctText, bold }: { pct: number | null; pctText: string; bold?: boolean }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {pct !== null && (
        <span
          aria-hidden="true"
          className="h-1 w-12 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
        >
          <span
            className="block h-full rounded-full bg-blue-500/80"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </span>
      )}
      <span className={bold ? 'tabular-nums font-semibold' : 'tabular-nums'}>{pctText}</span>
    </span>
  );
}

/** Секция одного ГРБС — контрактные элементы; memo: тики локального
    состояния страницы не перерисовывают 8 тяжёлых секций. */
const GrbsSection = memo(function GrbsSection({ vm, quarter, year, ctx, perimeter, onProof, onOpenRows }: { vm: GrbsSectionVM; quarter: Quarter; year: number; ctx: FilterContext; perimeter: Perimeter; onProof: OpenProof; onOpenRows: OpenLifecycleRows }) {
  // Доказательство остатка квартала: строки-атомы — те самые незаключённые
  // позиции, что перечислены ниже по секции. Перечня нет — кнопки нет.
  const pendingProof = useMemo(() => quarterPendingProof(vm, quarter), [vm, quarter]);
  return (
    <SectionCard filterCtx={ctx} source={vm.source} title={vm.deptLabel} icon={Building2} perimeter={perimeter}>
      <div className="space-y-3">
        {/* Шапка секции: жирный % и сразу разбивка по способам со строкой
            «Всего» — детальность сверху, без текстового дубля (вводная 06.08:
            прежняя подпись «заключено 4 из 20» повторяла таблицу снизу). */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <KbHover metricKey="exec_count_pct">
            <span className="text-2xl font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
              {vm.executionPct}
            </span>
          </KbHover>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            исполнение {quarter} квартала
          </span>
          <span
            className={
              vm.pendingCount > 0
                ? 'text-[11px] font-semibold text-amber-600 dark:text-amber-400'
                : 'text-[11px] text-zinc-400 dark:text-zinc-500'
            }
          >
            <KbHover metricKey="pending_count">
              {pendingProof
                ? <ProofButton proof={pendingProof} onOpen={onProof}>{vm.pendingLabel}</ProofButton>
                : vm.pendingLabel}
            </KbHover>
          </span>
        </div>

        {/* КП/ЕП + «Всего» — единственный дом квартальных счётчиков секции */}
        <ReportTable
          filterCtx={ctx}
          source="calc"
          caption={`Способы · ${quarterLabel(quarter)}`}
          columns={METHOD_COLUMNS}
          rows={[
            ...vm.methodRows.map((r) => ({
              // БЗ на строке группы: ключ % исполнения группы объясняет и
              // состав (что такое КП/ЕП), и счёт строки
              method: (
                <KbHover metricKey={r.methodKey === 'КП' ? 'comp_exec_count_pct' : 'ep_exec_count_pct'}>
                  <span>{productLabel(r.methodKey === 'КП' ? 'kp' : 'ep')}</span>
                </KbHover>
              ),
              plan: fmtCount(r.plan),
              fact: fmtCount(r.fact),
              pct: <MethodPct pct={r.pct} pctText={r.pctText} />,
            })),
            {
              method: (
                <KbHover metricKey="exec_count_pct">
                  <span className="font-semibold">Всего</span>
                </KbHover>
              ),
              plan: <span className="font-semibold">{fmtCount(vm.totalRow.plan)}</span>,
              fact: <span className="font-semibold">{fmtCount(vm.totalRow.fact)}</span>,
              pct: <MethodPct pct={vm.totalRow.pct} pctText={vm.totalRow.pctText} bold />,
            },
          ]}
        />

        {/* Незаключённые позиции квартала с пояснениями из листа —
            «по ним же ещё и объяснения должны быть» (запрос коллеги) */}
        {vm.pendingPositions.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Не заключено в {quarterLabel(quarter)} · с пояснениями из листа
            </div>
            <ExpandableRows
              rows={vm.pendingPositions}
              top={3}
              noun="позиций"
              searchText={(p) => `${p.subject} ${p.method} ${p.planDate} ${p.explanations.map((e) => e.text).join(' ')}`}
            >
              {(p) => <PendingPositionRow key={p.sheetRow} p={p} dept={vm.dept} />}
            </ExpandableRows>
          </div>
        )}

        {/* Этапность: вид деятельности и стадия жизненного цикла — вводная
            04.08 «этапность в таблице есть, но не показывается» */}
        <LifecycleStrip
          byType={vm.lifecycle.byType}
          byStage={vm.lifecycle.byStage}
          year={year}
          dept={vm.dept}
          onOpenRows={onOpenRows}
        />

        {/* Своды объяснений исполнителя: свободный текст листа, сведённый
            справочниками — считаем по кластеру, проверяем по живому образцу */}
        <ReasonsPanel
          epReasons={vm.reasons.epReasons}
          deviations={vm.reasons.deviations}
          year={year}
          quarter={quarter}
        />

        {/* Год, деньги (тройки ФБ/КБ/МБ — канон цвет+подпись), экономия */}
        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 space-y-0.5">
          <div><KbHover metricKey="exec_count_pct">{vm.yearLine}</KbHover></div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <KbHover metricKey="plan_total">
              <span>Лимит {fmtCount(vm.money.plan.total)} тыс. руб.</span>
            </KbHover>
            <BudgetTriple fb={vm.money.plan.fb} kb={vm.money.plan.kb} mb={vm.money.plan.mb} metricPrefix="plan" />
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <KbHover metricKey="fact_total">
              <span>Факт {fmtCount(vm.money.fact.total)} тыс. руб.</span>
            </KbHover>
            <BudgetTriple fb={vm.money.fact.fb} kb={vm.money.fact.kb} mb={vm.money.fact.mb} metricPrefix="fact" />
            {vm.economyLine && (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                <KbHover metricKey="economy_total">{vm.economyLine}</KbHover>
              </span>
            )}
          </div>
        </div>

        {/* Сверка со СВОД: расчёт рядом с официалом, расхождение — DiffText */}
        {vm.svodPairs && (
          <div className="space-y-1">
            <ReportTable
              filterCtx={ctx}
              source="mixed"
              caption="Сверка со СВОД · на текущий момент"
              columns={SVOD_COLUMNS}
              rows={vm.svodPairs.map((p) => {
                // Официальное число листа (деньги года и квартальные счётчики):
                // своих строк-атомов у него нет — его считают формулы самого
                // листа. Доказательство показывает ячейку, причину пустоты и
                // наш пересчёт рядом, не подменяя им официал. Ревизия п.91:
                // раньше кликались только деньги — счётчики с адресом ячейки
                // оставались немыми без причины (сборщик без ячейки сам
                // вернёт null, кнопка не появится).
                const proof = svodCellProof({
                  metricKey: p.metricKey,
                  value: p.svod,
                  calc: p.calc,
                  money: p.fmt === 'money',
                  ...(p.svodCell ? { cell: p.svodCell } : {}),
                });
                const svodValue = (
                  <DiffText
                    filterCtx={ctx}
                    source="svod"
                    value={p.svod}
                    reference={p.calc}
                    {...(p.fmt === 'money' ? { format: fmtThousands } : {})}
                  />
                );
                return {
                  metric: (
                    <KbHover metricKey={p.metricKey}>
                      <span>{p.label ?? productLabel(p.metricKey)}</span>
                    </KbHover>
                  ),
                  calc: p.fmt === 'money' ? fmtThousands(p.calc) : fmtCount(p.calc),
                  svod: proof
                    ? <ProofButton proof={proof} onOpen={onProof}>{svodValue}</ProofButton>
                    : svodValue,
                  // Ссылка ведёт в ту самую ячейку живой книги — число проверяемо
                  // за один клик, без пересказа «где-то в СВОДе».
                  cell: p.svodCell
                    ? (
                      <a
                        href={buildSheetUrl(SVOD_SPREADSHEET_ID, p.svodCell)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[10px] text-zinc-500 hover:text-blue-600 hover:underline dark:text-zinc-400 dark:hover:text-blue-400"
                        title={`Открыть ${SVOD_SHEET_NAME}!${p.svodCell} в Google Sheets`}
                      >
                        {p.svodCell}
                      </a>
                    )
                    : '—',
                };
              })}
            />
            {vm.svodNote && (
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{vm.svodNote}</div>
            )}
          </div>
        )}

        {/* Сигналы: полный текст без обрезаний, слово критичности (текстовый
            дубль цвета), адрес первички; свёрнут топ-3, раскрывается всё */}
        {vm.signals.length > 0 && (
          <ExpandableRows
            rows={vm.signals}
            top={3}
            noun="сигналов"
            searchText={(s) => `${s.title} ${s.description} ${s.sheet ?? ''} ${s.cell ?? ''}`}
          >
            {(s) => <SignalRow key={s.id} s={s} dept={vm.dept} />}
          </ExpandableRows>
        )}
      </div>
    </SectionCard>
  );
});

// ── «Что изменилось за неделю»: дельта снимков вокруг четверга среза ──

/** Сколько строк дрейфа видно до раскрытия — не потолок списка, а верх. */
/**
 * Линия чтения для подсветки активной секции: полоса чуть ниже липкой шапки
 * приложения. Верх окна не годится — по нему активной становилась бы секция,
 * от которой видна одна строка.
 */
const READING_LINE = 140;

const MAX_WEEK_DELTA_ROWS = 8;

/** Подпись метрики дрейфа: канон REPORT_MAP (dotted-ключи officialMetrics). */
function weekMetricLabel(key: string): string {
  return getMetricByKey(key)?.label ?? productLabel(key);
}

/**
 * Ранжирование дрейфа для топа: appeared/disappeared всегда наверху, дальше —
 * по |deltaPct|, не |deltaAbs|: единицы метрик разнородны, и абсолютная
 * сортировка diffMetrics всегда выталкивала бы деньги (тыс. руб.) поверх
 * долей в п.п. (ponytail-ревью R1 #3).
 */
function weekDeltaRank(d: MetricDelta): number {
  if (d.direction === 'appeared' || d.direction === 'disappeared') return Infinity;
  return d.deltaPct !== null ? Math.abs(d.deltaPct) : 0;
}

type WeekDeltaState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'no-pair' }
  | { kind: 'ready'; deltas: MetricDelta[]; fromDay: number; toDay: number };

/**
 * Итоги недели в цифрах — верхний ярус единой ленты «Что изменилось»:
 * дельты официальных метрик между снимком среза и снимком неделей раньше.
 * Рендерится ВНУТРИ общей секции (единый провенанс, бритва Оккама):
 * читателю не важно, что цифры из снимков, а правки из журналов —
 * это одна система «что изменилось». Все деградации — тихие строки,
 * секция от снимков не зависит.
 */
function WeekDeltaBody({ state }: { state: WeekDeltaState }) {
  if (state.kind === 'loading') return null;

  const note = state.kind === 'no-pair'
    ? 'Пары снимков для сравнения недели нет — итоги в цифрах появятся со следующим срезом.'
    : state.kind === 'error'
      ? 'История снимков недоступна — итоги недели в цифрах пропущены.'
      : null;

  return (
    <div className="space-y-2">
      {/* Карточка БЗ яруса — из kb-additions (п.91): у блока с числами
          обязано быть объяснение «что это и как считается». */}
      <KBTooltip {...kbCardProps(DASHBOARD_REPORT_KB_ADDITIONS.report_week_delta)}>
        <div className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Итоги недели в цифрах · официальные метрики СВОДа
        </div>
      </KBTooltip>
      {note !== null ? (
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">— {note}</div>
      ) : state.kind === 'ready' && (() => {
        // Обрезки больше нет (работа P1-4 карты вкладки): жёсткий срез в
        // восемь строк молча прятал остальные — читатель не знал ни того,
        // что они есть, ни их числа. Порядок прежний, показ — раскрытием.
        const significant = state.deltas
          .filter((d) => d.direction !== 'flat')
          .sort((a, b) => weekDeltaRank(b) - weekDeltaRank(a));
        return (
          <>
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
              снимок {fmtAsOfDate(state.fromDay)} → {fmtAsOfDate(state.toDay)}
            </div>
            {significant.length === 0 ? (
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Значимых изменений метрик за неделю нет.
              </div>
            ) : (
              <ExpandableRows
                rows={significant}
                top={MAX_WEEK_DELTA_ROWS}
                noun="метрик"
                searchText={(d) => weekMetricLabel(d.metricKey)}
              >
                {(d) => (
                  <div key={d.metricKey} className="flex items-center gap-2 py-0.5 text-[11px]">
                    <span className="flex-1 min-w-0 truncate text-zinc-600 dark:text-zinc-300">
                      {weekMetricLabel(d.metricKey)}
                    </span>
                    <span className="tabular-nums whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                      {fmtMetricValue(d.metricKey, d.from?.value ?? null)} → {fmtMetricValue(d.metricKey, d.to?.value ?? null)}
                    </span>
                    <DeltaBadge delta={d} />
                  </div>
                )}
              </ExpandableRows>
            )}
          </>
        );
      })()}
    </div>
  );
}

export function ReportPage() {
  // FilterContext из store — единый объект для всех контрактных элементов
  const navigateTo = useStore((s) => s.navigateTo);
  const year = useStore((s) => s.year);
  const period = useStore((s) => s.period);
  const activeMonths = useStore((s) => s.activeMonths);
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const selectedSubordinates = useStore((s) => s.selectedSubordinates);
  const selectedActivities = useStore((s) => s.selectedActivities);
  const selectedMethods = useStore((s) => s.selectedMethods);
  const selectedBudgets = useStore((s) => s.selectedBudgets);
  const searchQuery = useStore((s) => s.searchQuery);
  const periodMode = useStore((s) => s.periodMode);
  const focusedWeekStart = useStore((s) => s.focusedWeekStart);
  const stavkaMode = useStore((s) => s.stavkaMode);
  const liveStavka = useStore((s) => s.liveStavka);
  const ctx = useMemo(
    () => buildFilterContext({
      year, period, activeMonths, selectedDepartments, selectedSubordinates,
      selectedActivities, selectedMethods, selectedBudgets, searchQuery,
      periodMode, focusedWeekStart,
    }),
    [year, period, activeMonths, selectedDepartments, selectedSubordinates,
      selectedActivities, selectedMethods, selectedBudgets, searchQuery,
      periodMode, focusedWeekStart],
  );

  // Параметры запроса — чистым хелпером: год из контекста ('all' → последний
  // доступный), квартал — кнопки страницы поверх ctx.period, asOf — четверг
  // выбранной недели колеса (кламп к последнему четвергу — внутри хелпера)
  const [localQuarter, setLocalQuarter] = useState<Quarter | null>(null);
  // Режим просмотра: эфир по умолчанию (канон 27.07). Переключатель в шапке —
  // единственный способ уйти в архив недели, поэтому состояние живёт здесь,
  // а не выводится из наличия недели в фильтрах (это и путало читателя).
  const [mode, setMode] = useState<ReportMode>('live');
  // Колесо недель и переключатель — одно управление, а не два несвязанных.
  // Крутанул неделю — это явное намерение смотреть архив, поэтому режим
  // переключается сам. Без этого колесо в эфире молча ни на что не влияло.
  const prevWeek = useRef<string | null>(ctx.weekStart);
  useEffect(() => {
    if (ctx.weekStart !== prevWeek.current) {
      prevWeek.current = ctx.weekStart;
      if (ctx.weekStart !== null) setMode('archive');
    }
  }, [ctx.weekStart]);
  const request = useMemo(
    () => reportRequestParams(ctx, dayNumberOf(new Date())!, localQuarter ?? undefined, mode),
    [ctx, localQuarter, mode],
  );

  // Загрузка по образцу CentralizationCard: useEffect + useState, без TanStack.
  // retry — счётчик «Повторить запрос» из пустого состояния ошибки: без него
  // читатель после сбоя мог только перезагрузить страницу целиком.
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    api.getReport(request.year, request.quarter, request.asOf)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e: unknown) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [request.year, request.quarter, request.asOf, retry]);

  // История снимков вокруг четверга среза — ОДИН запрос на страницу:
  // питает и секцию «Что изменилось за неделю», и дельта-бейджи KPI-плиток
  // (/api/history/snapshots + /api/history/diff; сбой — честная плашка секции).
  const asOfDay = report?.period.asOfDay;
  // Список снимков не зависит от отчёта — грузим один раз, не ждём asOfDay
  // (иначе два round-trip выстраивались в очередь).
  const snapshotsOnce = useRef<ReturnType<typeof api.getHistorySnapshots> | null>(null);
  const [weekDelta, setWeekDelta] = useState<WeekDeltaState>({ kind: 'loading' });
  useEffect(() => {
    setWeekDelta({ kind: 'loading' });
    if (asOfDay === undefined) return;
    let cancelled = false;
    snapshotsOnce.current ??= api.getHistorySnapshots();
    snapshotsOnce.current
      .then(async (snaps) => {
        const pair = pickWeekSnapshots(snaps, asOfDay);
        if (pair === null) {
          if (!cancelled) setWeekDelta({ kind: 'no-pair' });
          return;
        }
        const deltas = await api.getHistoryDiff(pair.from.id, pair.to.id);
        if (cancelled) return;
        setWeekDelta({
          kind: 'ready',
          deltas,
          fromDay: dayNumberOf(pair.from.createdAt) ?? asOfDay - 7,
          toDay: dayNumberOf(pair.to.createdAt) ?? asOfDay,
        });
      })
      .catch(() => {
        // Сбой снимков не должен запирать секцию до перезагрузки страницы:
        // кэш промиса чистим, следующий прогон эффекта попробует снова.
        snapshotsOnce.current = null;
        if (!cancelled) setWeekDelta({ kind: 'error' });
      });
    return () => { cancelled = true; };
  }, [asOfDay]);
  const weekDeltas = weekDelta.kind === 'ready' ? weekDelta.deltas : [];

  // ── Режим подведов (org-scope, приказ владельца 20.08.2026) ──
  // Отчёт — документ по всем управлениям (решение 03.08: фильтр секций не
  // режет), поэтому режим не прячет блоки, а добавляет измерение там, где у
  // страницы есть строки с колонкой C: секция «Закупки, не обеспеченные
  // финансированием» при выборе одного ГРБС «с подведомственными»
  // раскладывается по учреждениям. Образец подключения — шапка
  // lib/selectors/org-scope.ts.
  const orgMode = useOrgScope();
  const unfundedSelectedRows = useMemo<UnfundedPositionVM[]>(
    () => (orgMode.dept !== null && report?.unfunded
      ? report.unfunded.byDept.find((d) => d.dept === orgMode.dept)?.positions ?? []
      : []),
    [report, orgMode.dept],
  );
  const orgScope = useOrgScope(unfundedSelectedRows, unfundedSubKey);

  // Доказательство числа — состояние страницы, а не маршрут: раскрытие идёт
  // на месте, без ухода в Реестр (решение владельца, бриф «Отчёт++» §3).
  const [proof, setProof] = useState<ProofData | null>(null);

  const [copied, setCopied] = useState(false);
  // Дата — из ответа сервера (period.asOfDay), не new Date(): у продукта свой
  // календарь (+12), браузер читателя может быть в другом поясе.
  const asOfDate = report ? fmtAsOfDate(report.period.asOfDay) : null;
  // Режим просмотра: эфир — числа на сейчас; архив — снимок недели.
  const isLive = report?.period.live ?? false;
  // Выгрузка в Word: какая из двух кнопок сейчас готовит файл (null — обе
  // свободны) и на каком она этапе. Этап показывается словами (работа 4.13
  // плана): сборка идёт секунды и качает четыре квартала, а прежнее
  // «Готовится…» не отличало «сервер не ответил» от «идём по плану» —
  // читатель жал кнопку второй раз.
  const [saving, setSaving] = useState<{ kind: 'main' | 'extra'; stage: string } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const onDownloadDocx = async (kind: 'main' | 'extra') => {
    if (!report || asOfDate === null) return;
    setSaving({ kind, stage: 'кварталы 0/4' });
    setDownloadError(null);
    // Счётчик готовых кварталов. Обещания разрешаются вразнобой, поэтому
    // считается ЧИСЛО готовых, а не номер последнего пришедшего: «квартал 4
    // из 4» при двух оставшихся в пути было бы враньём на кнопке.
    let done = 0;
    try {
      // Библиотека грузится по требованию: 400 КБ не должны висеть на каждом
      // открытии страницы ради кнопки, которую жмут раз в неделю.
      // Ручной отчёт печатает ВСЕ четыре квартала («Всего на 1…4 квартал»), а
      // проекция знает ровно один. Недостающие три берём запросами; текущий
      // уже загружен страницей. Импорты и запросы независимы — один Promise.all.
      const [{ buildDocument, downloadDocx, reportFilename }, { mainReportBlocks, additionalReportBlocks }, q1, q2, q3, q4] =
        await Promise.all([
          // freshImport: после выката старые куски сборки исчезают с сервера,
          // и открытая до выката вкладка ловила красное «Failed to fetch
          // dynamically imported module» (прод, 14.08). Теперь страница один
          // раз перезагружается на новую версию вместо ошибки.
          freshImport(() => import('../lib/report/docx/build-docx')),
          freshImport(() => import('../lib/report/docx/text-blocks')),
          // В архиве срез пришпилен asOf — текущий квартал можно взять из
          // загруженного отчёта. В ЭФИРЕ пиновки нет: между открытием
          // страницы и кликом сервер мог перечитать книги, и документ
          // склеился бы из разных моментов (тот же класс, что фикс 67c131c).
          ...QUARTERS.map((q) => {
            const source = q === report.period.quarter && request.asOf !== undefined
              ? Promise.resolve(report)
              : api.getReport(request.year, q, request.asOf);
            return source.then((r) => {
              done += 1;
              setSaving({ kind, stage: `кварталы ${done}/4` });
              return r;
            });
          }),
        ] as const);
      setSaving({ kind, stage: 'сборка' });
      const quarters = { 1: q1, 2: q2, 3: q3, 4: q4 };
      const isMain = kind === 'main';
      const blocks = isMain
        ? mainReportBlocks(report, quarters, asOfDate)
        : additionalReportBlocks(report, quarters, asOfDate);
      const title = isMain ? 'Отчёт по закупкам' : 'Дополнительно к отчету по закупкам';
      await downloadDocx(buildDocument(blocks, title), reportFilename(title, asOfDate));
    } catch (e: unknown) {
      setDownloadError(`Не удалось собрать документ: ${String(e)}`);
    } finally {
      setSaving(null);
    }
  };

  const onCopy = () => {
    if (!report || asOfDate === null) return;
    void navigator.clipboard.writeText(generateReportText(report, asOfDate)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Отчёт — полный документ, как бумага: ГРБС-фильтр сайдбара секции НЕ
  // режет (решение 03.08 «вместо фильтра — шапка»); навигация — шапкой ГРБС.
  const visibleBlocks = useMemo(
    () => (report ? report.grbsBlocks.map(buildGrbsSection) : []),
    [report],
  );

  // Ставка снижения (канон п.144): положение переключателя шапки доводится до
  // единственного зависимого числа сводки — расчётной экономии по остатку.
  const summary = useMemo(
    () => (report
      ? buildIntegralSummary(report, { mode: stavkaMode, livePct: liveStavka?.pct ?? null, readAt: liveStavka?.readAt ?? null })
      : null),
    [report, stavkaMode, liveStavka],
  );
  // Паспорта периметра секций (канон п.58): один — квартальный, для сводки и
  // блоков ГРБС; второй — годовой, для блоков, которые квартал не сужает
  // (закупки без финансирования, лента правок). Строятся ИЗ ОТВЕТА сервера,
  // а неприменимые оси шапки объявляются словами внутри `reportPerimeter`.
  const quarterPerimeter = useMemo(
    () => (report ? reportPerimeter({ report, ctx }) : null),
    [report, ctx],
  );
  const yearPerimeter = useMemo(
    () => (report ? reportPerimeter({ report, ctx, wholeYear: true }) : null),
    [report, ctx],
  );
  const activeQuarter: Quarter | null = report ? report.period.quarter : request.quarter ?? null;

  // Подсветка секции, которую сейчас читают (работа 4.14 плана). Наблюдатель
  // пересечений будит пересчёт, а РЕШЕНИЕ «какая секция активна» принимает
  // `activeSectionOf` — оно проверяется тестом, а не глазом на живой
  // странице. Слушаем сами секции, а не прокрутку окна: секции разной высоты,
  // и считать по номеру было бы враньём при свёрнутых блоках.
  const [activeDept, setActiveDept] = useState<string | null>(null);
  const deptKeys = visibleBlocks.map((b) => b.dept).join('|');
  useEffect(() => {
    const depts = deptKeys === '' ? [] : deptKeys.split('|');
    if (depts.length < 2) { setActiveDept(null); return; }
    const recompute = () => {
      const offsets = depts
        .map((dept) => ({ dept, el: document.getElementById(`grbs-${dept}`) }))
        .filter((x): x is { dept: string; el: HTMLElement } => x.el !== null)
        .map(({ dept, el }) => ({ dept, top: el.getBoundingClientRect().top }));
      setActiveDept(activeSectionOf(offsets, READING_LINE));
    };
    recompute();
    // Наблюдатель — только повод пересчитать: сам он сообщает о пересечении
    // одной секции, а ответ зависит от положения ВСЕХ. Порог 0 достаточен:
    // каждый вход и выход секции из окна перезапускает общий счёт.
    const io = new IntersectionObserver(recompute, { threshold: 0 });
    for (const dept of depts) {
      const el = document.getElementById(`grbs-${dept}`);
      if (el) io.observe(el);
    }
    window.addEventListener('scroll', recompute, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', recompute);
    };
  }, [deptKeys]);

  return (
    <div className="flex items-start gap-4">
      {/* Навигация ГРБС — липкая левая колонка (решение 03.08 «вместо
          фильтра — шапка», перенесена из инлайн-строки 06.08: строка
          прокручивалась вместе со страницей, после клика нужно было
          листать обратно наверх, чтобы кликнуть следующий пункт). */}
      {/* На узких экранах (360–430px) колонка съедала треть ширины и плющила
          документ — до планшета навигация скрыта, дорогу к низу страницы
          держит кнопка-якорь «Что изменилось ↓» в шапке. */}
      {visibleBlocks.length > 1 && (
        <nav
          aria-label="ГРБС отчёта"
          className="sticky top-2 hidden w-28 shrink-0 flex-col gap-1 md:flex"
        >
          {/* Паспорт колонки процентов (канон п.58, работа 4.14 плана).
              Восемь чисел стояли здесь без единого слова о том, что они
              значат: читатель колонки не знал ни периода, ни момента — и
              законно принимал их за исполнение года. Подпись одна на всю
              колонку, а не восемь одинаковых у каждой кнопки: периметр у
              всех процентов общий, и повтор был бы шумом. Слова берутся из
              паспорта секции — второй редакции той же фразы здесь нет. */}
          {quarterPerimeter && (
            <div
              className="px-1 pb-0.5 text-[9px] leading-tight text-zinc-400 dark:text-zinc-500"
              title={`Периметр этих процентов: ${perimeterLabel(quarterPerimeter)}`}
            >
              Исполнение {quarterPerimeter.span.label} · {quarterPerimeter.moment.label}
            </div>
          )}
          {visibleBlocks.map((vm) => (
            <button
              key={vm.dept}
              type="button"
              onClick={() => document.getElementById(`grbs-${vm.dept}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              aria-current={activeDept === vm.dept ? 'true' : undefined}
              title={
                `${vm.deptLabel} — исполнение ${quarterPerimeter?.span.label ?? 'квартала'}`
                + `${quarterPerimeter ? `, ${quarterPerimeter.moment.label}` : ''}.`
              }
              className={clsx(
                'flex items-center justify-between rounded-md border px-2 py-1 text-[11px] transition-colors',
                // Секция, до которой докрутили, подсвечена (работа 4.14):
                // колонка липкая, документ длинный, и без отметки читатель
                // терял место — «где я сейчас» приходилось искать глазами по
                // заголовкам. Цвет здесь дублируется положением метки
                // aria-current: подсветка не единственный носитель смысла.
                activeDept === vm.dept
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-transparent dark:bg-amber-950/40 dark:text-amber-200'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-transparent dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60',
              )}
            >
              <span>{vm.dept}</span>
              <span className={clsx(
                'tabular-nums font-medium',
                activeDept === vm.dept ? 'text-amber-900 dark:text-amber-100' : 'text-zinc-800 dark:text-zinc-100',
              )}>
                {vm.executionPct}
              </span>
            </button>
          ))}
          {/* Якорь секции закупок без финансирования (п.73в): она свёрнута и
              стоит между блоками ГРБС и подвалом — колесом до неё далеко, а
              именно она объясняет расхождение лимита с листом. */}
          <button
            type="button"
            onClick={() => document.getElementById('report-unfunded')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            title="Секция «Закупки, не обеспеченные финансированием» — строки без года плана, из-за которых лимит расходится с листом СВОД"
            className="mt-1 flex items-center gap-1.5 rounded-md border border-dashed border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-500 hover:border-zinc-400 dark:border-transparent dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700/60 transition-colors"
          >
            <BookOpen size={11} aria-hidden="true" />
            <span>Без денег ↓</span>
          </button>
          {/* Якорь ленты изменений в оглавлении (п.73б): блок — в самом низу. */}
          <button
            type="button"
            onClick={() => document.getElementById('report-changes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            title="Лента «Что изменилось с последнего среза» — в самом низу страницы"
            className="mt-1 flex items-center gap-1.5 rounded-md border border-dashed border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-500 hover:border-zinc-400 dark:border-transparent dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700/60 transition-colors"
          >
            <History size={11} aria-hidden="true" />
            <span>Изменения ↓</span>
          </button>
        </nav>
      )}
      <div className="min-w-0 flex-1 space-y-4">
      {/* Панель управления отчётом: ярус 1 — что это и режим + действия;
          ярус 2 — период и служебные оговорки. Карточка, не россыпь. */}
      <div className="analytics-chart-card px-4 py-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {asOfDate
            ? isLive
              ? `Отчёт по закупкам · ${asOfDate}`
              : `Отчёт по закупкам на ${asOfDate}`
            : 'Отчёт по закупкам'}
        </h2>
        {/* Переключатель режима — управление, а не подпись: читателю нужно
            уметь ВЕРНУТЬСЯ в эфир, а не только видеть, где он находится.
            Обводка у него остаётся в ОБЕИХ темах: канон п.129 снимает рамку с
            поверхностей, а не с органов управления — без края переключатель
            перестаёт читаться как нажимаемый и становится просто подписью. */}
        <div className="inline-flex rounded-md border border-zinc-200 dark:border-transparent overflow-hidden">
          <button
            onClick={() => setMode('live')}
            aria-pressed={mode === 'live'}
            title="Числа на текущий момент — как считает официальный лист СВОД."
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium transition',
              mode === 'live'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700/40',
            )}
          >
            <span className={clsx(
              'inline-block w-1.5 h-1.5 rounded-full',
              mode === 'live' ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600',
            )} />
            В прямом эфире
          </button>
          <button
            onClick={() => setMode('archive')}
            aria-pressed={mode === 'archive'}
            title="Снимок недели: заключённое после даты среза в числа не входит."
            className={clsx(
              'px-2 py-0.5 text-[10px] font-medium border-l border-zinc-200 dark:border-zinc-700/50 transition',
              mode === 'archive'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                : 'bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700/40',
            )}
          >
            Архив недели
          </button>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={onCopy}
            disabled={!report}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            {copied ? <ClipboardCheck size={12} /> : <ClipboardCopy size={12} />}
            {copied ? 'Скопировано' : 'Копировать текстом'}
          </button>
          {/* Локальная выгрузка: документ собирается в браузере и падает в
              «Загрузки» — без роута и без записи на сервер, поэтому работает
              и на публичном стенде только для чтения. */}
          <button
            onClick={() => void onDownloadDocx('main')}
            disabled={!report || saving !== null}
            title="Основной отчёт в формате Word — вёрстка ручного отчёта по закупкам"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            <FileDown size={12} />
            {saving?.kind === 'main' ? saving.stage : 'Отчёт в Word'}
          </button>
          <button
            onClick={() => void onDownloadDocx('extra')}
            disabled={!report || saving !== null}
            title="Дополнительно к отчету по закупкам — записка руководителю в формате Word"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            <FileDown size={12} />
            {saving?.kind === 'extra' ? saving.stage : 'Допотчёт в Word'}
          </button>
        </div>
      </div>

      {/* Ярус 2: период и служебные оговорки */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Выбор квартала — тот же род, что и переключатель режима выше:
            край группы и линии между кнопками остаются в обеих темах. */}
        <div className="inline-flex rounded-md border border-zinc-200 dark:border-transparent overflow-hidden">
          {QUARTERS.map((q) => (
            <button
              key={q}
              onClick={() => setLocalQuarter(q)}
              aria-pressed={request.quarter === q}
              className={clsx(
                'px-2.5 py-0.5 text-[10px] font-medium transition-colors border-l border-zinc-200 dark:border-zinc-700/50 first:border-l-0',
                request.quarter === q
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700/40',
              )}
            >
              {q} кв
            </button>
          ))}
        </div>
        <span className="text-[10px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
          {request.year} год{activeQuarter ? ` · ${quarterLabel(activeQuarter)}` : ''}
          {' · '}
          {localQuarter === null ? 'квартал из шапки' : 'квартал выбран на странице'}
        </span>
        {/* Возврат к кварталу из шапки (работа P1-6 карты вкладки): кнопки
            выше кладут квартал в местное состояние страницы, и обратной
            дороги к «как в шапке» не было — читателю приходилось угадывать,
            какой квартал стоял в глобальном фильтре, и жать его руками. */}
        {localQuarter !== null && (
          <button
            type="button"
            onClick={() => setLocalQuarter(null)}
            title="Вернуть квартал, выбранный в шапке приложения: страница перестанет держать собственный."
            className="px-2 py-0.5 rounded text-[10px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            вернуть квартал из шапки
          </button>
        )}
        {/* Ссылка на официальную книгу СВОД; каноническая оговорка серии — тултипом */}
        {report?.svodOnlineUrl && (
          <a
            href={report.svodOnlineUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Показатели отчёта — на дату среза; СВОД онлайн живёт и может незначительно отличаться."
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
          >
            <ExternalLink size={11} />
            СВОД онлайн
          </a>
        )}
        {/* Подтверждение от сервера: режим ответа мог разойтись с кнопкой
            (запрос в полёте, устаревший ответ) — тогда честнее показать факт. */}
        {report && isLive !== (mode === 'live') && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
            показан режим «{isLive ? 'в прямом эфире' : 'архив недели'}»
          </span>
        )}
        {/* В эфире выбранная неделя не участвует — говорим об этом прямо,
            иначе колесо выглядит работающим, а числа его игнорируют. */}
        {mode === 'live' && ctx.weekStart !== null && (
          <span
            className="text-[10px] text-zinc-500 dark:text-zinc-400"
            title="Переключитесь в «Архив недели», чтобы увидеть снимок выбранной недели."
          >
            неделя из фильтра не применена
          </span>
        )}
        {/* Кнопка-якорь к ленте изменений (п.73б): блок живёт в самом низу
            страницы (п.35), и без якоря до него — вся страница колесом. */}
        {report && (
          <button
            type="button"
            onClick={() => document.getElementById('report-changes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            title="Перейти к ленте «Что изменилось с последнего среза» — она в самом низу страницы"
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <History size={11} aria-hidden="true" />
            Что изменилось ↓
          </button>
        )}
      </div>

      {/* Ярус 3 — плашки о фильтрах шапки, которые отчёт НЕ применяет
          (канон п.58б, работа P0-1 карты вкладки). До 21.08 страница молчала
          о пяти осях сразу: управления, подведомственные, способ, бюджет,
          поиск. Крошка фильтра при этом висела в шапке, и читатель вправе
          был считать, что числа ниже уже сужены. Дом плашек — общий со
          «Сводом» (`components/report/FilterNotices.tsx`). */}
      <ReportFilterNotices
        ctx={ctx}
        orgMode={orgScope.mode}
        onNavigateRows={(filters) => navigateTo('data', filters)}
        onScrollUnfunded={() => document.getElementById('report-unfunded')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />
      </div>
      {downloadError && (
        <div className="text-[11px] text-red-600 dark:text-red-400">{downloadError}</div>
      )}

      {error ? (
        // Пустое состояние с причиной и действием (критерий «честная пустота»):
        // повтор запроса — на месте, дорога к чтению книг — на Пульт.
        <div className="analytics-chart-card">
          <EmptyState
            tone="problem"
            title={errorContent(error).title}
            description={errorContent(error).description}
            detail={error}
            action={{ label: 'Запросить отчёт заново', onClick: () => setRetry((r) => r + 1) }}
            secondaryAction={{ label: 'Открыть Пульт', onClick: () => navigateTo('dashboard') }}
          />
        </div>
      ) : !report ? (
        // Скелет вместо голого «Загрузка…»: видно, какой формы страница
        // собирается, а диктору объявлено, что идёт загрузка.
        <div className="space-y-4" role="status" aria-live="polite">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Собираем отчёт из книг управлений — это занимает несколько секунд.
          </p>
          <SkeletonKPIRow count={4} />
          <SkeletonChart />
          <SkeletonChart />
        </div>
      ) : (
        <>
          {/* Интегральная сводка — четыре яруса (переплавка 03.08): главные
              проценты крупно, способы рядом, деньги с составом бюджетов,
              остаток — сверкой нашего пересчёта с ярусом официального листа.
              Дельта «к прошлому снимку» — только у плиток с однозначным
              официальным аналогом (kpiDeltaFor, честность источников). */}
          {summary && (
            <SectionCard
              filterCtx={ctx}
              source={report.integralSummary.svodQuarter ? 'mixed' : 'calc'}
              title="Интегральная сводка"
              {...(quarterPerimeter ? { perimeter: quarterPerimeter } : {})}
              collapsible={false}
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {summary.hero.map((tile) => (
                  <KpiTile key={`${tile.metricKey}-${tile.periodBadge}`} filterCtx={ctx} {...tile} delta={kpiDeltaFor(tile, weekDeltas)} />
                ))}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
                {summary.methods.map((tile) => (
                  <KpiTile key={`${tile.metricKey}-${tile.periodBadge}`} filterCtx={ctx} {...tile} delta={kpiDeltaFor(tile, weekDeltas)} />
                ))}
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {summary.money.map((tile) => {
                  // Деньги года взяты с официального листа — доказательство
                  // показывает ячейку и честную причину «строк-слагаемых нет».
                  // Яруса листа нет (плитки живут нашим пересчётом) — клика нет.
                  const moneyProof = officialYearMoneyProof(report, tile.metricKey);
                  return (
                    <KpiTile
                      key={`${tile.metricKey}-${tile.periodBadge}`}
                      filterCtx={ctx}
                      {...tile}
                      delta={kpiDeltaFor(tile, weekDeltas)}
                      footer={moneyFooter(tile)}
                      {...(moneyProof ? { onClick: () => setProof(moneyProof) } : {})}
                    />
                  );
                })}
              </div>

              {/* Перекрёстная ссылка яруса денег (работа P1-7 карты вкладки):
                  лимит года взят с официального листа, а расходится он с нашим
                  пересчётом ровно на строки без года плана — они собраны в
                  отдельной секции ниже. Без этой двери читатель видел
                  расхождение в подсказке плитки и не знал, где смотреть. */}
              {report.unfunded && report.unfunded.count > 0 && (
                <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                  Лимит года — с официального листа. Наш пересчёт видит сверх него{' '}
                  {fmtCount(report.unfunded.count)} строк на {fmtThousands(report.unfunded.total)} тыс. руб.
                  без проставленного года плана: лист их не считает.{' '}
                  <button
                    type="button"
                    onClick={() => document.getElementById('report-unfunded')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    title="Открыть секцию «Закупки, не обеспеченные финансированием» — те самые строки, с адресом каждой в листе"
                    className="font-medium text-cyan-700 hover:underline dark:text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    показать эти строки ↓
                  </button>
                </p>
              )}

              <RemainderLedger rows={summary.remainder} diff={summary.remainderDiff} byMethod={summary.remainderByMethod} />
            </SectionCard>
          )}

          {/* Блоки по ГРБС */}
          {visibleBlocks.length === 0 ? (
            <div className="analytics-chart-card px-5 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              В снапшоте нет данных по управлениям за выбранный период.
            </div>
          ) : (
            visibleBlocks.map((vm) => (
              <div key={vm.dept} id={`grbs-${vm.dept}`} className="scroll-mt-4">
                <GrbsSection vm={vm} quarter={report.period.quarter} year={report.period.year} ctx={ctx} perimeter={quarterPerimeter!} onProof={setProof} onOpenRows={navigateTo} />
              </div>
            ))
          )}

          {/* Закупки, не обеспеченные финансированием (имя класса — канон
              п.23 интервью 14.08.2026), решение 07.08: строки без сроков
              видны отдельно, внизу, с разбивкой по ГРБС. Эти же строки —
              причина расхождения лимита с листом СВОД. */}
          {report.unfunded && (
            // Якорь секции (п.73в): к ней ведут плашки о фильтрах из шапки и
            // плитка лимита — без якоря дорога сюда была только колесом.
            <div id="report-unfunded" className="scroll-mt-2">
            <SectionCard
              filterCtx={ctx}
              source="calc"
              title="Закупки, не обеспеченные финансированием"
              icon={Building2}
              {...(yearPerimeter ? { perimeter: yearPerimeter } : {})}
              defaultOpen={false}
            >
              <div className="space-y-3">
                {/* Периметр блока — собственной подписью (канон п.58): строки
                    без года плана не принадлежат ни кварталу, ни неделе —
                    квартальные кнопки шапки этот блок не сужают. */}
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                  Весь {request.year} год · все управления · на текущий момент · выбор квартала на блок не действует
                </p>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {/* Карточка БЗ — из kb-additions (п.91): запись описывает
                      именно этот итог, а не общий план, как прежний ключ. */}
                  <KBTooltip {...kbCardProps(DASHBOARD_REPORT_KB_ADDITIONS.unfunded_total)}>
                    {(() => {
                      // Районный итог доказывается строками всех управлений —
                      // теми же, что развёрнуты ниже по управлениям.
                      const districtProof = unfundedProof(report);
                      const amount = (
                        <span className="text-2xl font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
                          {fmtThousands(report.unfunded.total)}
                        </span>
                      );
                      return districtProof
                        ? <ProofButton proof={districtProof} onOpen={setProof}>{amount}</ProofButton>
                        : amount;
                    })()}
                  </KBTooltip>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    тыс. руб. в {fmtCount(report.unfunded.count)} позициях без сроков (год плана не проставлен)
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Способ и плановые деньги у строк есть, а сроков нет — закупки не обеспечены
                  финансированием. Формулы листа СВОД такие строки не видят, поэтому официальный
                  лимит меньше нашего расчёта ровно на эту сумму. По каждой строке нужно решение:
                  подтвердить финансирование и проставить сроки — либо вынести из плана.
                </p>
                {/* Честная пустота режима подведов: у выбранного управления
                    таких строк нет вовсе — говорим словами, а не отсутствием
                    блока (в byDept входят только управления со строками). */}
                {orgScope.mode === 'withSubs'
                  && !report.unfunded.byDept.some((d) => d.dept === orgScope.dept) && (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    У выбранного управления закупок, не обеспеченных финансированием, нет —
                    ни у аппарата, ни у подведомственных.
                  </p>
                )}
                {report.unfunded.byDept.map((d) => {
                  const deptProof = unfundedProof(report, d.dept);
                  const deptTotals = (
                    <span className="text-zinc-400 dark:text-zinc-500">
                      {fmtCount(d.count)} поз. · {fmtThousands(d.total)} тыс. руб.
                    </span>
                  );
                  // Режим подведов: у выбранного «с подведомственными» ГРБС
                  // блок раскладывается по учреждениям (аппарат первым,
                  // подведы по алфавиту — канон org-scope); прочие ГРБС
                  // остаются плоским списком — документ целиком.
                  const grouped = orgScope.mode === 'withSubs' && d.dept === orgScope.dept && orgScope.hasSubs
                    ? orgScope.subordinates
                    : null;
                  const emptyGroups = grouped?.filter((g) => g.rows.length === 0) ?? [];
                  return (
                  <div key={d.dept}>
                    <div className="mb-1 flex items-baseline gap-2 text-[11px]">
                      <span className="font-semibold text-zinc-700 dark:text-zinc-200">{d.deptLabel}</span>
                      {deptProof
                        ? <ProofButton proof={deptProof} onOpen={setProof}>{deptTotals}</ProofButton>
                        : deptTotals}
                    </div>
                    {grouped ? (
                      <div className="space-y-2">
                        {grouped.filter((g) => g.rows.length > 0).map((g) => (
                          <div key={g.key}>
                            <div className="mb-0.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                              {g.label}
                              <span className="ml-1.5 font-normal tabular-nums text-zinc-400 dark:text-zinc-500">
                                {fmtCount(g.rows.length)} поз. · {fmtThousands(g.rows.reduce((s, p) => s + p.planTotal, 0))} тыс. руб.
                              </span>
                            </div>
                            <ExpandableRows
                              rows={g.rows}
                              top={3}
                              noun="позиций"
                              searchText={(p) => `${p.subject} ${p.method}`}
                            >
                              {(p) => <UnfundedPositionRow key={p.sheetRow} p={p} dept={d.dept} showSubordinate={false} />}
                            </ExpandableRows>
                          </div>
                        ))}
                        {/* Честная пустота: организация есть, строк нет —
                            отличается от «организации нет» (канон org-scope). */}
                        {emptyGroups.length > 0 && (
                          <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                            {emptyGroups.length <= 4
                              ? `Таких строк нет: ${emptyGroups.map((g) => g.label).join(', ')}.`
                              : `Таких строк нет ещё у ${fmtCount(emptyGroups.length)} организаций управления.`}
                          </p>
                        )}
                      </div>
                    ) : (
                      <ExpandableRows
                        rows={d.positions}
                        top={3}
                        noun="позиций"
                        searchText={(p) => `${p.subject} ${p.subordinate} ${p.method}`}
                      >
                        {(p) => <UnfundedPositionRow key={p.sheetRow} p={p} dept={d.dept} />}
                      </ExpandableRows>
                    )}
                    {/* Оговорки режима — словами, не молчанием (канон org-scope):
                        подведов нет вообще / разбивка выключена самим читателем. */}
                    {orgScope.mode === 'withSubs' && d.dept === orgScope.dept && !orgScope.hasSubs && (
                      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                        У этого управления подведомственных учреждений нет — все строки аппарата.
                      </p>
                    )}
                    {orgScope.mode === 'grbs' && d.dept === orgScope.dept && orgScope.hasSubs && (
                      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                        Разбивка по подведомственным не строится: в фильтре организаций выбран режим «только ГРБС».
                      </p>
                    )}
                  </div>
                  );
                })}
              </div>
            </SectionCard>
            </div>
          )}

          {/* Честные плашки: чего в отчёте нет и почему */}
          {report.notes.length > 0 && (
            <div className="analytics-chart-card px-5 py-3">
              <div className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-1">
                Примечания
              </div>
              <ul className="space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {report.notes.map((note) => (
                  <li key={note}>— {note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Подвал доверия: методология счёта — текст сервера, свёрнут по умолчанию */}
          {report.methodology && (
            <SectionCard filterCtx={ctx} source="calc" title="Методология" icon={BookOpen} defaultOpen={false}>
              <div className="space-y-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                <p>
                  Каждое число отчёта либо пересчитано системой из строк книг ГРБС,
                  либо взято из официального СВОДа как есть. Ниже — точные правила счёта.
                </p>
                <p className="text-zinc-500 dark:text-zinc-400">{report.methodology}</p>
              </div>
            </SectionCard>
          )}

          {/* «Что изменилось с последнего среза» — В САМОМ НИЗУ страницы
              (пп. 35/73б интервью 14.08.2026 — долг закрыт): лента провенанса
              идёт после чисел отчёта, а не перед ними. Единый провенанс
              (бритва Оккама): итоги недели в цифрах (снимки СВОДа) + правки
              книг с авторами (журналы _ChangeLog); для читателя это одна
              система, источник — деталь реализации. Кнопка-якорь к блоку
              живёт в шапке страницы (п.73б). */}
          <div id="report-changes" className="scroll-mt-4">
            <SectionCard filterCtx={ctx} source="mixed" title="Что изменилось с последнего среза" icon={History} {...(yearPerimeter ? { perimeter: yearPerimeter } : {})}>
              <div className="space-y-5">
                <WeekDeltaBody state={weekDelta} />
                {/* Изоляция управлений (п.127): под выбранным ГРБС лента
                    показывает правки только его книг. Отчёт-документ фильтр
                    не сужает, но провенанс правок — не документ. */}
                <ChangesSection since={request.asOf} depts={ctx.grbs} />
                {/* Обратный якорь (шов п.91): вниз читателя привела кнопка
                    «Что изменилось ↓» из шапки — обратно наверх без него
                    пришлось бы крутить всю страницу колесом. */}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    title="Вернуться к шапке отчёта"
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    Наверх ↑
                  </button>
                </div>
              </div>
            </SectionCard>
          </div>
        </>
      )}
      </div>
      {/* Доказательство раскрывается поверх страницы: читатель не теряет
          место в документе и возвращается к числу тем же кликом. */}
      <ProofOverlay proof={proof} onClose={() => setProof(null)} />
    </div>
  );
}
