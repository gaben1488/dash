import * as React from 'react';
import { useState } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
import { useCoarsePointer } from '../../lib/coarse-pointer';
import {
  Info, ChevronDown, BookOpen, Scale, Lightbulb, AlertTriangle,
  ArrowRight, Link2, Cpu, Database, BarChart3, ExternalLink,
} from 'lucide-react';
import { officialProvenanceFor, type ProvenanceSource } from '../../lib/provenance-registry';
import { useStore } from '../../store';
import { MetricProvenance } from '../metric/MetricProvenance';
import { DivergenceMark } from '../metric/DivergenceMark';
import { provenanceCard } from '../metric/metric-provenance-view';

// ────────────────────────────────────────────────────────────────
// KBTooltip — 10-блочный KB на литературном русском
//
// ① Что это (whatIs)           — видно сразу
// ⑤ Пороги (thresholdsFull)   — видно сразу
// ⑦ Пример (example)          — видно сразу
// ②③④⑥⑧⑨⑩                   — раскрываются при клике "Подробнее"
//
// Используем Radix Tooltip (hover open, auto close on mouse leave).
// Внутри — expandable секции для глубокого контента.
//
// Ниже блоков БЗ живут два разных провенанса, и путать их нельзя:
//   • «Первичка сейчас» — какая ячейка какой книги дала ИМЕННО ЭТО число в
//     ИМЕННО ЭТОМ снимке; меняется с каждым обновлением данных;
//   • «Происхождение» (metric/MetricProvenance, канон п.104) — из какого из
//     пяти документов показатель родом вообще и совпадает ли наш счёт со
//     счётом документа; от снимка не зависит.
// ────────────────────────────────────────────────────────────────

export interface KBEntry {
  formula?: string;
  source?: string;
  cell?: string;
  thresholds?: string;
  law?: string;
  description?: string;
  whatIs?: string;
  howCalc?: string;
  dataSource?: string;
  engine?: string;
  thresholdsFull?: string;
  lawFull?: string;
  example?: string;
  pitfalls?: string;
  actions?: string;
  related?: string[];
  /**
   * ⑪ Скоуп и момент — за какой периметр и на какое время это число (карточка
   * 2.0). Постоянная часть приходит из карточки; изменчивую — выбранные
   * управления, период и время чтения — подставляет экран.
   */
  scopeMoment?: string;
  /** ⑫ Почему может разойтись с книгой или Сводом. */
  divergence?: string;
}

interface KBTooltipProps {
  metric?: string;
  formula?: string;
  source?: string;
  cell?: string;
  thresholds?: string;
  law?: string;
  description?: string;
  whatIs?: string;
  howCalc?: string;
  dataSource?: string;
  engine?: string;
  thresholdsFull?: string;
  lawFull?: string;
  example?: string;
  pitfalls?: string;
  actions?: string;
  related?: string[];
  scopeMoment?: string;
  divergence?: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  showIcon?: boolean;
  className?: string;
}

let _registry: Record<string, KBEntry> | null = null;

export function setKBRegistry(registry: Record<string, KBEntry>) {
  _registry = registry;
}

function getKB(metric?: string): KBEntry | null {
  if (!metric || !_registry) return null;
  return _registry[metric] ?? null;
}

// ── Section block ──
function Section({ icon, num, title, children, className }: {
  icon: React.ReactNode; num: string; title: string;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('', className)}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-[9px] font-bold text-zinc-500">{num}</span>
        <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-0.5">
          {icon}{title}
        </span>
      </div>
      <div className="text-[11px] leading-relaxed text-zinc-200 pl-3">
        {children}
      </div>
    </div>
  );
}

// ── Threshold lines with color dots ──
function ThresholdLine({ text }: { text: string }) {
  const lines = text.split('\n').filter(Boolean);
  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        // Пять зон, а не три: у грейда есть синяя середина, у вердикта сверки
        // — оранжевая «лист не считает» и серая «нечего сравнивать». Кружок
        // без своего цвета сводил бы их все к безымянному серому.
        const dotColor = trimmed.startsWith('🟢') ? 'bg-emerald-400'
          : trimmed.startsWith('🔴') ? 'bg-red-400'
          : trimmed.startsWith('🟡') ? 'bg-amber-400'
          : trimmed.startsWith('🔵') ? 'bg-blue-400'
          : trimmed.startsWith('🟠') ? 'bg-orange-400'
          : 'bg-zinc-400';
        return (
          <div key={i} className="flex items-start gap-1.5">
            <span className={cn('w-1.5 h-1.5 rounded-full mt-1 shrink-0', dotColor)} />
            <span className="text-[10px] text-zinc-300">{trimmed.replace(/^[🟢🟡🔴🔵🟠⚪]\s*/u, '')}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Law expandable ──
function LawBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n').filter(Boolean);
  const ref = lines[0] ?? text;
  const details = lines.slice(1).join('\n').trim();
  return (
    <div>
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setExpanded(!expanded); }}
        className="flex items-center gap-1 text-[10px] text-blue-300 hover:text-blue-200 transition-colors"
      >
        <Scale size={9} className="shrink-0" />
        <span className="underline underline-offset-2 decoration-blue-400/40">{ref}</span>
        <ChevronDown size={9} className={cn('transition-transform duration-200', expanded && 'rotate-180')} />
      </button>
      {expanded && details && (
        <p className="mt-1 text-[9px] text-zinc-400 leading-relaxed pl-3 border-l border-blue-500/20">
          {details}
        </p>
      )}
    </div>
  );
}

// ── Related metrics ──
function RelatedLinks({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(item => (
        <span key={item} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white/5 text-[9px] text-zinc-300 cursor-default">
          <Link2 size={7} className="shrink-0 opacity-50" />{item}
        </span>
      ))}
    </div>
  );
}

// ── Legacy content (fallback) ──
function LegacyContent({ entry }: { entry: KBEntry }) {
  const rows = [
    { label: 'Формула', value: entry.formula },
    { label: 'Источник', value: entry.source },
    { label: 'Ячейка', value: entry.cell },
    { label: 'Пороги', value: entry.thresholds },
    { label: 'Закон', value: entry.law },
  ].filter(r => r.value);
  if (rows.length === 0 && !entry.description) return null;
  return (
    <div className="space-y-1">
      {entry.description && <p className="text-[11px] text-zinc-300 leading-snug mb-1.5">{entry.description}</p>}
      {rows.map(({ label, value }) => (
        <div key={label} className="flex gap-2 text-[10px] leading-tight">
          <span className="text-zinc-500 shrink-0 w-14 font-medium">{label}:</span>
          <span className="text-zinc-300 font-mono break-all">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Full 10-block content ──
function FullKBContent({ entry }: { entry: KBEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasFullContent = entry.whatIs || entry.thresholdsFull || entry.example;
  const hasExpandable = entry.howCalc || entry.dataSource || entry.engine
    || entry.lawFull || entry.pitfalls || entry.actions || entry.divergence
    || (entry.related && entry.related.length > 0);

  if (!hasFullContent) return <LegacyContent entry={entry} />;

  return (
    <div className="space-y-2">
      {/* Always visible: ①⑤⑦ */}
      {entry.whatIs && (
        <p className="text-[11px] leading-relaxed text-zinc-100 font-medium">{entry.whatIs}</p>
      )}
      {/* ⑪ Скоуп и момент стоит сразу под механизмом и ДО порога: читатель,
          открывший объяснение, уже не видит плашку периметра на плитке, и без
          этой строки не знает, за что число (спека карточки 2.0, п.③). */}
      {entry.scopeMoment && (
        <Section icon={<Database size={8} />} num="⑪" title="Скоуп и момент">
          <p className="text-zinc-300 text-[10px]">{entry.scopeMoment}</p>
        </Section>
      )}
      {entry.thresholdsFull && (
        <Section icon={<BarChart3 size={8} />} num="⑤" title="Пороги">
          <ThresholdLine text={entry.thresholdsFull} />
        </Section>
      )}
      {entry.example && (
        <Section icon={<Lightbulb size={8} />} num="⑦" title="Пример">
          <div className="bg-white/5 rounded-lg px-2 py-1.5 text-[10px] text-zinc-300 font-mono leading-relaxed">
            {entry.example}
          </div>
        </Section>
      )}

      {/* Expand toggle */}
      {hasExpandable && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setExpanded(!expanded); }}
            className={cn(
              'w-full flex items-center justify-center gap-1 py-1 rounded-lg text-[9px] font-medium transition-all',
              expanded
                ? 'text-zinc-400 bg-white/5'
                : 'text-blue-300 bg-blue-500/10 hover:bg-blue-500/15',
            )}
          >
            {expanded ? 'Свернуть' : 'Подробнее'}
            <ChevronDown size={9} className={cn('transition-transform duration-200', expanded && 'rotate-180')} />
          </button>

          {expanded && (
            <div className="space-y-2 pt-1 border-t border-white/5">
              {entry.howCalc && (
                <Section icon={<Cpu size={8} />} num="②" title="Как считается">
                  <p className="text-zinc-300 text-[10px]">{entry.howCalc}</p>
                </Section>
              )}
              {entry.dataSource && (
                <Section icon={<Database size={8} />} num="③" title="Откуда данные">
                  <p className="text-zinc-300 text-[10px]">{entry.dataSource}</p>
                </Section>
              )}
              {entry.engine && (
                <Section icon={<Cpu size={8} />} num="④" title="Движок">
                  <p className="text-zinc-400 text-[9px]">{entry.engine}</p>
                </Section>
              )}
              {entry.lawFull && (
                <Section icon={<Scale size={8} />} num="⑥" title="Закон">
                  <LawBlock text={entry.lawFull} />
                </Section>
              )}
              {/* ⑫ Расхождение с источником — рядом с «откуда данные»: это
                  ответ на вопрос «как считает лист против того, как считаем
                  мы», и без него сверка выглядит спором двух чисел. */}
              {entry.divergence && (
                <Section icon={<Scale size={8} />} num="⑫" title="Почему может разойтись">
                  <p className="text-zinc-300 text-[10px]">{entry.divergence}</p>
                </Section>
              )}
              {entry.pitfalls && (
                <Section icon={<AlertTriangle size={8} />} num="⑧" title="Подводные камни">
                  <p className="text-amber-300/80 text-[9px]">{entry.pitfalls}</p>
                </Section>
              )}
              {entry.actions && (
                <Section icon={<ArrowRight size={8} />} num="⑨" title="Что делать">
                  <p className="text-zinc-300 text-[10px]">{entry.actions}</p>
                </Section>
              )}
              {entry.related && entry.related.length > 0 && (
                <Section icon={<Link2 size={8} />} num="⑩" title="Связанные">
                  <RelatedLinks items={entry.related} />
                </Section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Живой провенанс: официальные строки СВОДа за текущий период (Д11) ──
function ProvenanceBlock({ sources }: { sources: ProvenanceSource[] }) {
  const readAt = sources.find((s) => s.readAt)?.readAt;
  const readLabel = readAt
    ? new Date(readAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <div className="mt-2 pt-2 border-t border-white/[0.06]">
      <div className="flex items-center gap-1.5 mb-1">
        <Database size={8} className="text-emerald-400/80 shrink-0" />
        <span className="text-[9px] font-semibold text-emerald-300/90 uppercase tracking-wider">
          Первичка сейчас
        </span>
        {readLabel && (
          <span className="text-[8px] text-zinc-500 ml-auto" title="Когда сервер прочитал эти ячейки">
            прочитано {readLabel}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {sources.map((s) => (
          <div key={`${s.sheet}!${s.cell}-${s.label}`} className="flex items-start gap-1.5 text-[10px] leading-snug">
            <span className="text-zinc-400 shrink-0">{s.label}:</span>
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-blue-300 hover:text-blue-200 underline underline-offset-2 decoration-blue-400/40 inline-flex items-center gap-0.5"
                title={s.formula ? `Формула листа: ${s.formula}` : 'Открыть ячейку в книге'}
              >
                {s.sheet}!{s.cell}
                <ExternalLink size={7} className="shrink-0 opacity-60" />
              </a>
            ) : (
              <span className="font-mono text-zinc-200" title={s.formula ? `Формула листа: ${s.formula}` : undefined}>
                {s.sheet}!{s.cell}
              </span>
            )}
            {s.display != null && <span className="text-zinc-300 tabular-nums">= {s.display}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Main. Два режима одного и того же содержимого (директива п.73а):
//   • мышь/трекпад — Radix Tooltip: наведение открывает, уход закрывает;
//   • тач (телефон, планшет) — Radix Popover: тап по метрике открывает
//     ту же подсказку, тап мимо закрывает. Долгое нажатие не требуется.
// ════════════════════════════════════════════════════════════════

/** Классы панели подсказки — общие для hover- и тап-режима.
 *  Ширина упирается в экран: на 360px панель не вылезает за края. */
const KB_PANEL_CLASS = cn(
  'z-[100] w-[min(320px,calc(100vw-32px))] max-h-[60vh] overflow-y-auto rounded-2xl px-4 py-3',
  'bg-zinc-900/95 backdrop-blur-xl',
  'border border-white/[0.08]',
  'shadow-[0_20px_40px_-12px_rgba(0,0,0,0.5)]',
  'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-150',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-100',
);

export function KBTooltip({
  metric,
  formula, source, cell, thresholds, law, description,
  whatIs, howCalc, dataSource, engine, thresholdsFull, lawFull,
  example, pitfalls, actions, related, scopeMoment, divergence,
  children, side = 'top', showIcon = false, className,
}: KBTooltipProps) {
  const registryEntry = getKB(metric);
  // Живой провенанс за выбранный период — официальные ячейки СВОДа (Д11).
  const period = useStore((s) => s.period);
  const provenance = metric ? officialProvenanceFor(metric, period) : [];
  // Родословная показателя (канон п.104): из какого документа он родом.
  // Не путать с живым провенансом выше: тот меняется от снимка к снимку,
  // эта — нет. Родословной одной достаточно, чтобы подсказка открылась.
  const lineage = metric ? provenanceCard(metric) : null;
  const entry: KBEntry = {
    formula: formula ?? registryEntry?.formula,
    source: source ?? registryEntry?.source,
    cell: cell ?? registryEntry?.cell,
    thresholds: thresholds ?? registryEntry?.thresholds,
    law: law ?? registryEntry?.law,
    description: description ?? registryEntry?.description,
    whatIs: whatIs ?? registryEntry?.whatIs,
    howCalc: howCalc ?? registryEntry?.howCalc,
    dataSource: dataSource ?? registryEntry?.dataSource,
    engine: engine ?? registryEntry?.engine,
    thresholdsFull: thresholdsFull ?? registryEntry?.thresholdsFull,
    lawFull: lawFull ?? registryEntry?.lawFull,
    example: example ?? registryEntry?.example,
    pitfalls: pitfalls ?? registryEntry?.pitfalls,
    actions: actions ?? registryEntry?.actions,
    related: related ?? registryEntry?.related,
    // Поля карточки 2.0. Пропс сильнее записи реестра — экран знает свой
    // периметр лучше словаря и вправе уточнить скоуп живыми значениями.
    scopeMoment: scopeMoment ?? registryEntry?.scopeMoment,
    divergence: divergence ?? registryEntry?.divergence,
  };

  const coarsePointer = useCoarsePointer();

  const hasContent = Object.values(entry).some(v => Array.isArray(v) ? v.length > 0 : Boolean(v))
    || provenance.length > 0
    || lineage !== null;
  if (!hasContent) return <>{children}</>;

  const body = (
    <>
      {entry.description && (
        <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-white/[0.06]">
          <BookOpen size={10} className="text-blue-400/70 shrink-0" />
          <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">{entry.description}</span>
        </div>
      )}
      <FullKBContent entry={entry} />
      {provenance.length > 0 && <ProvenanceBlock sources={provenance} />}
      {/* Нижний ярус — родословная показателя. Панель подсказки всегда тёмная,
          поэтому тон 'dark': светлые классы темы здесь не сработают. */}
      {metric && <MetricProvenance metricKey={metric} tone="dark" />}
    </>
  );

  // Значок расхождения рядом с числом — для тех, кто не наведёт (см. п.104).
  const mark = metric ? <DivergenceMark metricKey={metric} className="ml-0.5" /> : null;

  // ── Тап-режим (координатное устройство): Popover открывается кликом,
  //    закрывается тапом мимо — аналог наведения по директиве п.73а. ──
  if (coarsePointer) {
    return (
      <>
        <PopoverPrimitive.Root>
          <PopoverPrimitive.Trigger asChild>
            <span
              tabIndex={0}
              className={cn('inline-flex items-center gap-1 cursor-help group/kb', className)}
            >
              {children}
              {showIcon && (
                <Info size={11} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
              )}
              {mark}
            </span>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side={side}
              sideOffset={8}
              align="center"
              collisionPadding={16}
              className={KB_PANEL_CLASS}
            >
              {body}
              <PopoverPrimitive.Arrow className="fill-zinc-900/95" />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </>
    );
  }

  return (
    <>
      <TooltipPrimitive.Root delayDuration={300} disableHoverableContent={false}>
        <TooltipPrimitive.Trigger asChild>
          <span className={cn('inline-flex items-center gap-1 cursor-help group/kb', className)}>
            {children}
            {showIcon && (
              <Info size={11} className="text-zinc-400 dark:text-zinc-500 opacity-0 group-hover/kb:opacity-100 transition-opacity shrink-0" />
            )}
            {/* Значок расхождения живёт ВНУТРИ обёртки, а не рядом с ней.
                Прежде подсказка возвращала фрагмент «обёртка + значок», и в
                сетке значок становился ОТДЕЛЬНОЙ КЛЕТКОЙ: между плитками
                зияла пустота с одиноким треугольником (жалоба владельца
                22.08). Компонент обязан отдавать ровно один элемент. */}
            {mark}
          </span>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={8}
            align="center"
            collisionPadding={16}
            className={KB_PANEL_CLASS}
            // Keep tooltip open when hovering over it (for interactive content)
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            {body}
            <TooltipPrimitive.Arrow className="fill-zinc-900/95" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </>
  );
}
