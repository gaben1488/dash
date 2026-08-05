/**
 * Чем ГРБС объясняет свои решения: основания выбора ЕП и причины просрочек.
 *
 * Исполнитель пишет свободным текстом, и одна причина живёт в десятке
 * редакций (по книгам 26.06: 250 формулировок оснований ЕП и 239 причин
 * отклонения). Здесь они сведены словарями @aemr/shared к кластерам —
 * считать можно по кластеру, а проверять по живому образцу: он показан
 * рядом как есть, без пересказа.
 *
 * Честность: строка, которую словарь не узнал, не прячется — она стоит
 * долей «формулировка не распознана». Это и есть мера пригодности
 * свободного ввода для информационной системы.
 */
import type { ReasonBucket } from '@aemr/core';
import { fmtCount } from '../../lib/report/mappers';
import { ExpandableRows } from '../contract/ExpandableRows';
import { KbHover } from '../contract/KbHover';

/** Кто устраняет причину — цвет и слово; цвет всегда с подписью. */
const OWNER_TONE: Record<string, string> = {
  'финансовый орган': 'text-amber-700 dark:text-amber-400',
  'поставщик': 'text-violet-700 dark:text-violet-400',
  'уполномоченный орган': 'text-blue-700 dark:text-blue-400',
  'вне управления': 'text-zinc-500 dark:text-zinc-400',
  'ГРБС': 'text-zinc-700 dark:text-zinc-300',
};

function ReasonRow({ b, total, kind }: { b: ReasonBucket; total: number; kind: 'ep' | 'dev' }) {
  const share = total > 0 ? Math.round((b.count / total) * 100) : 0;
  const unknown = b.cluster === 'UNMAPPED';
  return (
    <div className="text-[11px] leading-relaxed">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <KbHover
          metricKey={kind === 'ep' ? 'ep_count' : 'lifecycle_stage_overdue'}
          live={
            `${fmtCount(b.count)} из ${fmtCount(total)} строк (${share} %) — кластер «${b.label}».\n` +
            `Живой пример из листа: «${b.sample.slice(0, 200)}».` +
            (b.owner ? `\nУстраняет: ${b.owner}.` : '') +
            (b.legitimate === false ? '\nПо 44-ФЗ прямым основанием не является — строка идёт в разбор.' : '')
          }
        >
          <span className={unknown ? 'font-medium text-amber-700 dark:text-amber-400' : 'font-medium text-zinc-700 dark:text-zinc-200'}>
            {b.label}
          </span>
        </KbHover>
        <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{fmtCount(b.count)} · {share} %</span>
        {b.owner && (
          <span className={`text-[10px] ${OWNER_TONE[b.owner] ?? 'text-zinc-500'}`}>
            устраняет: {b.owner}
          </span>
        )}
        {b.legitimate === false && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">не основание по 44-ФЗ</span>
        )}
      </div>
      {b.sample && (
        <div className="ml-3 text-[10px] italic text-zinc-400 dark:text-zinc-500">«{b.sample}»</div>
      )}
    </div>
  );
}

function Block({ title, buckets, kind, note }: {
  title: string; buckets: ReasonBucket[]; kind: 'ep' | 'dev'; note: string;
}) {
  if (buckets.length === 0) return null;
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{title}</span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{note}</span>
      </div>
      <ExpandableRows
        rows={buckets}
        top={4}
        noun="кластеров"
        searchText={(b) => `${b.label} ${b.sample} ${b.owner ?? ''}`}
      >
        {(b) => <ReasonRow key={b.cluster} b={b} total={total} kind={kind} />}
      </ExpandableRows>
    </div>
  );
}

export function ReasonsPanel({ epReasons, deviations }: { epReasons: ReasonBucket[]; deviations: ReasonBucket[] }) {
  if (epReasons.length === 0 && deviations.length === 0) return null;
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200/70 px-3 py-2.5 dark:border-zinc-700/60">
      <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
        Чем управление объясняет свои решения
      </span>
      <Block
        title="Основания выбора единственного поставщика"
        buckets={epReasons}
        kind="ep"
        note="колонка M листа, сведено справочником"
      />
      <Block
        title="Причины отклонения сроков"
        buckets={deviations}
        kind="dev"
        note="колонка U листа, сведено справочником"
      />
    </div>
  );
}
