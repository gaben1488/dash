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
//      динамика по кварталам;
//   4. «Из чего состоит ЕП» — тот же объём без торгов, разложенный на четыре
//      степени обоснованности, с отдельно названным сокращаемым ЕП и
//      динамикой его снижения по кварталам (канон п. 98ж).
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
import { EpJustification } from '../components/competition/EpJustification';
import { sumEpKp } from '../components/competition/primitives';
import { PageHeader } from '../components/ui/page-header';

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
      {/* 18.08: шапка переведена на общий примитив. Было — четыре копии одной
          строки классов по четырём страницам и двенадцать вкладок вовсе без
          заголовка первого уровня. Стало — один дом, кегль и краски из
          токенов, обе темы правятся в одном месте. */}
      <PageHeader
        title="Конкуренция"
        lead="Сколько стоит отказ от конкурса и где объединение закупок разных управлений позволит провести общие торги вместо закупок у единственного поставщика."
      />

      <CostOfRefusal epPlan={epKpTotals.epPlan} epHasData={epKpTotals.hasData && epKpTotals.epPlan > 0} />
      <MergeCandidates />
      <EpShare totals={epKpTotals} />
      <EpJustification />
    </div>
  );
}
