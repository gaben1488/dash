/**
 * procedures.ts — реестр процедур определения поставщика из книги
 * «Ежедневный мониторинг» (канон п.69в: отдельная вкладка; п.101а:
 * «Реестр процедур определения поставщика», перенос всех листов книги).
 *
 * Эта волна — фундамент: читаются восемь листов управлений (спека
 * docs/superpowers/specs/2026-08-14-daily-monitoring-tab.md §2 — раскладка
 * колонок сверена по всем 372 строкам полного дампа). Журнал «25-26»,
 * СВОДНЫЙ и справочник ГРБС — следующей волной.
 *
 * Правила чтения:
 *  - деньги книги — РУБЛИ (решение владельца 18.08; книги ГРБС — в тысячах,
 *    смешивать без множителя нельзя — подпись обязательна на каждом экране);
 *  - стадия выводится ЧИСЛОВЫМИ предикатами по цене и датам, не текстом
 *    колонки «Победитель» (канон п.27: свободный текст — не источник
 *    статусов; текст победителя едет на экран как есть, без интерпретации);
 *  - код процедуры разбирается парсером @aemr/shared (канон-нормализация);
 *    искажённый код НЕ чинится молча — строка остаётся в реестре без кода,
 *    а её адрес поднимается сигналом (спека §2: пять паттернов искажений).
 */

import { extractProcedureRefs } from '@aemr/shared';

// ── Карта листов ─────────────────────────────────────────────────────

/**
 * Восемь листов управлений книги мониторинга → канонические ид ГРБС продукта.
 * Имена листов в книге («4. УАГиЗО», «5. УДТХиРКИ») отличаются от коротких
 * имён реестра управлений (УАГЗО, УДТХ) — маппинг обязателен (спека §4).
 */
export const MONITORING_DEPT_SHEETS: ReadonlyArray<{ sheet: string; dept: string }> = [
  { sheet: '1. УЭР', dept: 'УЭР' },
  { sheet: '2. УКСиМП', dept: 'УКСиМП' },
  { sheet: '3. УИО', dept: 'УИО' },
  { sheet: '4. УАГиЗО', dept: 'УАГЗО' },
  { sheet: '5. УДТХиРКИ', dept: 'УДТХ' },
  { sheet: '6. УД', dept: 'УД' },
  { sheet: '7. УФБП', dept: 'УФБП' },
  { sheet: '8. УО', dept: 'УО' },
];

// ── Стадии ───────────────────────────────────────────────────────────

/**
 * Стадия процедуры — по числовым предикатам (п.27):
 *  - awarded: цена аукциона заполнена и больше нуля — торги состоялись,
 *    есть цена победителя;
 *  - no_result: цена аукциона равна нулю — торги прошли без результата
 *    (спека §2: «0 = торги без результата», 21 строка книги);
 *  - published: цены нет, но есть дата публикации — процедура объявлена,
 *    итог не подведён;
 *  - application: нет ни цены, ни публикации — заявка поступила в
 *    уполномоченный орган и ждёт объявления.
 */
export type ProcedureStage = 'application' | 'published' | 'awarded' | 'no_result';

/** Подписи стадий для читателя — литературный русский, без ключей. */
export const PROCEDURE_STAGE_LABELS: Record<ProcedureStage, string> = {
  application: 'Заявка в уполномоченном органе',
  published: 'Объявлена, итога нет',
  awarded: 'Состоялась',
  no_result: 'Без результата',
};

// ── Строка реестра ───────────────────────────────────────────────────

export interface MonitoringProcedure {
  /** Имя листа книги — адрес для карточки диагноста (п.53). */
  sheet: string;
  /** Номер строки листа (1-based, как в Sheets). */
  row: number;
  /** Канонический ид ГРБС продукта (УЭР, УО, …). */
  dept: string;
  /** Заказчик (колонка B) — учреждение либо «Совместный аукцион …». */
  customer: string;
  /** Канонический код процедуры («ЭА152-26») либо null — код не разобран. */
  code: string | null;
  /** Предмет закупки: колонка C без кода; кода нет — колонка C целиком. */
  subject: string;
  /** НМЦК, руб. (колонка D). */
  nmck: number | null;
  /** Дата поступления заявки в УО — как в книге, «дд.мм.гггг». */
  applicationDate: string | null;
  /** Дата публикации. */
  publicationDate: string | null;
  /** Дата окончания подачи заявок. */
  deadlineDate: string | null;
  /** Дата проведения торгов/переторжки. */
  auctionDate: string | null;
  /** Цена аукциона, руб.; 0 — торги без результата; null — итога нет. */
  auctionPrice: number | null;
  /** Экономия ВСЕГО, руб. (колонка J) — как записано в книге. */
  savingsTotal: number | null;
  /** Самопроверка книги (колонка K): «верно» / «ошибка» / пусто. */
  selfCheck: string | null;
  /** Победитель либо текст исхода (колонка O) — на экран как есть, п.27. */
  winner: string | null;
  stage: ProcedureStage;
  /** Снижение на торгах, руб.: НМЦК − цена (только для состоявшихся). */
  reductionRub: number | null;
  /** Снижение на торгах, % от НМЦК (только для состоявшихся с НМЦК > 0). */
  reductionPct: number | null;
}

/** Адрес строки, чей код процедуры не разобрался, — сигнал, не потеря. */
export interface UnparsedCodeRef {
  sheet: string;
  row: number;
  /** Начало колонки C — чтобы виновницу можно было найти глазами. */
  text: string;
}

export interface MonitoringRegistry {
  procedures: MonitoringProcedure[];
  /** Строки с нераспознанным кодом: спека §2 — пять паттернов искажений. */
  unparsedCodes: UnparsedCodeRef[];
}

// ── Разбор значений ячеек ────────────────────────────────────────────

/**
 * Число из ячейки: UNFORMATTED_VALUE обычно отдаёт number, но в книге
 * встречаются суммы текстом с неразрывными пробелами и запятой
 * («2 250 000,00» — спека §3). Нечисло → null, не ноль: ноль в цене
 * аукциона — содержательное значение «торги без результата».
 */
export function monitoringNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  // \s в JS покрывает и неразрывный пробел (U+00A0) — разряды сумм книги.
  const cleaned = v.replace(/\s/gu, '').replace(',', '.');
  if (cleaned === '' || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Непустой текст ячейки либо null. */
function textOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Стадия по числовым предикатам — см. комментарий к ProcedureStage. */
export function procedureStage(
  auctionPrice: number | null,
  publicationDate: string | null,
): ProcedureStage {
  if (auctionPrice !== null && auctionPrice > 0) return 'awarded';
  if (auctionPrice !== null && auctionPrice === 0) return 'no_result';
  return publicationDate !== null ? 'published' : 'application';
}

// ── Разбор листа ─────────────────────────────────────────────────────

/** Шапка листа управления — две строки (спека §2), данные со строки 3. */
const HEADER_ROWS = 2;

/**
 * Колонки листа управления (0-based, раскладка спеки §2):
 * A №, B заказчик, C код+предмет, D НМЦК, E–H даты, I цена, J экономия,
 * K самопроверка, O победитель.
 */
const COL = {
  CUSTOMER: 1,
  SUBJECT: 2,
  NMCK: 3,
  APPLICATION: 4,
  PUBLICATION: 5,
  DEADLINE: 6,
  AUCTION: 7,
  PRICE: 8,
  SAVINGS: 9,
  SELF_CHECK: 10,
  WINNER: 14,
} as const;

/**
 * Собрать реестр процедур из гридов листов управлений.
 *
 * @param sheets — грид каждого прочитанного листа книги (имя листа → строки);
 *   непрочитанные листы просто отсутствуют — честность неполноты объявляет
 *   вызывающий код, здесь ряды не выдумываются.
 */
export function parseMonitoringProcedures(
  sheets: Readonly<Record<string, unknown[][]>>,
): MonitoringRegistry {
  const procedures: MonitoringProcedure[] = [];
  const unparsedCodes: UnparsedCodeRef[] = [];

  for (const { sheet, dept } of MONITORING_DEPT_SHEETS) {
    const grid = sheets[sheet];
    if (!grid) continue;

    for (let i = HEADER_ROWS; i < grid.length; i++) {
      const r = grid[i] ?? [];
      const customer = textOf(r[COL.CUSTOMER]);
      const subjectCell = textOf(r[COL.SUBJECT]);
      // Строка без заказчика и предмета — хвост листа, не данные.
      if (customer === null && subjectCell === null) continue;

      const row = i + 1;
      const refs = extractProcedureRefs(subjectCell);
      const code = refs.length > 0 ? refs[0].code : null;
      if (code === null && subjectCell !== null) {
        // Код не разобран (искажение формата либо кода нет вовсе) — адрес
        // поднимается сигналом, строка из реестра НЕ выпадает (спека §2).
        unparsedCodes.push({ sheet, row, text: subjectCell.slice(0, 80) });
      }

      // Предмет — колонка C без найденного кода в начале строки.
      let subject = subjectCell ?? '';
      if (code !== null) {
        // Убираем исходное написание кода из начала текста (терпимость к
        // пробелам уже в парсере — здесь достаточно отрезать до первого
        // пробела после кода, если строка начинается с кода).
        const m = /^\s*\S+\s+/.exec(subject);
        if (m && extractProcedureRefs(m[0]).length > 0) subject = subject.slice(m[0].length).trim();
      }

      const nmck = monitoringNumber(r[COL.NMCK]);
      const auctionPrice = monitoringNumber(r[COL.PRICE]);
      const publicationDate = textOf(r[COL.PUBLICATION]);
      const stage = procedureStage(auctionPrice, publicationDate);

      const reductionRub = stage === 'awarded' && nmck !== null && auctionPrice !== null
        ? nmck - auctionPrice
        : null;
      const reductionPct = reductionRub !== null && nmck !== null && nmck > 0
        ? (reductionRub / nmck) * 100
        : null;

      procedures.push({
        sheet,
        row,
        dept,
        customer: customer ?? '',
        code,
        subject,
        nmck,
        applicationDate: textOf(r[COL.APPLICATION]),
        publicationDate,
        deadlineDate: textOf(r[COL.DEADLINE]),
        auctionDate: textOf(r[COL.AUCTION]),
        auctionPrice,
        savingsTotal: monitoringNumber(r[COL.SAVINGS]),
        selfCheck: textOf(r[COL.SELF_CHECK]),
        winner: textOf(r[COL.WINNER]),
        stage,
        reductionRub,
        reductionPct,
      });
    }
  }

  return { procedures, unparsedCodes };
}

// ── Агрегаты ─────────────────────────────────────────────────────────

export interface MonitoringAggregates {
  /** Всего строк-процедур на прочитанных листах. */
  total: number;
  byStage: Record<ProcedureStage, number>;
  /** Сумма НМЦК всех строк с числовой НМЦК, руб. */
  nmckTotal: number;
  /** Состоявшиеся торги (цена > 0). */
  awarded: {
    count: number;
    /** НМЦК состоявшихся с числовой НМЦК, руб. — знаменатель экономии. */
    nmckTotal: number;
    /** Сумма цен победителей, руб. */
    priceTotal: number;
    /** Экономия на торгах: НМЦК − цена по состоявшимся, руб. */
    savingsTotal: number;
    /**
     * Средний процент снижения — СРЕДНЕЕ ПОСТРОЧНЫХ процентов, не отношение
     * сумм: отношение сумм взвешивало бы крупные закупки и отвечало бы на
     * другой вопрос («на сколько подешевел портфель»), а не «как обычно
     * снижается процедура». null — состоявшихся с НМЦК нет.
     */
    avgReductionPct: number | null;
    /** Цена равна НМЦК — снижения не было (спека §2: 158 строк из 372). */
    noReductionCount: number;
  };
  /** Строк с разобранным кодом / с неразобранным (сигнал целостности). */
  codesParsed: number;
  codesUnparsed: number;
}

export function aggregateMonitoring(registry: MonitoringRegistry): MonitoringAggregates {
  const byStage: Record<ProcedureStage, number> = {
    application: 0, published: 0, awarded: 0, no_result: 0,
  };
  let nmckTotal = 0;
  let awardedCount = 0;
  let awardedNmck = 0;
  let awardedPrice = 0;
  let noReductionCount = 0;
  const reductions: number[] = [];

  for (const p of registry.procedures) {
    byStage[p.stage] += 1;
    if (p.nmck !== null) nmckTotal += p.nmck;
    if (p.stage === 'awarded' && p.auctionPrice !== null) {
      awardedCount += 1;
      awardedPrice += p.auctionPrice;
      if (p.nmck !== null) {
        awardedNmck += p.nmck;
        if (p.nmck > 0) reductions.push(((p.nmck - p.auctionPrice) / p.nmck) * 100);
        if (p.nmck === p.auctionPrice) noReductionCount += 1;
      }
    }
  }

  return {
    total: registry.procedures.length,
    byStage,
    nmckTotal,
    awarded: {
      count: awardedCount,
      nmckTotal: awardedNmck,
      priceTotal: awardedPrice,
      savingsTotal: awardedNmck - awardedPrice,
      avgReductionPct: reductions.length > 0
        ? reductions.reduce((a, b) => a + b, 0) / reductions.length
        : null,
      noReductionCount,
    },
    codesParsed: registry.procedures.filter((p) => p.code !== null).length,
    codesUnparsed: registry.unparsedCodes.length,
  };
}
