// ────────────────────────────────────────────────────────────────
// «Конкуренция» — исходы 1–2 продукта: меньше закупок у единственного
// поставщика, больше конкурентных; ниже операционные расходы.
//
// Три блока, каждый со своей плашкой периода и честной пустотой:
//   1. «Сколько стоит отказ от конкурса» — цена отказа по собственной
//      статистике торгов, методика на карточке, раскрытие до строк;
//   2. «Кандидаты на объединение» — группы одинаковых предметов у разных
//      заказчиков, ВКЛЮЧАЯ ЕП (страж §5.2), раскрытие до строк с адресами;
//   3. «Доля ЕП» — счётная и денежная рядом, обе подписаны (канон п. 36),
//      динамика по кварталам.
//
// Счёт ЕП/КП за периметр делается ОДИН раз (sumEpKp) и раздаётся блокам 1
// и 3: цена отказа и доля ЕП обязаны стоять на одном объёме ЕП, иначе два
// блока одной вкладки спорили бы друг с другом числами.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useFilteredData } from '../hooks/useFilteredData';
import { CostOfRefusal } from '../components/competition/CostOfRefusal';
import { MergeCandidates } from '../components/competition/MergeCandidates';
import { EpShare } from '../components/competition/EpShare';
import { sumEpKp } from '../components/competition/primitives';

export function CompetitionPage() {
  const fd = useFilteredData();

  const epKpTotals = useMemo(
    () => sumEpKp(fd.depts, {
      periodKey: fd.periodKey,
      hasActiveMonths: fd.periodResolution.hasActiveMonths,
      coveredQuarters: fd.coveredQuarters,
      fullQuarters: fd.fullQuarters,
      partialMonths: fd.partialMonths,
      useMonthLevel: fd.useMonthLevel,
    }),
    [fd.depts, fd.periodKey, fd.periodResolution, fd.coveredQuarters, fd.fullQuarters, fd.partialMonths, fd.useMonthLevel],
  );

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Конкуренция</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-2xl mt-0.5">
          Сколько стоит отказ от конкурса и где объединение закупок разных
          управлений позволит провести общие торги вместо закупок у единственного
          поставщика.
        </p>
      </div>

      <CostOfRefusal epPlan={epKpTotals.epPlan} epHasData={epKpTotals.hasData && epKpTotals.epPlan > 0} />
      <MergeCandidates />
      <EpShare totals={epKpTotals} />
    </div>
  );
}
