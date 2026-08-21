/**
 * Портрет управления на Пульте (приказ владельца 20.08.2026: когда в фильтре
 * выбрано одно управление — большая карточка-портрет на видном месте сетки).
 *
 * Что показывает и по каким правилам:
 *   • исполнение по количеству процедур и по сумме — те же числа, что считает
 *    слой метрик (useMultiDimMetrics); нулевой знаменатель — «плана нет»,
 *    не «исполнено 0 %»;
 *   • динамику по кварталам — квартал без плана честно подписан, дельта
 *    существует только между кварталами с планом;
 *   • замечания по родам — сгруппированные сигналы книги с адресами строк
 *    (канон п.119: по каждому сигналу виден ответ какая строка/что/почему)
 *    и переходом в Контроль; изоляция п.127 обеспечена входом — сюда
 *    приходят уже отфильтрованные замечания;
 *   • подведы — режим подведов (org-scope): «с подведомственными» даёт
 *    таблицу по учреждениям, «только ГРБС» — честную оговорку, отсутствие
 *    подведов — словами, а не пустотой;
 *   • свежесть — момент чтения книг, тот же, что в паспорте данных.
 */
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { ORG_ITSELF_SENTINEL, productLabel, quarterLabel } from '@aemr/shared';
import type { Page } from '../../store';
import type { DeptMetrics } from '../../hooks/useMultiDimMetrics';
import type { OrgScope } from '../../lib/selectors/org-scope';
import { KBTooltip } from '../ui/kb-tooltip';
import { PeriodBadge } from '../PeriodBadge';
import { formatPercent } from '../HeroKPICard';
import { getThresholdColor } from '../../lib/metrics-registry';
import { pluralRu } from '../../lib/economy-copy';
import { CARD, TILE, RULE_HEAD } from './surfaces';

const QUARTER_LABELS = [1, 2, 3, 4].map(quarterLabel);

/** Подпись рода сигнала из словаря продукта; латиница на экран не выходит. */
function issueKindLabel(key: string, fallbackTitle?: string): string {
  const label = productLabel(key);
  const untranslated = /[A-Za-z_]/.test(label) && !/[А-Яа-яЁё]/.test(label);
  if (!untranslated) return label;
  return fallbackTitle && /[А-Яа-яЁё]/.test(fallbackTitle) ? fallbackTitle : 'Род без подписи в словаре';
}

/** Адрес строки-основания: лист · строка (канон «двойной адрес» без выдумки). */
function issueAddress(iss: any): string | null {
  const sheet = iss.sheet ? String(iss.sheet) : null;
  const row = iss.row ?? null;
  const seq = iss.rowSeq ?? null;
  if (!sheet && row == null) return null;
  const rowPart = row != null ? `стр ${row}` : null;
  const seqPart = seq != null ? `№ п/п ${seq}` : null;
  return [sheet, rowPart ?? seqPart].filter(Boolean).join(' · ');
}

interface IssueKind {
  key: string;
  label: string;
  count: number;
  criticalCount: number;
  addresses: string[];
  searchSeed: string;
}

/** Группировка замечаний по родам (механизм → счёт → адреса). */
function groupIssueKinds(issues: any[]): IssueKind[] {
  const map = new Map<string, IssueKind & { _title?: string }>();
  for (const iss of issues) {
    const key = String(iss.signal ?? iss.checkId ?? iss.category ?? iss.title ?? 'прочее');
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label: issueKindLabel(key, iss.title),
        count: 0,
        criticalCount: 0,
        addresses: [],
        // Срез Контроля режется поиском по заголовку — сеем заголовком
        // самого замечания, а не выдуманной строкой.
        searchSeed: String(iss.title ?? ''),
      };
      map.set(key, g);
    }
    g.count += 1;
    if (iss.severity === 'critical' || iss.severity === 'error') g.criticalCount += 1;
    const addr = issueAddress(iss);
    if (addr && g.addresses.length < 3 && !g.addresses.includes(addr)) g.addresses.push(addr);
  }
  return [...map.values()].sort((a, b) => b.criticalCount - a.criticalCount || b.count - a.count);
}

/** Большое число исполнения с честной пустотой. */
function ExecFigure({ label, pct, detail, metricKey }: {
  label: string;
  pct: number | null;
  detail: string;
  metricKey: string;
}) {
  const color = pct != null ? getThresholdColor(metricKey, pct) : '';
  return (
    <div className={`${TILE} rounded-xl px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-medium">{label}</div>
      {pct != null ? (
        <div className={`text-2xl font-bold tabular-nums leading-tight mt-1 ${color || 'text-zinc-800 dark:text-zinc-100'}`}>
          {formatPercent(pct)}
        </div>
      ) : (
        <div className="text-sm font-medium text-zinc-400 dark:text-zinc-500 mt-2">Плана за период нет</div>
      )}
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">{detail}</div>
    </div>
  );
}

export interface DeptPortraitProps {
  /** Метрики единственного выбранного управления (слой useMultiDimMetrics). */
  dm: DeptMetrics;
  /** Режим подведов страницы (org-scope). */
  scope: OrgScope;
  /** Замечания книги управления — уже отфильтрованные (изоляция п.127). */
  issues: any[];
  /** Момент чтения книг — тот же, что в паспорте данных. */
  lastRefreshed: string | null;
  formatMoney: (v: number) => string;
  navigateTo: (page: Page, params?: any) => void;
}

export function DeptPortrait({ dm, scope, issues, lastRefreshed, formatMoney, navigateTo }: DeptPortraitProps) {
  const kinds = useMemo(() => groupIssueKinds(issues), [issues]);
  const totalIssues = issues.length;

  // Числа исполнения подчиняются режиму подведов: «только ГРБС» — метрики
  // аппарата (orgSelf), не книги целиком; иначе срез, который пользователь
  // сознательно сузил, показывал бы суммы с подведами (ложь периметра).
  const grbsOnly = scope.mode === 'grbs';
  const scoped = grbsOnly && dm.orgSelf ? dm.orgSelf.metrics : dm.total;

  // Динамика по кварталам — тем же срезом, что и числа исполнения: в режиме
  // «только ГРБС» кварталы аппарата из сырого узла _org_itself, иначе — слоя
  // метрик. Квартал без плана — null («нет плана»), не ноль.
  const quarterRows = useMemo(() => {
    if (!grbsOnly) return dm.quarters.map((q) => ({ quarter: q.quarter, execPct: q.execPct }));
    const rawSelf = (dm.raw?.subordinates ?? []).find((s: any) => s.name === ORG_ITSELF_SENTINEL);
    return (['q1', 'q2', 'q3', 'q4'] as const).map((qk) => {
      const q = rawSelf?.quarters?.[qk];
      const plan = q?.planTotal ?? 0;
      const fact = q?.factTotal ?? 0;
      return { quarter: qk, execPct: plan > 0 ? +((fact / plan) * 100).toFixed(1) : null };
    });
  }, [grbsOnly, dm.quarters, dm.raw]);

  // Дельта — между последними двумя кварталами с планом того же среза.
  const quarterDelta = useMemo(() => {
    const known = quarterRows.filter((q) => q.execPct != null);
    if (known.length < 2) return null;
    return (known[known.length - 1].execPct as number) - (known[known.length - 2].execPct as number);
  }, [quarterRows]);

  const refreshedAt = lastRefreshed ? new Date(lastRefreshed) : null;
  const refreshedLabel = refreshedAt && !Number.isNaN(refreshedAt.getTime())
    ? refreshedAt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;

  // Топ подведов за период — по плановой сумме; берётся готовый слой метрик,
  // второй формулы здесь нет. Подвед без плана в топ не рвётся, но и не
  // выбрасывается: показываем до шести строк, остальное — счётом.
  const topSubs = useMemo(
    () => [...dm.realSubs].sort((a, b) => b.metrics.planTotal - a.metrics.planTotal).slice(0, 6),
    [dm.realSubs],
  );
  const restSubs = dm.realSubs.length - topSubs.length;

  // Шкала полос динамики — от ста, чтобы «исполнено 34 %» не выглядело
  // заполненной до края шкалой; факт выше плана растягивает шкалу честно.
  const maxQuarterPct = Math.max(100, ...quarterRows.map((q) => q.execPct ?? 0));

  return (
    <section
      aria-label={`Портрет управления ${dm.dept}`}
      className={`${CARD} rounded-2xl shadow-sm dark:shadow-none p-5 hover:shadow-lg transition-shadow duration-300`}
    >
      {/* Шапка портрета: имя, режим подведов, период и свежесть */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100 leading-tight">
            {dm.deptName}
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Портрет управления {dm.dept}
            {scope.mode === 'grbs' && ' · показан только аппарат: в фильтре выбран режим «только ГРБС»'}
            {scope.mode === 'withSubs' && dm.realSubCount > 0 &&
              ` · с подведомственными (${dm.realSubCount} ${pluralRu(dm.realSubCount, 'учреждение', 'учреждения', 'учреждений')})`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <PeriodBadge />
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            {refreshedLabel
              ? <>книга прочитана {refreshedLabel}</>
              : 'время чтения книги сервер не записал'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* Исполнение: два измерения, честные пустоты */}
        <div className="xl:col-span-1 space-y-2">
          <KBTooltip metric="exec_count_pct">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Исполнение плана{grbsOnly ? ' · только аппарат' : ''}
            </h3>
          </KBTooltip>
          <ExecFigure
            label="По количеству процедур"
            pct={scoped.execCountPct}
            metricKey="dept_exec_count_pct"
            detail={scoped.planCount > 0
              ? `заключено ${scoped.factCount} из ${scoped.planCount} ${pluralRu(scoped.planCount, 'процедуры', 'процедур', 'процедур')}`
              : 'плановых процедур за период в книге нет'}
          />
          <ExecFigure
            label="По сумме"
            pct={scoped.executionPct}
            metricKey="dept_exec_amount_pct"
            detail={scoped.planTotal > 0
              ? `факт ${formatMoney(scoped.factTotal)} из плана ${formatMoney(scoped.planTotal)}`
              : 'плановых сумм за период в книге нет'}
          />
        </div>

        {/* Динамика по кварталам */}
        <div className="xl:col-span-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            Динамика исполнения по сумме{grbsOnly ? ' · только аппарат' : ''}
          </h3>
          <div className="space-y-1.5">
            {quarterRows.map((q, i) => (
              <div key={q.quarter} className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 w-9 shrink-0 tabular-nums">{QUARTER_LABELS[i]}</span>
                <div className="flex-1 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  {q.execPct != null && (
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-700 ease-out"
                      style={{ width: `${Math.min(100, (q.execPct / maxQuarterPct) * 100)}%` }}
                    />
                  )}
                </div>
                {q.execPct != null ? (
                  <span className="text-[11px] font-semibold tabular-nums text-zinc-700 dark:text-zinc-200 w-14 text-right">
                    {formatPercent(q.execPct)}
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 w-14 text-right">нет плана</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2">
            {quarterDelta != null
              ? <>К предыдущему кварталу с планом: <strong className={quarterDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                  {quarterDelta >= 0 ? '+' : ''}{quarterDelta.toFixed(1).replace('.', ',')} п.п.
                </strong> по сумме</>
              : 'Сравнивать кварталы не с чем: план был меньше чем в двух кварталах.'}
          </p>
        </div>

        {/* Замечания по родам с адресами (п.119) */}
        <div className="xl:col-span-1">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Замечания книги
            </h3>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">{totalIssues}</span>
          </div>
          {/* Скоуп блока свой (канон п.58): проверки идут по всем строкам книги
              на момент чтения, выбор периода в шапке их не сужает. */}
          <p className="text-[9px] text-zinc-400 dark:text-zinc-500 mb-1.5">
            все строки книги · на момент чтения · период не действует
          </p>
          {kinds.length === 0 ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              Проверки по книге управления прошли чисто — замечаний нет.
            </p>
          ) : (
            <ul className="space-y-1">
              {kinds.slice(0, 4).map((k) => (
                <li key={k.key}>
                  <button
                    type="button"
                    onClick={() => navigateTo('quality', { qualityTab: 'issues', search: k.searchSeed })}
                    title={`Открыть «${k.label}» в Контроле — ${k.count} ${pluralRu(k.count, 'запись', 'записи', 'записей')}`}
                    className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200 leading-tight">{k.label}</span>
                      <span className={`text-[11px] font-bold tabular-nums ${k.criticalCount > 0 ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}>
                        {k.count}
                      </span>
                    </span>
                    {k.addresses.length > 0 && (
                      <span className="block text-[9px] text-zinc-400 dark:text-zinc-500 font-mono mt-0.5 truncate">
                        {k.addresses.join(' · ')}{k.count > k.addresses.length ? ` и ещё ${k.count - k.addresses.length}` : ''}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {kinds.length > 4 && (
                <li className="text-[10px] text-zinc-400 dark:text-zinc-500 px-2">
                  и ещё {kinds.length - 4} {pluralRu(kinds.length - 4, 'род', 'рода', 'родов')} — целиком в Контроле
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Подведы: разбивка, оговорка режима или честное отсутствие */}
        <div className="xl:col-span-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            Подведомственные по плановой сумме
          </h3>
          {scope.mode === 'grbs' ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {scope.hasSubs
                ? 'Подведы скрыты: в фильтре выбран режим «только ГРБС». Чтобы увидеть разбивку, выберите управление с подведомственными.'
                : 'У этого управления подведомственных учреждений нет — закупки ведёт сам аппарат.'}
            </p>
          ) : !scope.hasSubs && dm.realSubCount === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              У этого управления подведомственных учреждений нет — все строки книги принадлежат аппарату.
            </p>
          ) : topSubs.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Строк подведов в выборке за период нет — суммы управления сложены из закупок аппарата.
            </p>
          ) : (
            <ul className="space-y-1">
              {topSubs.map((s) => (
                <li key={s.name}>
                  <button
                    type="button"
                    onClick={() => navigateTo('data', { department: dm.deptId, subordinate: s.name })}
                    title={`Открыть строки «${s.displayName}» в Реестре`}
                    className="w-full flex items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    <span className="text-[11px] text-zinc-700 dark:text-zinc-200 truncate flex-1">{s.displayName}</span>
                    <span className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">{formatMoney(s.metrics.planTotal)}</span>
                    {s.metrics.executionPct != null ? (
                      <span className={`text-[11px] font-semibold tabular-nums w-12 text-right shrink-0 ${getThresholdColor('dept_exec_amount_pct', s.metrics.executionPct)}`}>
                        {formatPercent(s.metrics.executionPct)}
                      </span>
                    ) : (
                      <span className="text-[9px] text-zinc-400 dark:text-zinc-500 w-12 text-right shrink-0">нет плана</span>
                    )}
                  </button>
                </li>
              ))}
              {restSubs > 0 && (
                <li className="text-[10px] text-zinc-400 dark:text-zinc-500 px-2">
                  и ещё {restSubs} {pluralRu(restSubs, 'учреждение', 'учреждения', 'учреждений')} — в рейтинге ниже
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Переходы к строкам-основаниям */}
      <div className={`flex items-center justify-end gap-4 pt-3 mt-3 border-t ${RULE_HEAD}`}>
        <button
          type="button"
          onClick={() => navigateTo('data', { department: dm.deptId })}
          className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          Строки управления в Реестре <ArrowRight size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => navigateTo('quality', { qualityTab: 'issues' })}
          className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          Замечания в Контроле <ArrowRight size={12} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
