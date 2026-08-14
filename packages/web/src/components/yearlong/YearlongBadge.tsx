/**
 * YearlongBadge — собственная подпись стадии «Закупки, проводимые в течение
 * года» вместо лживого бейджа «есть факт» (канон п.71б).
 *
 * Показывается, когда строка проходит СТРУКТУРНЫЙ предикат стадии (способ ЕП,
 * заглушка свода в дате заключения, факт больше нуля — чтения текста нет,
 * п.27 соблюдён). Подпись — по ПОДКЛАССУ (п.81): «Закупка в течение года» /
 * «Выплаты в течение года» / «Платежи без договора»; вид — второй строкой
 * подсказки; строка без разметки вида подписывается нейтрально
 * «вид не определён».
 */
import { clsx } from 'clsx';
import {
  YEARLONG_KIND_BY_ID,
  YEARLONG_STAGE_LABELS,
  YEARLONG_SUBCLASS_LABELS,
  isYearlongStageRow,
  resolveYearlongKind,
  yearlongSubclassForKind,
} from '@aemr/shared';
import { toCanonicalDeptId } from '../../lib/dept-key';
import { useYearlongKinds } from './useYearlongKinds';

/** Минимальный срез строки Реестра, нужный бейджу (поля RowDto). */
export interface YearlongBadgeRow {
  /** Управление в любой форме ключа (латиница DTO или кириллица). */
  dept: string;
  /** № п/п — колонка A (ключ разметки вместе с книгой). */
  id: unknown;
  /** Способ (колонка L). */
  method: unknown;
  /** Дата заключения СЫРЬЁМ листа (колонка Q, поле factDateRaw DTO). */
  factDateRaw: unknown;
  /** Итого факт (колонка Y), тыс. руб. */
  factSum: number;
}

/**
 * Бейдж стадии для строки Реестра. Строка вне стадии → null (ничего не
 * рисуем — бейдж не «украшение», а утверждение о данных).
 */
export function YearlongBadge({ row, className }: { row: YearlongBadgeRow; className?: string }) {
  const { overrides, provisional } = useYearlongKinds();

  if (!isYearlongStageRow({ method: row.method, factDateCell: row.factDateRaw, factSum: row.factSum })) {
    return null;
  }

  const dept = toCanonicalDeptId(row.dept);
  const kind = resolveYearlongKind(dept, row.id, overrides);
  const subclass = yearlongSubclassForKind(kind);
  const stageLabel = subclass ? YEARLONG_STAGE_LABELS[subclass] : 'Закупка в течение года';
  const kindMeta = kind ? YEARLONG_KIND_BY_ID.get(kind) : undefined;
  const isProvisional = provisional.has(`${dept}:${String(row.id ?? '').trim()}`);

  const hint = [
    'Стадия «в течение года»: факт и экономия строки в свод не капают (фильтр формул листа), план входит — это не ошибка, а серия исполнений по одной статье.',
    kindMeta
      ? `Вид: ${kindMeta.label}${isProvisional ? ' (разметка предварительная — можно исправить в карточке строки)' : ''}.`
      : 'Вид не определён — размечается одним кликом в карточке строки.',
    subclass ? `Подкласс: ${YEARLONG_SUBCLASS_LABELS[subclass]}.` : null,
  ].filter(Boolean).join(' ');

  return (
    <span className={clsx('inline-flex items-center gap-1 min-w-0', className)} title={hint}>
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400">
        {stageLabel}
      </span>
      {kindMeta ? (
        <span className="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap truncate max-w-[14rem] bg-zinc-100 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300">
          {kindMeta.label}
          {isProvisional && <span className="text-zinc-400 dark:text-zinc-500"> · предварительно</span>}
        </span>
      ) : (
        <span className="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap bg-zinc-100 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400">
          вид не определён
        </span>
      )}
    </span>
  );
}
