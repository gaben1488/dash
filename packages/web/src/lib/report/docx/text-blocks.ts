/**
 * text-blocks.ts — состав отчётов словами, БЕЗ библиотеки docx.
 *
 * Здесь живёт вся текстовка и вся арифметика подписей; docx-сборка получает
 * готовый список блоков и только раскладывает их по абзацам. Разделение
 * нужно ради тестов: состав отчёта проверяется без рендера документа,
 * обычным сравнением строк.
 *
 * Формулировки и порядок повторяют ручной отчёт «Отчёт по закупкам
 * 05.04.2026 (ТИПОВОЙ)» и «(УМНЫЙ)» — те самые файлы, которые сегодня
 * собирают контрактные управляющие. Числа, которых у продукта пока нет,
 * печатаются честной плашкой, а не нулём: выдуманный ноль в отчёте
 * начальству дороже пропуска.
 */
import type { Report } from '@aemr/core';
import { quarterLabel } from '@aemr/shared';

/** Строка отчёта: заголовок раздела либо обычный абзац. */
export interface ReportBlock {
  kind: 'heading' | 'text';
  text: string;
}

/**
 * Отчёт с признаком режима: `live` добавляет роут поверх core-проекции
 * (эфир или архив недели), и в оговорках отчёта это надо назвать.
 */
export type ReportForExport = Omit<Report, 'period'> & {
  period: Report['period'] & { live?: boolean };
};

const heading = (text: string): ReportBlock => ({ kind: 'heading', text });
const line = (text: string): ReportBlock => ({ kind: 'text', text });

/** Плашка вместо числа, которого продукт пока не считает (канон честной пустоты). */
const NOT_COUNTED = 'не рассчитано';

/** Количество: ru-RU-группировка, неразрывные пробелы как в оригинале. */
function num(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

/** Деньги: два знака после запятой — формат ручного отчёта («861 007,37»). */
function money(n: number): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Процент: два знака и запятая («4,17%»); null → тире, как в оригинале. */
function pct(p: number | null): string {
  return p === null ? '—' : `${p.toFixed(2).replace('.', ',')}%`;
}

/** Склонение слова «процедура» по числу. */
function procedures(n: number): string {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  if (!teen && last === 1) return 'процедура';
  if (!teen && last >= 2 && last <= 4) return 'процедуры';
  return 'процедур';
}

/**
 * Дательный падеж: «заключены по 10 конкурентным процедурам», «по 1
 * процедуре». Отдельная форма, потому что в этих двух местах оригинала
 * стоит именно дательный, а не родительный.
 */
function proceduresDative(n: number): string {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  return !teen && last === 1 ? 'процедуре' : 'процедурам';
}

/** Склонение «договор/контракт» для ЕП-блоков. */
function contracts(n: number): string {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  if (!teen && last === 1) return 'договор/контракт';
  if (!teen && last >= 2 && last <= 4) return 'договора/контракта';
  return 'договоров/контрактов';
}

// ── Основной отчёт (аналог «ТИПОВОЙ») ────────────────────────────────

/**
 * Районный блок: конкурентные процедуры и единственный поставщик по всем
 * ГРБС, затем секция на каждое управление.
 */
export function mainReportBlocks(report: ReportForExport, asOfDate: string): ReportBlock[] {
  const { period, integralSummary: sum, grbsBlocks } = report;
  const qLabel = quarterLabel(period.quarter);
  const out: ReportBlock[] = [];

  out.push(line('ВСЕ ГРБС'));

  // ── Конкурентные процедуры по району ──
  out.push(heading('ПО КОНКУРЕНТНЫМ ПРОЦЕДУРАМ:'));
  out.push(line(
    `Всего на год запланировано ${num(sum.year.kp.planCount)} ${procedures(sum.year.kp.planCount)} ` +
    `на сумму ${money(sum.money.plan.total)} тыс. руб.`,
  ));
  out.push(line(
    `Всего на ${qLabel} ${period.year} года запланировано ${num(sum.quarter.kp.planCount)} ` +
    `конкурентных ${procedures(sum.quarter.kp.planCount)}. Плановая сумма квартала с разбивкой ` +
    `по бюджетам — ${NOT_COUNTED}.`,
  ));
  out.push(line(
    `Фактически обязательства заключены по ${num(sum.quarter.kp.doneCount)} конкурентным ` +
    `${proceduresDative(sum.quarter.kp.doneCount)}. Отклонение от плана ${qLabel} — ` +
    `${num(sum.quarter.kp.planCount - sum.quarter.kp.doneCount)} ${procedures(sum.quarter.kp.planCount - sum.quarter.kp.doneCount)} ` +
    `(общее исполнение плана ${qLabel} — ${pct(sum.quarter.kp.pct)})`,
  ));

  out.push(line(`По состоянию на ${asOfDate} фактическое исполнение плана ${qLabel} по ГРБС:`));
  for (const b of grbsBlocks) {
    out.push(line(
      `- ${b.dept} — ${pct(b.quarter.methods.kp.pct)} (план на ${qLabel} — ${num(b.quarter.methods.kp.planCount)}, ` +
      `исполнено ${num(b.quarter.methods.kp.doneCount)}, план на год — ${num(b.year.methods.kp.planCount)})`,
    ));
  }

  const kpRemainder = sum.year.kp.planCount - sum.year.kp.doneCount;
  out.push(line(
    `Остаток незаключенных договоров по конкурентным процедурам до конца года — ${num(kpRemainder)}.`,
  ));
  out.push(line(
    `Расчетная экономия по оставшимся незаключенным ${num(kpRemainder)} конкурентным ` +
    `${proceduresDative(kpRemainder)} — ${NOT_COUNTED}. Утверждённая экономия года: ` +
    `${money(sum.money.economy.total)} тыс. руб., из них ${money(sum.money.economy.mb)} тыс. руб. — местный бюджет.`,
  ));

  // ── Единственный поставщик по району ──
  out.push(heading('ЕДИНСТВЕННЫЙ ПОСТАВЩИК:'));
  out.push(line(
    `Всего на год запланировано ${num(sum.year.ep.planCount)} ${procedures(sum.year.ep.planCount)}.`,
  ));
  out.push(line(
    `Всего на ${qLabel} ${period.year} года запланировано заключить договоров/контрактов ` +
    `по ${num(sum.quarter.ep.planCount)} наименованиям.`,
  ));
  out.push(line(
    `Заключено ${num(sum.quarter.ep.doneCount)} ${contracts(sum.quarter.ep.doneCount)}.`,
  ));
  out.push(line(
    `По состоянию на ${asOfDate} фактическое распределение контрактации по ЕП ` +
    `в разрезе причин закупки — ${NOT_COUNTED}.`,
  ));

  // ── Секции управлений ──
  for (const b of grbsBlocks) {
    out.push(heading(b.deptLabel));

    out.push(heading('КОНКУРЕНТНЫЕ ПРОЦЕДУРЫ:'));
    out.push(line(
      `Всего на год: ${num(b.year.methods.kp.planCount)}. Всего на ${qLabel} ${period.year} года ` +
      `запланировано ${num(b.quarter.methods.kp.planCount)} конкурентных ` +
      `${procedures(b.quarter.methods.kp.planCount)}.`,
    ));
    out.push(line(
      `Проведено ${num(b.quarter.methods.kp.doneCount)} ` +
      `${b.quarter.methods.kp.doneCount === 1 ? 'аукцион' : 'аукционов'}.`,
    ));
    out.push(line(
      `Исполнение плана ${qLabel} — ${pct(b.quarter.methods.kp.pct)}. ` +
      `Исполнение годового плана — ${pct(b.year.methods.kp.pct)}`,
    ));
    out.push(line(`Экономия местного бюджета ${money(b.economy.mb)} тыс. руб.`));

    out.push(heading('ЕДИНСТВЕННЫЙ ПОСТАВЩИК:'));
    out.push(line(`Всего на год: ${num(b.year.methods.ep.planCount)}`));
    out.push(line(
      `Всего на ${qLabel} ${period.year} года запланировано заключить договоров/контрактов ` +
      `по ${num(b.quarter.methods.ep.planCount)} наименованиям.`,
    ));
    out.push(line(
      `Заключено ${num(b.quarter.methods.ep.doneCount)} ${contracts(b.quarter.methods.ep.doneCount)}.`,
    ));
    out.push(line(
      `Исполнение плана ${qLabel} — ${pct(b.quarter.methods.ep.pct)}. ` +
      `Исполнение годового плана — ${pct(b.year.methods.ep.pct)}`,
    ));
    const epLeft = b.quarter.methods.ep.planCount - b.quarter.methods.ep.doneCount;
    if (epLeft > 0) {
      out.push(line(`Осталось заключить ${num(epLeft)} ${contracts(epLeft)}.`));
    }
  }

  return out;
}

// ── Дополнительный отчёт (аналог «УМНЫЙ») ────────────────────────────

/**
 * Аналитическая часть: качество данных, резюме, картина, право, ГРБС,
 * аномалии, прогноз, бенчмаркинг, рекомендации. Разделы, для которых у
 * продукта нет расчёта, печатаются с честной плашкой — структура отчёта
 * сохраняется полностью, как в оригинале.
 */
export function analyticalReportBlocks(report: ReportForExport, asOfDate: string): ReportBlock[] {
  const { period, integralSummary: sum, grbsBlocks, notes } = report;
  const qLabel = quarterLabel(period.quarter);
  const out: ReportBlock[] = [];

  out.push(line(`АНАЛИТИЧЕСКИЙ ОТЧЁТ ПО ЗАКУПКАМ ${asOfDate}`));

  out.push(heading('1. УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ'));
  out.push(line(
    `Общее исполнение плана ${qLabel}: ${pct(sum.quarter.total.pct)} ` +
    `(${num(sum.quarter.total.doneCount)} из ${num(sum.quarter.total.planCount)}).`,
  ));
  const epShare = sum.year.total.doneCount > 0
    ? (sum.year.ep.doneCount / sum.year.total.doneCount) * 100
    : null;
  out.push(line(
    `Доля единственного поставщика составляет ${pct(epShare)} от числа заключённых за год.`,
  ));
  out.push(line(`Утверждённая экономия года: ${money(sum.money.economy.total)} тыс. руб.`));

  out.push(heading('2. ОБЩАЯ КАРТИНА'));
  out.push(line(
    `Конкурентные: план ${num(sum.year.kp.planCount)} ${procedures(sum.year.kp.planCount)}, ` +
    `факт ${num(sum.year.kp.doneCount)} (${pct(sum.year.kp.pct)}).`,
  ));
  out.push(line(
    `ЕП: план ${num(sum.year.ep.planCount)} ${procedures(sum.year.ep.planCount)}, ` +
    `факт ${num(sum.year.ep.doneCount)} (${pct(sum.year.ep.pct)}).`,
  ));
  out.push(line(
    `Лимит года ${money(sum.money.plan.total)} тыс. руб. ` +
    `(ФБ ${money(sum.money.plan.fb)}, КБ ${money(sum.money.plan.kb)}, МБ ${money(sum.money.plan.mb)}), ` +
    `факт ${money(sum.money.fact.total)} тыс. руб.`,
  ));

  out.push(heading('3. СВЕРКА С ОФИЦИАЛЬНЫМ ЛИСТОМ СВОД'));
  const withSvod = grbsBlocks.filter((b) => b.quarter.svod !== undefined);
  if (withSvod.length === 0) {
    out.push(line('Официальный лист СВОД не передан — сверка недоступна.'));
  } else {
    const mismatched = withSvod.filter((b) =>
      b.quarter.live.kp.planCount !== b.quarter.svod!.kp.planCount ||
      b.quarter.live.kp.doneCount !== b.quarter.svod!.kp.doneCount ||
      b.quarter.live.ep.planCount !== b.quarter.svod!.ep.planCount ||
      b.quarter.live.ep.doneCount !== b.quarter.svod!.ep.doneCount);
    out.push(line(
      mismatched.length === 0
        ? `Расхождений нет: по всем ${num(withSvod.length)} управлениям расчёт совпадает с официальным листом.`
        : `Расхождения по управлениям: ${mismatched.map((b) => b.dept).join(', ')}.`,
    ));
    for (const b of mismatched) {
      const cells = b.quarter.svodCells;
      out.push(line(
        `- ${b.dept}: КП расчёт ${num(b.quarter.live.kp.doneCount)} против ` +
        `${num(b.quarter.svod!.kp.doneCount)} в листе` +
        `${cells ? ` (ячейка ${cells.kp.fact})` : ''}; ` +
        `ЕП расчёт ${num(b.quarter.live.ep.doneCount)} против ${num(b.quarter.svod!.ep.doneCount)}` +
        `${cells ? ` (ячейка ${cells.ep.fact})` : ''}.`,
      ));
    }
  }

  out.push(heading('4. АНАЛИТИКА ПО ГРБС'));
  for (const b of grbsBlocks) {
    out.push(line(
      `${b.deptLabel}: исполнение ${qLabel} ${pct(b.quarter.execution.pct)} ` +
      `(${num(b.quarter.execution.doneCount)} из ${num(b.quarter.execution.planCount)}), ` +
      `не заключено ${num(b.quarter.pendingCount)}, экономия ${money(b.economy.total)} тыс. руб.`,
    ));
  }

  out.push(heading('5. ЗАМЕЧАНИЯ И РИСКИ'));
  const signals = grbsBlocks.flatMap((b) => b.topSignals.map((s) => `${b.dept}: ${s.title}`));
  if (signals.length === 0) {
    out.push(line('Значимых замечаний не выявлено.'));
  } else {
    for (const s of signals) out.push(line(`- ${s}`));
  }

  out.push(heading('6. ПРОГНОЗ И СЦЕНАРИИ'));
  out.push(line(`Прогнозная модель исполнения — ${NOT_COUNTED}.`));

  out.push(heading('7. РЕКОМЕНДАЦИИ'));
  out.push(line(`Адресные рекомендации — ${NOT_COUNTED}.`));

  out.push(heading('8. ОГОВОРКИ К ОТЧЁТУ'));
  out.push(line(
    period.live === true
      ? 'Отчёт построен в режиме прямого эфира: числа на текущий момент, как считает официальный лист.'
      : `Отчёт построен по снимку недели на ${asOfDate}: заключённое после этой даты в числа не входит.`,
  ));
  for (const n of notes) out.push(line(n));

  return out;
}
