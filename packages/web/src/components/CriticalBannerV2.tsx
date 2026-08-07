import { useEffect, useRef, useState } from 'react';
import { productLabel } from '@aemr/shared';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  AlertOctagon,
} from 'lucide-react';
import { Badge } from './ui/badge';
import { pluralRu } from '@/lib/economy-copy';

// ────────────────────────────────────────────────────────────────
// CriticalBannerV2 — полоса замечаний над Пультом.
//
// Правила, которые держит компонент:
//   • Числа согласованы с существительным: «1 замечание», «2 замечания»,
//     «5 замечаний» — через единственный дом склонения pluralRu.
//   • Ни один внутренний ключ не доходит до глаз: подписи берутся из
//     productLabel; если словарь ключ не знает, латиница не показывается
//     вовсе — лучше промолчать, чем выдать имя переменной за текст.
//   • Клавиатура: раскрытие штатным поведением кнопки, Esc закрывает,
//     стрелки ходят по группам управлений.
// ────────────────────────────────────────────────────────────────

/**
 * Ключ не переведён словарём, если в ответе нет ни одной кириллической буквы,
 * а латиница есть. Такие строки в интерфейс не пускаем (закон продукта: ни
 * одного внутреннего обозначения в тексте для пользователя).
 */
function isUntranslated(value: string): boolean {
  return /[A-Za-z_]/.test(value) && !/[А-Яа-яЁё]/.test(value);
}

/** Человеческое имя управления либо честная замена, если ключ не распознан. */
function deptTitle(key: string): string {
  const label = productLabel(key);
  return isUntranslated(label) ? 'Без привязки к управлению' : label;
}

interface CriticalIssue {
  id?: string;
  signal?: string;
  severity: string;
  description?: string;
  department?: string;
  deptId?: string;
}

interface CriticalBannerV2Props {
  criticalCount: number;
  warningCount: number;
  issues?: CriticalIssue[];
  onNavigate: () => void;
}

const MAX_DISPLAY = 30;
const DESC_TRUNCATE = 120;

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function severityVariant(severity: string): 'critical' | 'error' | 'warning' | 'significant' {
  if (severity === 'critical') return 'critical';
  if (severity === 'error') return 'error';
  if (severity === 'significant') return 'significant';
  return 'warning';
}

/** Русские подписи серьёзности — сырые ключи (critical/warning…) в UI недопустимы (D15). */
const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Критическое',
  error: 'Ошибка',
  significant: 'Существенное',
  warning: 'Предупреждение',
  info: 'Информация',
};

/**
 * Подпись серьёзности. Незнакомый уровень не показывается сырым ключом:
 * словарь продукта возвращает ключ как есть, и на ярлыке появлялась бы
 * латиница вместо слова.
 */
function severityTitle(severity: string): string {
  const known = SEVERITY_LABELS[severity];
  if (known) return known;
  const label = productLabel(severity);
  return isUntranslated(label) ? 'Уровень не распознан' : label;
}

/** Склонение «замечание» по числу — через единственный дом склонения. */
function issuesWord(n: number): string {
  return pluralRu(n, 'замечание', 'замечания', 'замечаний');
}

/** Склонение «предупреждение» по числу. */
function warningsWord(n: number): string {
  return pluralRu(n, 'предупреждение', 'предупреждения', 'предупреждений');
}

/** Согласование сказуемого: «1 замечание требует», «3 замечания требуют». */
function requiresWord(n: number): string {
  return pluralRu(n, 'требует', 'требуют', 'требуют');
}

export function CriticalBannerV2({
  criticalCount,
  warningCount,
  issues = [],
  onNavigate,
}: CriticalBannerV2Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeGroupIdx, setActiveGroupIdx] = useState(0);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!expanded) return;
    const el = groupRefs.current[activeGroupIdx];
    el?.focus({ preventScroll: false });
  }, [activeGroupIdx, expanded]);

  // ── Замечаний нет ─────────────────────────────────────────
  if (criticalCount === 0 && warningCount === 0) {
    return (
      <div
        role="status"
        aria-label="Замечаний нет, состояние нормы"
        className={cn(
          'inline-flex items-center gap-2 px-3.5 py-2 rounded-full',
          'bg-emerald-50 dark:bg-emerald-950/30',
          'border border-emerald-200/70 dark:border-emerald-800/50',
          'text-emerald-700 dark:text-emerald-300',
          'select-none cursor-default',
        )}
      >
        <CheckCircle2 size={16} className="shrink-0" />
        <span className="text-xs font-semibold">Замечаний нет</span>
      </div>
    );
  }

  const isCritical = criticalCount > 0;
  const totalCount = criticalCount + warningCount;

  // ── Группировка по управлениям (порядок поступления сохраняется) ──
  const byDept = new Map<string, CriticalIssue[]>();
  for (const issue of issues) {
    const dept = issue.department ?? issue.deptId ?? 'Общие';
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept)!.push(issue);
  }

  // ── Предел показа: не больше MAX_DISPLAY записей на все группы.
  //    Сколько осталось за пределом — считаем здесь же и говорим вслух: молчать
  //    об отброшенных записях нельзя, иначе список выглядит полным. ──
  const groups: { dept: string; items: CriticalIssue[]; groupDropped: number }[] = [];
  let rendered = 0;
  let droppedTotal = 0;
  for (const [dept, deptIssues] of byDept) {
    const remaining = MAX_DISPLAY - rendered;
    if (remaining <= 0) {
      droppedTotal += deptIssues.length;
      continue;
    }
    const take = Math.min(remaining, deptIssues.length);
    const slice = deptIssues.slice(0, take);
    const groupDropped = deptIssues.length - take;
    droppedTotal += groupDropped;
    groups.push({ dept, items: slice, groupDropped });
    rendered += take;
  }

  const groupCount = groups.length;

  // ── Клавиатура ─────────────────────────────────────────────
  // Enter и Пробел здесь НЕ перехватываются: кнопка активируется ими сама, а
  // ручная обработка либо переключала состояние дважды, либо гасила щелчок —
  // поведение зависело от браузера. Остаётся только Esc.
  const handleBannerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      setExpanded(false);
    }
  };

  const handlePanelKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setExpanded(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (groupCount === 0) return;
      e.preventDefault();
      setActiveGroupIdx((idx) => {
        const next =
          e.key === 'ArrowDown'
            ? Math.min(groupCount - 1, idx + 1)
            : Math.max(0, idx - 1);
        return next;
      });
    }
  };

  return (
    <div className="space-y-1.5">
      {/* Полоса-кнопка: щелчок раскрывает список */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleBannerKey}
        aria-expanded={expanded}
        aria-controls="critical-banner-panel"
        title={expanded ? 'Свернуть список замечаний' : 'Развернуть список замечаний по управлениям'}
        className={cn(
          'w-full rounded-2xl px-5 py-3.5 flex items-center justify-between text-white transition-all duration-300 group relative overflow-hidden',
          // Рамка фокуса: полоса — кнопка, и идущий по табуляции должен видеть,
          // что стоит на ней. Смещение наружу, иначе рамка тонет в заливке.
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900',
          isCritical
            ? 'bg-gradient-to-r from-red-600 via-red-500 to-rose-500 dark:from-red-700 dark:via-red-600 dark:to-rose-600 hover:shadow-xl hover:shadow-red-500/20'
            : 'bg-gradient-to-r from-amber-500 via-amber-400 to-orange-400 dark:from-amber-600 dark:via-amber-500 dark:to-orange-500 hover:shadow-xl hover:shadow-amber-500/20',
        )}
      >
        {/* Пульсация — только для критических; смысл дублирован словами ниже */}
        {isCritical && (
          <div className="absolute inset-0 bg-gradient-to-r from-red-500/0 via-red-400/20 to-red-500/0 animate-pulse" />
        )}

        <div className="flex items-center gap-3 relative z-10">
          <div className={cn(
            'w-9 h-9 rounded-xl flex items-center justify-center',
            isCritical ? 'bg-white/15' : 'bg-white/15',
          )}>
            {isCritical ? <AlertOctagon size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div className="text-left">
            <div className="font-bold text-sm">
              {isCritical
                ? `${criticalCount} ${issuesWord(criticalCount)} ${requiresWord(criticalCount)} решения`
                : `${warningCount} ${warningsWord(warningCount)} ${requiresWord(warningCount)} внимания`}
            </div>
            {isCritical && warningCount > 0 && (
              <div className="text-xs opacity-75 mt-0.5">
                и ещё {warningCount} {warningsWord(warningCount)}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 relative z-10">
          {/* Общий счётчик: критические плюс предупреждения */}
          <span
            className="bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-lg text-xs font-bold tabular-nums"
            title={`Всего записей: ${totalCount} — критических ${criticalCount}, предупреждений ${warningCount}`}
          >
            {totalCount}
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn(
              'opacity-60 transition-transform duration-300',
              expanded && 'rotate-180',
            )}
          />
        </div>
      </button>

      {/* Раскрытый список замечаний по управлениям */}
      {expanded && (
        <div
          id="critical-banner-panel"
          role="region"
          aria-label="Список замечаний по управлениям"
          tabIndex={-1}
          onKeyDown={handlePanelKey}
          className={cn(
            'rounded-2xl border bg-white dark:bg-zinc-900 shadow-lg p-5 animate-in slide-in-from-top-2 fade-in-0 duration-200 outline-none',
            isCritical
              ? 'border-red-200/60 dark:border-red-700/30 shadow-red-500/5'
              : 'border-amber-200/60 dark:border-amber-700/30 shadow-amber-500/5',
          )}
        >
          {groups.length > 0 ? (
            <div className="space-y-4">
              {groups.map((group, gi) => (
                <div
                  key={group.dept}
                  ref={(el) => { groupRefs.current[gi] = el; }}
                  tabIndex={0}
                  role="group"
                  aria-label={`${deptTitle(group.dept)}: ${group.items.length} ${issuesWord(group.items.length)}`}
                  className={cn(
                    'outline-none rounded-lg px-1 -mx-1 transition-colors',
                    activeGroupIdx === gi && 'ring-1 ring-blue-300/40 bg-blue-50/30 dark:bg-blue-500/5',
                  )}
                  onFocus={() => setActiveGroupIdx(gi)}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                      {deptTitle(group.dept)}
                    </h4>
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold"
                      title={`${group.items.length} ${issuesWord(group.items.length)}`}
                    >
                      {group.items.length}
                    </span>
                  </div>
                  <div className="space-y-1.5 pl-3 border-l-2 border-zinc-100 dark:border-zinc-800">
                    {group.items.map((issue, i) => (
                      <div
                        key={issue.id ?? `${group.dept}-${i}`}
                        className="flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-400 py-0.5"
                      >
                        <Badge
                          variant={severityVariant(issue.severity)}
                          className="text-[9px] px-1.5 py-0 shrink-0 mt-0.5"
                        >
                          {severityTitle(issue.severity)}
                        </Badge>
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <span className="leading-relaxed">
                            {truncate(issue.description ?? 'Описание замечания не заполнено', DESC_TRUNCATE)}
                          </span>
                          {/* Имя сигнала показываем только когда словарь его знает:
                              нераспознанный ключ — это латиница, ей в тексте не место.
                              Моноширинный шрифт убран — это подпись, а не код. */}
                          {issue.signal && !isUntranslated(productLabel(issue.signal)) && (
                            <span className="text-[9px] text-zinc-400 dark:text-zinc-500">
                              {productLabel(issue.signal)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {group.groupDropped > 0 && (
                      <span className="text-[10px] text-zinc-400 pl-1">
                        …и ещё {group.groupDropped} {issuesWord(group.groupDropped)} у этого управления
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {droppedTotal > 0 && (
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 pt-1">
                  Здесь показаны первые {MAX_DISPLAY}. Ещё {droppedTotal} {issuesWord(droppedTotal)} —
                  на странице «Контроль», кнопка ниже.
                </p>
              )}
            </div>
          ) : (
            // Счётчик в полосе есть, а разбора нет: сервер прислал только итог.
            // Честно называем причину, а не отделываемся «нет детализации».
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Счётчик замечаний пришёл без построчного разбора — откройте страницу «Контроль»,
              там список читается из первичных строк.
            </p>
          )}

          <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate();
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              Все замечания на странице «Контроль»
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
