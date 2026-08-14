import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  AlertOctagon,
} from 'lucide-react';
import { pluralRu } from '@/lib/economy-copy';
import { DiagnosticCardList } from './DiagnosticCards';
import type { DiagnosticIssueLike } from '@/lib/diagnostics/mechanism-groups';

// ────────────────────────────────────────────────────────────────
// CriticalBannerV2 — полоса замечаний над Пультом.
//
// Раскрытие — карточки диагноста (канон п.53 интервью 14.08.2026), а не
// простыня «строка N: предмет»: владелец разрешил её удалить дословно
// (п.69д). Одна карточка = один механизм проверки; заголовок — механизм,
// не предмет закупки; адреса строк — раскрываемым списком внутри карточки;
// действие с адресатом — из реестра проверок. Сотни строк шума больше не
// хоронят настоящие ошибки.
//
// Правила, которые держит компонент:
//   • Числа согласованы с существительным: «1 замечание», «2 замечания»,
//     «5 замечаний» — через единственный дом склонения pluralRu.
//   • Ни один внутренний ключ не доходит до глаз: подписи механизмов и
//     управлений идут через словарь продукта; латиница на экран не выходит.
//   • Клавиатура: полоса и карточки — настоящие кнопки, Esc закрывает панель.
// ────────────────────────────────────────────────────────────────

interface CriticalBannerV2Props {
  criticalCount: number;
  warningCount: number;
  issues?: DiagnosticIssueLike[];
  onNavigate: () => void;
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
    }
  };

  return (
    <div className="space-y-1.5">
      {/* Полоса-кнопка: щелчок раскрывает карточки диагноста */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleBannerKey}
        aria-expanded={expanded}
        aria-controls="critical-banner-panel"
        title={expanded ? 'Свернуть разбор замечаний' : 'Развернуть разбор замечаний по механизмам проверок'}
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
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/15">
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

      {/* Раскрытые карточки диагноста: механизм + адреса + действие (п.53) */}
      {expanded && (
        <div
          id="critical-banner-panel"
          role="region"
          aria-label="Разбор замечаний по механизмам проверок"
          tabIndex={-1}
          onKeyDown={handlePanelKey}
          className={cn(
            'rounded-2xl border bg-white dark:bg-zinc-900 shadow-lg p-5 animate-in slide-in-from-top-2 fade-in-0 duration-200 outline-none',
            isCritical
              ? 'border-red-200/60 dark:border-red-700/30 shadow-red-500/5'
              : 'border-amber-200/60 dark:border-amber-700/30 shadow-amber-500/5',
          )}
        >
          {/* Периметр панели — собственной подписью (канон п.58): замечания
              считаются по всем строкам книг на момент последнего чтения и
              выбору периода в шапке не подчиняются — лживый бейдж периода
              здесь запрещён. */}
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mb-3">
            Проверки всех строк книг · на момент последнего чтения · выбор периода в шапке на замечания не действует
          </p>

          {issues.length > 0 ? (
            <DiagnosticCardList issues={issues} />
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
