/**
 * text-blocks.ts — состав выгрузок словами, БЕЗ библиотеки docx.
 *
 * Здесь живёт вся текстовка и вся арифметика подписей; docx-сборка получает
 * готовый список блоков и только раскладывает их по абзацам. Разделение
 * нужно ради тестов: состав отчёта проверяется без рендера документа,
 * обычным сравнением строк.
 *
 * Порядок и формулировки сняты с двух ручных эталонов и сверены с третьей
 * неделей (структура постоянна, а не разовая):
 *   • основной — «260329 Отчет по закупкам на 26.06.2026.docx»
 *     (контроль: «260512 Отчет по закупкам на 08.05.2026.docx»);
 *   • дополнительный — «260712 Дополнительно к отчету по закупкам».
 *
 * Правила счёта — docs/superpowers/specs/2026-07-29-report-calculation-rules.md.
 * Числа, которых у продукта нет, печатаются честной плашкой, а не нулём:
 * выдуманный ноль в отчёте начальству дороже пропуска.
 */
import type { PendingRemainder, Report } from '@aemr/core';

/** Строка отчёта: заголовок раздела, обычный абзац либо курсивная оговорка. */
export interface ReportBlock {
  kind: 'heading' | 'text' | 'note';
  text: string;
}

/**
 * Отчёт с обвязкой ответа сервера: `live` — режим (эфир или архив недели),
 * `svodOnlineUrl` — ссылка на официальную книгу из шапки ручного отчёта.
 */
export type ReportForExport = Omit<Report, 'period'> & {
  period: Report['period'] & { live?: boolean };
  svodOnlineUrl?: string;
};

/**
 * Один и тот же срез, посчитанный по каждому кварталу.
 *
 * Проекция buildReport знает ровно один отчётный квартал, а ручной отчёт
 * печатает все четыре («Всего на 1…4 квартал 2026 года») плюс исполнение по
 * каждому прошедшему. Поэтому страница берёт срез четырьмя запросами и
 * отдаёт их сюда картой — иначе три четверти шапки пришлось бы выдумать.
 */
export type QuarterReports = Record<1 | 2 | 3 | 4, ReportForExport>;

type Quarter = 1 | 2 | 3 | 4;
const QUARTERS: readonly Quarter[] = [1, 2, 3, 4];

const heading = (text: string): ReportBlock => ({ kind: 'heading', text });
const line = (text: string): ReportBlock => ({ kind: 'text', text });
const note = (text: string): ReportBlock => ({ kind: 'note', text });

/** Плашка вместо числа, которого продукт пока не считает (канон честной пустоты). */
const NOT_COUNTED = 'не рассчитано';

/** Плашка вместо текста, который пишет человек, а не продукт. */
const NOT_FILLED = 'не заполнено';


// ── Форматирование чисел ─────────────────────────────────────────────

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

/** Бюджетная тройка в скобках — ровно та форма, что в ручном отчёте. */
function budget(m: { fb: number; kb: number; mb: number }): string {
  return `(ФБ – ${money(m.fb)} тыс. руб., КБ – ${money(m.kb)} тыс. руб., ` +
    `МБ – ${money(m.mb)} тыс. руб.)`;
}

// ── Русские формы ────────────────────────────────────────────────────

/** «1 квартал» — форма эталона (quarterLabel из shared даёт «1 кв», это форма UI). */
const qNom = (q: Quarter): string => `${q} квартал`;

/** Родительный: «исполнение плана 1 квартала». */
const qGen = (q: Quarter): string => `${q} квартала`;

/** Предложный с верным предлогом: «Во 2 квартале», но «В 3 квартале». */
const inQuarter = (q: Quarter): string => `${q === 2 ? 'Во' : 'В'} ${q} квартале`;

/** Единственное число по последней цифре (11–14 — исключение). */
function isOne(n: number): boolean {
  return n % 10 === 1 && !(n % 100 >= 11 && n % 100 <= 14);
}

function isFew(n: number): boolean {
  return n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 11 && n % 100 <= 14);
}

/** Склонение слова «процедура» по числу. */
function procedures(n: number): string {
  if (isOne(n)) return 'процедура';
  if (isFew(n)) return 'процедуры';
  return 'процедур';
}

/**
 * Дательный падеж: «заключены по 10 конкурентным процедурам», «по 1
 * процедуре». Отдельная форма, потому что в этих местах оригинала стоит
 * именно дательный, а не родительный.
 */
function proceduresDative(n: number): string {
  return isOne(n) ? 'процедуре' : 'процедурам';
}

/** Склонение «договор/контракт» для ЕП-блоков. */
function contracts(n: number): string {
  if (isOne(n)) return 'договор/контракт';
  if (isFew(n)) return 'договора/контракта';
  return 'договоров/контрактов';
}

/** «Проведено 15 аукционов» / «2 аукциона» / «1 аукцион». */
function auctions(n: number): string {
  if (isOne(n)) return 'аукцион';
  if (isFew(n)) return 'аукциона';
  return 'аукционов';
}

/** Дательный: «по 2 аукционам», «по 1 аукциону». */
function auctionsDative(n: number): string {
  return isOne(n) ? 'аукциону' : 'аукционам';
}

/** «запланировано 396 процедур» / «запланирована 1 процедура». */
function plannedProcedures(n: number): string {
  return `${isOne(n) ? 'запланирована' : 'запланировано'} ${num(n)} ${procedures(n)}`;
}

/** «запланировано 140 конкурентных процедур» — с согласованием прилагательного. */
function plannedCompetitive(n: number): string {
  if (isOne(n)) return `запланирована ${num(n)} конкурентная процедура`;
  if (isFew(n)) return `запланировано ${num(n)} конкурентные процедуры`;
  return `запланировано ${num(n)} конкурентных процедур`;
}


/** Деньги года по способу = Σ четырёх кварталов (то же правило §2, что счётчики). */
export function yearMethodMoney(
  quarters: QuarterReports,
  method: 'kp' | 'ep',
  kind: 'plan' | 'fact',
): { fb: number; kb: number; mb: number; total: number } {
  const acc = { fb: 0, kb: 0, mb: 0, total: 0 };
  for (const q of QUARTERS) {
    const m = quarters[q].integralSummary.moneyByMethod[method][kind];
    acc.fb += m.fb;
    acc.kb += m.kb;
    acc.mb += m.mb;
    acc.total += m.total;
  }
  return acc;
}

/** «на общую сумму X тыс. руб. (ФБ – …, КБ – …, МБ – …)» — денежный хвост эталона. */
function moneyTail(m: { fb: number; kb: number; mb: number; total: number }): string {
  return ` на общую сумму ${money(m.total)} тыс. руб. ${budget(m)}`;
}

// ── Выборки по кварталам ─────────────────────────────────────────────

/** Прошедшие и текущий кварталы: ручной отчёт печатает исполнение только по ним. */
const elapsed = (reportQuarter: Quarter): Quarter[] =>
  QUARTERS.filter((q) => q <= reportQuarter);

/** Блок того же ГРБС в отчёте другого квартала (ключ dept сквозной). */
function blockOf(r: ReportForExport, dept: string) {
  return r.grbsBlocks.find((b) => b.dept === dept);
}

/** План/факт года так, как его печатает ручной отчёт (см. yearOf). */
interface YearCounts {
  planCount: number;
  doneCount: number;
  pct: number | null;
}

/**
 * Год ручного отчёта = СУММА ЧЕТЫРЁХ КВАРТАЛОВ, а не годовой счётчик проекции.
 *
 * Правила счёта §2: строка входит в план года только с заданным плановым
 * кварталом. Годовые метрики проекции (`year.methods`) квартала не требуют и
 * тянут строки без него: на 26.06.2026 это давало 475 конкурентных процедур
 * в шапке вместо эталонных 396, 2 684 ЕП вместо 2 333 и 225 против 150 у УО.
 * Вслед за завышенным знаменателем врало и «исполнение годового плана» —
 * 38,22 % у УО против 57,33 % в отчёте. Тот же порядок счёта доказан
 * регрессом трёх недель (core/report/week-regression.test.ts: «план года =
 * сумма четырёх кварталов», «факт года»).
 *
 * `dept` не задан — район целиком, задан — одно управление.
 */
export function yearOf(quarters: QuarterReports, method: 'kp' | 'ep', dept?: string): YearCounts {
  let planCount = 0;
  let doneCount = 0;
  for (const q of QUARTERS) {
    const m = dept === undefined
      ? quarters[q].integralSummary.quarter[method]
      : blockOf(quarters[q], dept)?.quarter.methods[method];
    if (m === undefined) continue;
    planCount += m.planCount;
    doneCount += m.doneCount;
  }
  // Тот же канон G = E/D, что и в quarterExecutionFromCounts: D = 0 → «нет плана».
  return { planCount, doneCount, pct: planCount > 0 ? (doneCount / planCount) * 100 : null };
}

/**
 * Порядок списка «фактическое исполнение плана по ГРБС» — по проценту
 * ВОЗРАСТАЮЩЕ, как в эталоне: отстающие сверху, они и есть повестка.
 * Управления без плана на квартал в список не попадают: исполнять нечего.
 */
function byExecution(blocks: ReportForExport['grbsBlocks']) {
  return blocks
    .filter((b) => b.quarter.methods.kp.planCount > 0)
    .slice()
    .sort((a, b) => (a.quarter.methods.kp.pct ?? 0) - (b.quarter.methods.kp.pct ?? 0));
}

/** Сумма остатков КП по всем ГРБС отчёта (район за один квартал). */
function districtPendingKp(r: ReportForExport): PendingRemainder {
  const add = (pick: (p: PendingRemainder) => number): number =>
    r.grbsBlocks.reduce((s, b) => s + pick(b.quarter.pendingByMethod.kp), 0);
  return {
    count: add((p) => p.count),
    fb: add((p) => p.fb),
    kb: add((p) => p.kb),
    mb: add((p) => p.mb),
    total: add((p) => p.total),
  };
}

/**
 * Годовой остаток по конкурентным = сумма квартальных остатков КП.
 *
 * Правила счёта §2: в план года входят строки с плановым кварталом 1–4,
 * поэтому четыре квартальные группы покрывают год без остатка. Разреза
 * «год × способ» в проекции нет, и это единственный честный способ его
 * собрать, не выдумывая своей семантики остатка.
 */
function yearPendingKp(quarters: QuarterReports): PendingRemainder {
  const parts = QUARTERS.map((q) => districtPendingKp(quarters[q]));
  const add = (pick: (p: PendingRemainder) => number): number =>
    parts.reduce((s, p) => s + pick(p), 0);
  return {
    count: add((p) => p.count),
    fb: add((p) => p.fb),
    kb: add((p) => p.kb),
    mb: add((p) => p.mb),
    total: add((p) => p.total),
  };
}

/** Строки «исполнение плана N квартала» по району — общие для обеих выгрузок. */
function districtExecutionLines(quarters: QuarterReports, reportQuarter: Quarter): ReportBlock[] {
  return elapsed(reportQuarter).map((q) => {
    const kp = quarters[q].integralSummary.quarter.kp;
    const deviation = kp.planCount - kp.doneCount;
    // Эталон меняет формулировку: план закрыт — «Общее исполнение», иначе
    // сначала называется отклонение в процедурах, и только потом процент.
    return line(
      deviation <= 0
        ? `Общее исполнение плана ${qGen(q)} – ${pct(kp.pct)}`
        : `Отклонение от плана ${qGen(q)} – ${num(deviation)} ${procedures(deviation)} ` +
          `(общее исполнение плана ${qGen(q)} – ${pct(kp.pct)})`,
    );
  });
}

/**
 * Строки «в N квартале осталось …» — что именно ГРБС ещё не отыграл.
 *
 * Есть в ОБОИХ ручных эталонах и в секции каждого управления с незакрытым
 * кварталом (26.06: строки 119/149/237/267/421/449/491/593; 08.05: те же
 * места у семи ГРБС) — это часть структуры, а не разовая приписка. Числа —
 * те же pendingByMethod, что и в дополнительном отчёте: на 26.06 они дают
 * УЭР 5 аукционов / 2 343,28, УАГЗО 5 / 873,33, УДТХ 4 / 23 679,79,
 * УКСиМП 1 / 1 200,00, УО 4 / 18 768,26 — знак в знак с эталоном.
 * Перечень позиций за строками пишет специалист, поэтому под строкой плашка.
 */
function quarterRemainderLines(
  left: PendingRemainder,
  q: Quarter,
  verb: 'отыграть' | 'заключить',
  unit: (n: number) => string,
): ReportBlock[] {
  if (left.count === 0) return [];
  return [
    line(
      `${inQuarter(q)} осталось ${verb} ${num(left.count)} ${unit(left.count)} ` +
      `на общую сумму ${money(left.total)} тыс. руб. ${budget(left)}, в том числе:`,
    ),
    line(`- ${NOT_FILLED}: пояснение по каждой незаключённой позиции пишет специалист.`),
  ];
}

/**
 * Строка списка ГРБС: «- УО – 100,00% (план на 1 квартал – 55, исполнено 55,
 * план на год – 150)». Годовой план приходит параметром, потому что считается
 * по четырём кварталам (yearOf), а не берётся из `b.year`.
 */
function grbsExecutionLine(
  b: ReportForExport['grbsBlocks'][number],
  q: Quarter,
  yearPlanCount: number,
): ReportBlock {
  const kp = b.quarter.methods.kp;
  return line(
    `- ${b.dept} – ${pct(kp.pct)} (план на ${qNom(q)} – ${num(kp.planCount)}, ` +
    `исполнено ${num(kp.doneCount)}, план на год – ${num(yearPlanCount)})`,
  );
}

// ── Основной отчёт ───────────────────────────────────────────────────

/**
 * «ОТЧЕТ ПО ЗАКУПКАМ» — шапка, районный блок по двум способам, затем секция
 * на каждое управление. `report` задаёт отчётный квартал, официальный ярус
 * СВОДа и ссылку на книгу; `quarters` даёт тот же срез по всем четырём
 * кварталам (см. QuarterReports).
 */
export function mainReportBlocks(
  report: ReportForExport,
  quarters: QuarterReports,
  asOfDate: string,
): ReportBlock[] {
  const { period, grbsBlocks } = report;
  const rq = period.quarter;
  const yearKp = yearOf(quarters, 'kp');
  const yearEp = yearOf(quarters, 'ep');
  const out: ReportBlock[] = [];

  // ── Шапка ручного отчёта ──
  out.push(heading('ОТЧЕТ ПО ЗАКУПКАМ'));
  out.push(line(`срез на ${asOfDate}`));
  out.push(line(
    report.svodOnlineUrl
      ? `Ссылка на СВОД онлайн: ${report.svodOnlineUrl}`
      : `Ссылка на СВОД онлайн — ${NOT_FILLED}: книга СВОД на сервере не настроена.`,
  ));
  out.push(note(
    '(показатели в отчете и в своде могут незначительно отличаться в виду ' +
    'актуальности свода на дату открытия, а отчета на отчетную дату)',
  ));

  out.push(line('ВСЕ ГРБС'));

  // ── Конкурентные процедуры по району ──
  out.push(heading('ПО КОНКУРЕНТНЫМ ПРОЦЕДУРАМ:'));
  out.push(line(
    `Всего на год ${plannedProcedures(yearKp.planCount)}` +
    `${moneyTail(yearMethodMoney(quarters, 'kp', 'plan')).replace(' на общую сумму', ' на сумму')}.`,
  ));
  for (const q of QUARTERS) {
    const kp = quarters[q].integralSummary.quarter.kp;
    const kpMoney = quarters[q].integralSummary.moneyByMethod.kp.plan;
    out.push(line(
      `Всего на ${qNom(q)} ${period.year} года ${plannedCompetitive(kp.planCount)}` +
      `${moneyTail(kpMoney)}.`,
    ));
  }
  out.push(line(
    `Фактически обязательства заключены по ${num(yearKp.doneCount)} конкурентным ` +
    `${proceduresDative(yearKp.doneCount)}${moneyTail(yearMethodMoney(quarters, 'kp', 'fact'))}.`,
  ));

  out.push(...districtExecutionLines(quarters, rq));

  for (const q of elapsed(rq)) {
    out.push(line(`По состоянию на ${asOfDate} фактическое исполнение плана ${qGen(q)} по ГРБС:`));
    for (const b of byExecution(quarters[q].grbsBlocks)) {
      out.push(grbsExecutionLine(b, q, yearOf(quarters, 'kp', b.dept).planCount));
    }
  }

  const yearLeft = yearPendingKp(quarters);
  out.push(line(
    `Остаток незаключенных договоров по конкурентным процедурам до конца года – ${num(yearLeft.count)}.`,
  ));
  out.push(line(
    `На данный момент в работе у отдела муниципальных закупок находится процедур — ` +
    `${NOT_FILLED}: перечень по стадиям ведёт специалист отдела.`,
  ));

  // Расчётную экономию остатка лист СВОД считает сам (ярус «Расч. экономия»,
  // parseSvodExtras) — берём его число, а не свою методику: у неё расхождение
  // с ручным отчётом 3,5 % (правила счёта §5), и подменять официал ею нельзя.
  const economy = report.official?.calcEconomy;
  out.push(line(
    economy
      ? `Расчетная экономия по оставшимся незаключенным ${num(yearLeft.count)} конкурентным ` +
        `${proceduresDative(yearLeft.count)} составляет ${money(economy.total)} тыс. руб., ` +
        `из них – ${money(economy.mb)} тыс. руб. – местный бюджет ${budget(economy)}.`
      : `Расчетная экономия по оставшимся незаключенным ${num(yearLeft.count)} конкурентным ` +
        `${proceduresDative(yearLeft.count)} — ${NOT_COUNTED}: ярус «Расч. экономия» листа СВОД не передан.`,
  ));

  // ── Единственный поставщик по району ──
  out.push(heading('ЕДИНСТВЕННЫЙ ПОСТАВЩИК:'));
  out.push(line(
    `Всего на год ${plannedProcedures(yearEp.planCount)}` +
    `${moneyTail(yearMethodMoney(quarters, 'ep', 'plan')).replace(' на общую сумму', ' на сумму')}.`,
  ));
  for (const q of QUARTERS) {
    const ep = quarters[q].integralSummary.quarter.ep;
    const epMoney = quarters[q].integralSummary.moneyByMethod.ep.plan;
    out.push(line(
      `Всего на ${qNom(q)} ${period.year} года запланировано заключить договоров/контрактов ` +
      `по ${num(ep.planCount)} наименованиям${moneyTail(epMoney)}.`,
    ));
  }
  out.push(line(
    `Заключено ${num(yearEp.doneCount)} ${contracts(yearEp.doneCount)}` +
    `${moneyTail(yearMethodMoney(quarters, 'ep', 'fact')).replace(' на общую сумму', ' на сумму')}.`,
  ));

  // Абзац эталона про адресные рекомендации коллегам: это работа аналитика,
  // а не расчёт — продукт держит место, но текст пишет человек.
  out.push(line(
    `В ходе ведения аналитики адресные рекомендации ГРБС и их итоги — ${NOT_FILLED}.`,
  ));

  // ── Секции управлений ──
  for (const b of grbsBlocks) {
    const deptKp = yearOf(quarters, 'kp', b.dept);
    const deptEp = yearOf(quarters, 'ep', b.dept);
    out.push(heading(`${b.dept} — ${b.deptLabel}`));

    out.push(heading('КОНКУРЕНТНЫЕ ПРОЦЕДУРЫ:'));
    out.push(line(`Всего на год: ${num(deptKp.planCount)}`));
    for (const q of elapsed(rq)) {
      const qb = blockOf(quarters[q], b.dept);
      if (!qb) continue;
      const kp = qb.quarter.methods.kp;
      // Квартала без плана и без факта в ручном отчёте нет вовсе: печатать
      // «запланировано 0 … исполнение – —» значит выдавать пустоту за строку.
      if (kp.planCount === 0 && kp.doneCount === 0) continue;
      out.push(line(
        `Всего на ${qNom(q)} ${period.year} года ${plannedCompetitive(kp.planCount)}` +
        `${moneyTail(qb.quarter.moneyByMethod.kp.plan)}.`,
      ));
      out.push(line(
        `Проведено ${num(kp.doneCount)} ${auctions(kp.doneCount)}` +
        `${moneyTail(qb.quarter.moneyByMethod.kp.fact)}.`,
      ));
      out.push(...quarterRemainderLines(qb.quarter.pendingByMethod.kp, q, 'отыграть', auctions));
      out.push(line(`Исполнение плана ${qGen(q)} – ${pct(kp.pct)}`));
    }
    out.push(line(`Исполнение годового плана – ${pct(deptKp.pct)}`));
    out.push(line(`Экономия местного бюджета ${money(b.economy.mb)} тыс. руб.`));

    out.push(heading('ЕДИНСТВЕННЫЙ ПОСТАВЩИК:'));
    out.push(line(`Всего на год: ${num(deptEp.planCount)}`));
    for (const q of elapsed(rq)) {
      const qb = blockOf(quarters[q], b.dept);
      if (!qb) continue;
      const ep = qb.quarter.methods.ep;
      if (ep.planCount === 0 && ep.doneCount === 0) continue;
      out.push(line(
        `Всего на ${qNom(q)} ${period.year} года запланировано заключить договоров/контрактов ` +
        `по ${num(ep.planCount)} наименованиям${moneyTail(qb.quarter.moneyByMethod.ep.plan)}.`,
      ));
      out.push(line(
        `Заключено ${num(ep.doneCount)} ${contracts(ep.doneCount)}` +
        `${moneyTail(qb.quarter.moneyByMethod.ep.fact).replace(' на общую сумму', ' на сумму')}.`,
      ));
      out.push(...quarterRemainderLines(qb.quarter.pendingByMethod.ep, q, 'заключить', contracts));
      out.push(line(`Исполнение плана ${qGen(q)} – ${pct(ep.pct)}`));
    }
    out.push(line(`Исполнение годового плана – ${pct(deptEp.pct)}`));
  }

  return out;
}

// ── Дополнительный отчёт ─────────────────────────────────────────────

/**
 * «Дополнительно к отчету по закупкам» — короткая записка руководителю:
 * только конкурентные, только основные показатели и остаток с проблематикой.
 * Пояснения по каждой незаключённой позиции и адресные рекомендации пишет
 * человек — продукт их не сочиняет и честно оставляет плашку.
 */
export function additionalReportBlocks(
  report: ReportForExport,
  quarters: QuarterReports,
  asOfDate: string,
): ReportBlock[] {
  const { period, notes } = report;
  const rq = period.quarter;
  const yearKp = yearOf(quarters, 'kp');
  const out: ReportBlock[] = [];

  out.push(heading('ДОПОЛНИТЕЛЬНО К ОТЧЕТУ ПО ЗАКУПКАМ'));
  out.push(line(`срез на ${asOfDate}`));
  out.push(line(
    'Уважаемые коллеги, буду краток, исключительно по основным показателям и проблематике',
  ));

  out.push(heading('ПО КОНКУРЕНТНЫМ ПРОЦЕДУРАМ:'));
  out.push(line(
    `Всего на год ${plannedProcedures(yearKp.planCount)}` +
    `${moneyTail(yearMethodMoney(quarters, 'kp', 'plan')).replace(' на общую сумму', ' на сумму')}.`,
  ));
  out.push(line(
    `Фактически обязательства заключены по ${num(yearKp.doneCount)} конкурентным ` +
    `${proceduresDative(yearKp.doneCount)}${moneyTail(yearMethodMoney(quarters, 'kp', 'fact'))}.`,
  ));

  out.push(...districtExecutionLines(quarters, rq));

  // Остаток года — в ПЛАНОВЫХ деньгах с разбивкой по бюджетам (правила счёта
  // §4): именно этого просили ГРБС-специалисты, и именно это печатает эталон.
  const yearLeft = yearPendingKp(quarters);
  out.push(line(
    `Остаток незаключенных договоров по конкурентным процедурам до конца года – ` +
    `${num(yearLeft.count)} на общую сумму ${money(yearLeft.total)} тыс. руб. ${budget(yearLeft)}`,
  ));
  out.push(line(
    `На данный момент в работе у отдела муниципальных закупок находится процедур — ` +
    `${NOT_FILLED}: перечень по стадиям ведёт специалист отдела.`,
  ));

  // ── Разбор по управлениям: процент, затем остаток квартала в деньгах ──
  const quarterLeft = districtPendingKp(report);
  out.push(line(
    `По остатку из ${num(quarterLeft.count)} ${procedures(quarterLeft.count)} по ${rq} кварталу:`,
  ));
  for (const b of byExecution(report.grbsBlocks)) {
    out.push(grbsExecutionLine(b, rq, yearOf(quarters, 'kp', b.dept).planCount));
    const left = b.quarter.pendingByMethod.kp;
    if (left.count === 0) continue;
    out.push(line(
      `${inQuarter(rq)} осталось заключиться по ${num(left.count)} ${auctionsDative(left.count)} ` +
      `на общую сумму ${money(left.total)} тыс. руб. ${budget(left)}, в том числе:`,
    ));
    out.push(line(
      `- ${NOT_FILLED}: пояснение по каждой незаключённой позиции пишет специалист.`,
    ));
  }

  out.push(line(`Из критичной проблематики — ${NOT_FILLED}.`));
  out.push(line(`Адресные рекомендации ГРБС и их итоги — ${NOT_FILLED}.`));

  out.push(line(
    period.live === true
      ? 'Отчёт построен в режиме прямого эфира: числа на текущий момент, как считает официальный лист.'
      : `Отчёт построен по снимку недели на ${asOfDate}: заключённое после этой даты в числа не входит.`,
  ));
  for (const n of notes) out.push(line(n));

  return out;
}
