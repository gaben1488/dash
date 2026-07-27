/**
 * generateReportText — плоский текст еженедельного отчёта для вставки в письмо
 * (кнопка «Копировать текстом» страницы «Отчёт», волна 2B).
 *
 * Стиль — ручной отчёт начальству: разделы, «заключено X из Y (P%)»,
 * суммы «тыс. руб.». Никакого markdown — получатель читает в почте как есть.
 * Числа и подписи — те же мапперы/словарь, что у страницы (двух правд нет).
 */
import { productLabel } from '@aemr/shared';
import type { Report } from '@aemr/core';
import { buildGrbsSection, fmtCount, fmtPct, fmtThousands } from './mappers';

type Scope = Report['integralSummary']['year'];

/** «план 15, заключено 6 (40,0%). КП 40,0%, ЕП 40,0%.» */
function scopeLine(scope: Scope): string {
  return (
    `план ${fmtCount(scope.total.planCount)}, заключено ${fmtCount(scope.total.doneCount)} ` +
    `(${fmtPct(scope.total.pct)}). КП ${fmtPct(scope.kp.pct)}, ЕП ${fmtPct(scope.ep.pct)}.`
  );
}

/**
 * Report → плоский текст отчёта. asOfDate — готовая дата среза «на …»
 * (форматирует вызывающий; чистая функция сама дату не берёт — детерминизм).
 */
export function generateReportText(report: Report, asOfDate: string): string {
  const { period, integralSummary, grbsBlocks, notes } = report;
  const q = period.quarter;
  const lines: string[] = [
    `Отчёт по закупкам на ${asOfDate}`,
    `Период: ${period.year} год, ${q} квартал`,
    '',
    'ИТОГО ПО УПРАВЛЕНИЯМ',
    `Год: ${scopeLine(integralSummary.year)}`,
    `${q} квартал: ${scopeLine(integralSummary.quarter)}`,
    `Деньги за год: лимит ${fmtThousands(integralSummary.money.plan.total)} тыс. руб., ` +
      `факт ${fmtThousands(integralSummary.money.fact.total)} тыс. руб., ` +
      `экономия ${fmtThousands(integralSummary.money.economy.total)} тыс. руб.`,
  ];

  for (const block of grbsBlocks) {
    const vm = buildGrbsSection(block);
    lines.push('', `${vm.dept} — ${vm.deptLabel}`);
    lines.push(`${q} квартал: ${vm.executionCaption} (${vm.executionPct}). ${vm.pendingLabel}.`);
    const [kp, ep] = vm.methodRows;
    lines.push(
      `КП: ${fmtCount(kp.fact)} из ${fmtCount(kp.plan)} (${kp.pctText}), ` +
      `ЕП: ${fmtCount(ep.fact)} из ${fmtCount(ep.plan)} (${ep.pctText}).`,
    );
    lines.push(`${vm.yearLine}.`);
    lines.push(`${vm.moneyLine}${vm.economyLine ? ` ${vm.economyLine}` : ''}`);
    if (vm.svodPairs) {
      const mismatches = vm.svodPairs.filter((p) => p.calc !== p.svod);
      lines.push(
        mismatches.length === 0
          ? `Сверка со СВОД (${q} квартал): расхождений нет.`
          : `Сверка со СВОД (${q} квартал): расходится — ` +
            mismatches
              .map((p) => `${productLabel(p.metricKey)}: расчёт ${fmtCount(p.calc)}, СВОД ${fmtCount(p.svod)}`)
              .join('; ') + '.',
      );
      // Разрыв между отчётными числами (на срез) и сверкой (на сейчас) —
      // не расхождение, а разные моменты; письмо обязано это сказать.
      if (vm.svodNote) lines.push(vm.svodNote);
    }
    if (vm.signals.length > 0) {
      lines.push(`Сигналы: ${vm.signals.map((s) => s.title).join('; ')}.`);
    }
  }

  if (notes.length > 0) {
    lines.push('', 'Примечания:');
    for (const note of notes) lines.push(`— ${note}`);
  }

  return lines.join('\n');
}
