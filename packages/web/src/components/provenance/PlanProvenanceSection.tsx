/**
 * PlanProvenanceSection — секция «Откуда взялась плановая сумма» в карточке
 * строки: текущий план крупно, под ним — лента правок плановых ячеек.
 *
 * ЛЕНИВАЯ ЗАГРУЗКА. Роут провенанса читает журнал правок книги целиком (у
 * одного управления там 33 724 записи), поэтому запрос уходит только при
 * раскрытии секции. Текущее значение плана показывается СРАЗУ — оно уже есть в
 * строке реестра, ради него ходить на сервер незачем.
 *
 * ПОЧЕМУ ПЛАН ПОКАЗАН ЗДЕСЬ ВТОРОЙ РАЗ (он же есть в блоке «Деньги»). Потому
 * что вопрос секции — не «сколько», а «откуда»: число обязано стоять рядом со
 * своей историей, иначе читателю приходится держать его в голове, прокручивая
 * ленту. Значение и адрес ячейки берутся из той же строки, что и в «Деньгах», —
 * расходиться им не с чего.
 */
import { useCallback, useState } from 'react';
import { ChevronDown, RotateCcw, SearchX, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { planSemanticsFor } from '@aemr/shared';
import { useStore } from '../../store';
import { useRowProvenance } from '../../hooks/useRowProvenance';
import { PlanProvenanceView } from './PlanProvenanceView';

interface PlanProvenanceSectionProps {
  /** Канонический идентификатор управления («УКСиМП»). */
  deptId: string;
  /** «№ п/п» закупки (колонка A) — ключ журнала; null — номера у строки нет. */
  rowSeq: number | null;
  /** Текущий плановый итог строки, тыс. руб. */
  planNow: number;
  /** Адрес ячейки итога («K96») либо честная фраза о неизвестном адресе. */
  planCell: string;
}

function LedgerSkeleton() {
  return (
    <div className="space-y-3 animate-pulse" role="status" aria-live="polite">
      <span className="sr-only">Читаем журнал правок книги</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-700/60 shrink-0" />
          <div className="flex-1 space-y-1.5 pt-0.5">
            <div className="h-2 w-28 rounded bg-zinc-100 dark:bg-zinc-700/60" />
            <div className="h-2.5 w-2/3 rounded bg-zinc-100 dark:bg-zinc-700/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlanProvenanceSection({
  deptId,
  rowSeq,
  planNow,
  planCell,
}: PlanProvenanceSectionProps) {
  const formatMoney = useStore((s) => s.formatMoney);
  const [open, setOpen] = useState(false);
  const { data, loading, error, errorKind, reload } = useRowProvenance(deptId, rowSeq, open);

  const toggle = useCallback(() => setOpen((was) => !was), []);

  const addressable = deptId !== '' && rowSeq !== null;

  // Природа величины в плановых столбцах этой книги: у одних управлений там
  // начальная цена контракта, у культуры — она же за вычетом изъятого, у УДТХ —
  // распределяемый лимит (канон п.102). Вопрос «откуда взялась сумма»
  // начинается именно с этого: пока не сказано, ЧТО за величина стоит в
  // ячейке, история её правок читается наполовину.
  const semantics = planSemanticsFor(deptId);

  return (
    <div>
      {/* Текущий план крупно — то, что читатель и пришёл объяснять. */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <Wallet size={14} className="text-zinc-400 dark:text-zinc-500 self-center" aria-hidden="true" />
        <span className="text-lg font-semibold text-zinc-800 dark:text-zinc-100 tabular-nums">
          {planNow > 0 ? formatMoney(planNow) : 'плана нет'}
        </span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          сейчас в книге · ячейка {planCell}
        </span>
      </div>

      {/* Что это за величина по природе — с происхождением знания рядом. */}
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed" title={semantics.explain}>
        В книге {deptId || 'управления'} плановая сумма — {semantics.label}
        <span className="text-zinc-400 dark:text-zinc-500"> ({semantics.source})</span>
      </p>

      {!addressable ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
          История плановой суммы недоступна: у строки нет «№ п/п» в колонке A, а журнал правок
          книги помечает записи именно этим номером — искать историю не по чему. Действие —
          проставить порядковый номер строки в книге.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="mt-2 flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-zinc-100 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 rounded"
          >
            {open ? 'Свернуть историю плановой суммы' : 'Показать, что было с этой суммой'}
            <ChevronDown
              size={13}
              aria-hidden="true"
              className={clsx('transition-transform', open && 'rotate-180')}
            />
          </button>

          {open && (
            <div className="mt-3">
              {loading ? (
                <LedgerSkeleton />
              ) : errorKind === 'missing' ? (
                /* Строки с таким «№ п/п» книга не знает. Это не сбой связи, а
                   находка: реестр называет номер, которого в книге нет (канон
                   п.98б — «строка 155 по пульту в реальности 534»). Фраза
                   сервера уже содержит подсказку, какой номер стоит на этом
                   месте листа, поэтому её показываем как есть. Кнопки «ещё
                   раз» здесь нет намеренно: повтор ничего не изменит. */
                <div
                  className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/50 rounded-lg px-3 py-2.5"
                  role="note"
                >
                  <SearchX
                    size={13}
                    className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-medium text-amber-800 dark:text-amber-300">
                      Историю не по чему собрать: номер строки не найден в книге
                    </p>
                    <p className="text-[11px] text-amber-700/90 dark:text-amber-400/80 leading-relaxed mt-0.5">
                      {error} Действие — сверить № п/п закупки в книге и в реестре.
                    </p>
                  </div>
                </div>
              ) : error ? (
                <div className="text-xs bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2.5">
                  <p className="text-red-700 dark:text-red-300">
                    История плановой суммы не загрузилась. {error}
                  </p>
                  <button
                    type="button"
                    onClick={reload}
                    className="mt-1.5 inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-300 hover:underline"
                  >
                    <RotateCcw size={11} aria-hidden="true" /> Запросить ещё раз
                  </button>
                </div>
              ) : data ? (
                <PlanProvenanceView provenance={data} />
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
