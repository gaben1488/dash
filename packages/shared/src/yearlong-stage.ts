/**
 * yearlong-stage.ts — стадия «Закупки, проводимые в течение года».
 *
 * КАНОН (интервью 14.08.2026, docs/superpowers/audits/2026-08-14-interview-register.md):
 *   - п.71 — стадия существует: строки с фактом при заглушке в дате заключения
 *     «меняются по факту заключения договоров», их ФАКТ и ЭКОНОМИЯ в свод не
 *     капают (тройной фильтр формул: «Х», «X», пустота), а ПЛАН — входит.
 *     Бейдж «есть факт» на них лжив — нужна собственная подпись стадии.
 *   - п.81 — внутри стадии три ПОДКЛАССА с раздельным показом: «Закупки серией
 *     договоров» (36 строк), «Выплаты физлицам» (7), «Платежи без договора» (3).
 *   - п.82 — тумблер «как в листе ↔ без выплат и платежей» для доли ЕП и
 *     комплаенса; исключаемые строки — подклассы выплат и платежей.
 *   - п.83 — виды размечает владелец кликом; стартовые 46 строк размечены
 *     анализом 14.08 (здесь, YEARLONG_START_ROWS); строка без разметки видна
 *     нейтрально как «вид не определён».
 *   - п.76 — «хотелки» = стадия «инициативная заявка»: маркер читается
 *     СТРУКТУРНО (ячейка AF целиком равна маркеру словаря; п.27 не нарушен —
 *     маркер это код, как «Х»), план подписывается отдельно, правило дожития
 *     к началу 4 квартала.
 *
 * Числа и виды — из спеки docs/superpowers/specs/2026-08-14-comments-and-yearlong-canon.md
 * (§1.1–§1.4): 46 строк, план 8 733,3 тыс., факт 4 857,2 тыс.; девять видов §1.2.
 * Разметка ключуется КНИГА + № п/п (колонка A), а НЕ номером строки листа:
 * строки листов сдвигаются при правках, порядковый номер закупки — нет.
 */

import type { DepartmentId } from './types.js';
import { isAbsentCell } from './absence.js';

// ────────────────────────────────────────────────────────────
// 1. Структурный предикат стадии (п.71а, спека §1.4)
// ────────────────────────────────────────────────────────────

/**
 * Заглушка отсутствия даты заключения РОВНО в объёме фильтра формул свода:
 * кириллическая «Х», латинская «X» (любой регистр) и пустота. НАМЕРЕННО уже,
 * чем FACT_DATE_PLACEHOLDERS (там ещё «-», «н/д», «нет»): формулы свода
 * отсекают только эту тройку, и стадия обязана давать в точности те же строки,
 * что не капают в свод, — иначе подпись стадии разошлась бы с листом.
 */
export const SVOD_FACT_CUT_MARKERS: ReadonlySet<string> = new Set(['', 'х', 'x']);

/** true, если ячейка даты заключения — заглушка в смысле формул свода. */
export function isSvodFactCutMarker(raw: unknown): boolean {
  return SVOD_FACT_CUT_MARKERS.has(String(raw ?? '').trim().toLowerCase());
}

/** Входы предиката стадии — ровно три структурные ячейки строки. */
export interface YearlongStageInput {
  /** Колонка L — способ определения поставщика (как в листе). */
  method: unknown;
  /** Колонка Q — дата заключения СЫРЬЁМ листа (не ISO-конверсия). */
  factDateCell: unknown;
  /** Колонка Y — итого факт, тыс. руб. */
  factSum: number;
}

/**
 * Структурный предикат стадии «Закупка в течение года» (спека §1.4):
 * способ ЕП + заглушка отсутствия в дате заключения + факт больше нуля.
 * Чтения текста нет (канон п.27 соблюдён). На снимке 14.08.2026 предикат
 * даёт в точности 46 строк — те же, что отсекают формулы свода.
 */
export function isYearlongStageRow(row: YearlongStageInput): boolean {
  return (
    String(row.method ?? '').trim().toUpperCase() === 'ЕП' &&
    isSvodFactCutMarker(row.factDateCell) &&
    row.factSum > 0
  );
}

// ────────────────────────────────────────────────────────────
// 2. Подклассы стадии (п.81)
// ────────────────────────────────────────────────────────────

/**
 * Подкласс стадии — «не меняя сути, но отдельно это показывая» (слова
 * владельца, п.81): фильтры и аналитика видят подклассы внутри стадии,
 * предъявление — раздельное, с собственными подписями.
 */
export type YearlongSubclass =
  | 'contract-series' // закупки серией договоров (36 строк)
  | 'individual-payments' // выплаты физлицам (7) — контракта не будет никогда
  | 'no-contract-payment'; // платежи без договора (3) — оплата по счёту

/** Подпись подкласса (существительное для чипа/фильтра). */
export const YEARLONG_SUBCLASS_LABELS: Readonly<Record<YearlongSubclass, string>> = {
  'contract-series': 'серия договоров',
  'individual-payments': 'выплаты физлицам',
  'no-contract-payment': 'платёж без договора',
};

/**
 * Подпись стадии для бейджа строки — ВМЕСТО лживого «есть факт» (п.71б).
 * Для выплат и платежей слово «закупка» ложно — исполнители сами пишут
 * «Найм не входит в закупки ТРУ», «Контракт не заключается, оплата
 * происходит по счету» (спека §1.4).
 */
export const YEARLONG_STAGE_LABELS: Readonly<Record<YearlongSubclass, string>> = {
  'contract-series': 'Закупка в течение года',
  'individual-payments': 'Выплаты в течение года',
  'no-contract-payment': 'Платежи без договора',
};

/**
 * Исключается ли подкласс из «юридически чистого» режима тумблера (п.82):
 * режим «без выплат физлицам и платежей без договора» убирает из доли ЕП и
 * комплаенс-проверок строки, где договора не будет по природе статьи.
 * Деньги плана/факта в ОБЩИХ итогах — всегда полные (канон п.82).
 */
export function isExcludedFromLegallyClean(subclass: YearlongSubclass): boolean {
  return subclass !== 'contract-series';
}

// ────────────────────────────────────────────────────────────
// 3. Девять видов (спека §1.2) и их разметка
// ────────────────────────────────────────────────────────────

/** Идентификаторы девяти видов — внутренние ключи хранения, на экран не выходят. */
export type YearlongKindId =
  | 'regular-mandatory-services'
  | 'post-and-telecom'
  | 'on-demand-supply'
  | 'periodicals-subscription'
  | 'qualification-courses'
  | 'payments-to-individuals'
  | 'fees-without-contract'
  | 'events-by-estimates'
  | 'one-off-equipping';

/** Вид закупки «в течение года» — категория §1.2 спеки, курируемая разметка. */
export interface YearlongKind {
  id: YearlongKindId;
  /** Русская подпись вида — то, что видит владелец в выпадающем списке. */
  label: string;
  /** Суть одним предложением — подсказка при разметке. */
  essence: string;
  /** Подкласс стадии, к которому вид относится (п.81). */
  subclass: YearlongSubclass;
}

/**
 * Девять видов дословно по §1.2 спеки (число строк стартовой разметки:
 * 13 / 3 / 9 / 2 / 3 / 7 / 3 / 5 / 1 — проверяется тестом).
 */
export const YEARLONG_KINDS: readonly YearlongKind[] = [
  {
    id: 'regular-mandatory-services',
    label: 'Регулярные обязательные услуги',
    essence:
      'Противопожарные мероприятия, ОСАГО, обслуживание транспорта, медосмотры, теплосчётчики, дератизация — один–четыре мелких контракта в год.',
    subclass: 'contract-series',
  },
  {
    id: 'post-and-telecom',
    label: 'Связь и почта',
    essence: 'Почтовые отправления и телеком-услуги, оплата в течение года по мере отправки.',
    subclass: 'contract-series',
  },
  {
    id: 'on-demand-supply',
    label: 'Снабжение по мере потребности',
    essence:
      'Канцелярия, комплектующие («аварийный фонд», «оперативный резерв»), корма, заправка картриджей, стройматериалы — покупается малыми объёмами по потребности.',
    subclass: 'contract-series',
  },
  {
    id: 'periodicals-subscription',
    label: 'Подписка на периодику',
    essence: 'Серия договоров подписки на периодические издания.',
    subclass: 'contract-series',
  },
  {
    id: 'qualification-courses',
    label: 'Курсы повышения квалификации',
    essence: 'Обучение сотрудников отдельными договорами по мере набора групп.',
    subclass: 'contract-series',
  },
  {
    id: 'payments-to-individuals',
    label: 'Выплаты физлицам',
    essence:
      'Соцподдержка целевиков, компенсация найма жилья и выездов — выдача по ведомости или через подотчётное лицо; контракта здесь не будет никогда.',
    subclass: 'individual-payments',
  },
  {
    id: 'fees-without-contract',
    label: 'Взносы и платежи без договора',
    essence: 'Фонд капремонта и подобные взносы: контракт не заключается, оплата по счёту.',
    subclass: 'no-contract-payment',
  },
  {
    id: 'events-by-estimates',
    label: 'Мероприятия по сметам',
    essence:
      'Тематические мероприятия и фестивали с журналом из многих контрактов и смешанной оплатой (подотчёт плюс контракт).',
    subclass: 'contract-series',
  },
  {
    id: 'one-off-equipping',
    label: 'Разовое оснащение серией мелких контрактов',
    essence:
      'Пограничный случай: по механике — серия контрактов, по природе — разовая статья (пример: депутатские наказы).',
    subclass: 'contract-series',
  },
] as const;

/** Вид по id — для валидации разметки и подписи на экране. */
export const YEARLONG_KIND_BY_ID: ReadonlyMap<YearlongKindId, YearlongKind> = new Map(
  YEARLONG_KINDS.map((k) => [k.id, k]),
);

/** Все допустимые id видов (валидация «вид только из девяти» на сервере). */
export const YEARLONG_KIND_IDS: readonly YearlongKindId[] = YEARLONG_KINDS.map((k) => k.id);

/** Является ли значение id одного из девяти видов. */
export function isYearlongKindId(value: unknown): value is YearlongKindId {
  return typeof value === 'string' && (YEARLONG_KIND_IDS as readonly string[]).includes(value);
}

/** Подкласс строки по её виду; вид не размечен → null («вид не определён»). */
export function yearlongSubclassForKind(kind: YearlongKindId | null | undefined): YearlongSubclass | null {
  if (!kind) return null;
  return YEARLONG_KIND_BY_ID.get(kind)?.subclass ?? null;
}

// ────────────────────────────────────────────────────────────
// 4. Стартовая разметка 46 строк (п.83: анализ 14.08.2026)
// ────────────────────────────────────────────────────────────

/** Строка стартовой разметки: ключ — книга + № п/п (колонка A). */
export interface YearlongStartRow {
  /** Книга ГРБС (кириллический канон). */
  dept: DepartmentId;
  /** № п/п закупки — колонка A листа, устойчив к сдвигам строк. */
  ppNum: string;
  /** Вид §1.2 по анализу 14.08.2026. */
  kind: YearlongKindId;
  /** Плановый квартал (колонка O) — для отнесения к периоду. */
  planQuarter: 3 | 4;
  /** Месяц плановой даты (колонка N) — для месячных периметров. */
  planMonth: number;
  /** Итого план (колонка K), тыс. руб. — для вычета в тумблере п.82. */
  planSum: number;
  /** Предмет закупки (обрезан) — провенанс для человека, не ключ. */
  subject: string;
}

/** Устойчивый ключ строки стадии: книга + № п/п. */
export function yearlongKey(dept: string, ppNum: unknown): string {
  return `${dept}:${String(ppNum ?? '').trim()}`;
}

/**
 * Стартовая разметка всех 46 строк стадии — снята с полного дампа книг
 * 14.08.2026 (r01full: УКСиМП 40, УДТХ 3, УФБП 3; остальные пять книг — ноль).
 * Виды назначены по §1.2 спеки; итоги сверены с ней тестом до десятых:
 * план 8 733,3 тыс., по видам 13/3/9/2/3/7/3/5/1.
 * Владелец может переразметить любую строку кликом (п.83а) — пользовательская
 * разметка хранится на сервере и ПОБЕЖДАЕТ стартовую.
 */
export const YEARLONG_START_ROWS: readonly YearlongStartRow[] = [
  { dept: 'УФБП', ppNum: '15', kind: 'on-demand-supply', planQuarter: 3, planMonth: 9, planSum: 120.83651,
    subject: 'Приобретение компьютерных комплектующих, запасных частей…' },
  { dept: 'УФБП', ppNum: '20', kind: 'on-demand-supply', planQuarter: 4, planMonth: 12, planSum: 32.5,
    subject: 'Приобретение источников бесперебойного питания UPS' },
  { dept: 'УФБП', ppNum: '26', kind: 'on-demand-supply', planQuarter: 4, planMonth: 12, planSum: 20,
    subject: 'Приобретение запасных частей к компьютерной технике' },
  { dept: 'УДТХ', ppNum: '47', kind: 'on-demand-supply', planQuarter: 4, planMonth: 12, planSum: 225.84206,
    subject: 'Приобретение канц. товаров, офисной бумаги, хоз. товаров' },
  { dept: 'УДТХ', ppNum: '54', kind: 'post-and-telecom', planQuarter: 4, planMonth: 12, planSum: 152.9,
    subject: 'Почтовые услуги' },
  { dept: 'УДТХ', ppNum: '38', kind: 'post-and-telecom', planQuarter: 4, planMonth: 12, planSum: 25,
    subject: 'Услуги почтовой связи' },
  { dept: 'УКСиМП', ppNum: '3', kind: 'on-demand-supply', planQuarter: 3, planMonth: 9, planSum: 1500,
    subject: 'Окорока (куриные)' },
  { dept: 'УКСиМП', ppNum: '49', kind: 'periodicals-subscription', planQuarter: 3, planMonth: 9, planSum: 375,
    subject: 'Поставка периодических изданий' },
  { dept: 'УКСиМП', ppNum: '50', kind: 'periodicals-subscription', planQuarter: 3, planMonth: 9, planSum: 375,
    subject: 'Поставка периодических изданий (досрочная подписка)' },
  { dept: 'УКСиМП', ppNum: '1', kind: 'on-demand-supply', planQuarter: 3, planMonth: 9, planSum: 343.1965,
    subject: 'Фрукты' },
  { dept: 'УКСиМП', ppNum: '201', kind: 'fees-without-contract', planQuarter: 4, planMonth: 12, planSum: 250,
    subject: 'фонд капитального ремонта' },
  { dept: 'УКСиМП', ppNum: '334', kind: 'regular-mandatory-services', planQuarter: 3, planMonth: 9, planSum: 145,
    subject: 'медицинские услуги по проведению медицинских осмотров раб…' },
  { dept: 'УКСиМП', ppNum: '523', kind: 'regular-mandatory-services', planQuarter: 3, planMonth: 9, planSum: 100,
    subject: 'Противопожарные мероприятия (заправка огнетушителей, испы…' },
  { dept: 'УКСиМП', ppNum: '244', kind: 'regular-mandatory-services', planQuarter: 4, planMonth: 12, planSum: 70,
    subject: 'Технический осмотр ТС, ремонт ТС' },
  { dept: 'УКСиМП', ppNum: '268', kind: 'regular-mandatory-services', planQuarter: 3, planMonth: 9, planSum: 50,
    subject: 'Противопожарные мероприятия (заправка огнетушителей, испы…' },
  { dept: 'УКСиМП', ppNum: '546', kind: 'fees-without-contract', planQuarter: 4, planMonth: 12, planSum: 47.87172,
    subject: 'взносы за кап.ремонт' },
  { dept: 'УКСиМП', ppNum: '407', kind: 'qualification-courses', planQuarter: 4, planMonth: 11, planSum: 45,
    subject: 'Курсы повышения квалификации' },
  { dept: 'УКСиМП', ppNum: '415', kind: 'regular-mandatory-services', planQuarter: 4, planMonth: 12, planSum: 44.286,
    subject: 'Обслуживание ТС: ремонт, шиномонтаж, мойка' },
  { dept: 'УКСиМП', ppNum: '43', kind: 'regular-mandatory-services', planQuarter: 3, planMonth: 8, planSum: 40.5,
    subject: 'Услуги по техническому обслуживанию теплосчетчиков' },
  { dept: 'УКСиМП', ppNum: '158', kind: 'payments-to-individuals', planQuarter: 4, planMonth: 12, planSum: 89,
    subject: 'Социальная поддержка лиц, обучающихся по программам средн…' },
  { dept: 'УКСиМП', ppNum: '87', kind: 'post-and-telecom', planQuarter: 4, planMonth: 12, planSum: 32.28,
    subject: 'Услуги телекоммуникационные (Интернет)' },
  { dept: 'УКСиМП', ppNum: '214', kind: 'qualification-courses', planQuarter: 4, planMonth: 12, planSum: 30,
    subject: 'Курсы повышения квалификации' },
  { dept: 'УКСиМП', ppNum: '231', kind: 'payments-to-individuals', planQuarter: 4, planMonth: 11, planSum: 480,
    subject: 'Компенсация расходов работникам, связанных с наймом жилья' },
  { dept: 'УКСиМП', ppNum: '286', kind: 'regular-mandatory-services', planQuarter: 3, planMonth: 8, planSum: 26.12412,
    subject: 'Противопожарные мероприятия (заправка огнетушителей, испы…' },
  { dept: 'УКСиМП', ppNum: '152', kind: 'regular-mandatory-services', planQuarter: 4, planMonth: 10, planSum: 25,
    subject: 'Противопожарные мероприятия (заправка огнетушителей, испы…' },
  { dept: 'УКСиМП', ppNum: '213', kind: 'regular-mandatory-services', planQuarter: 4, planMonth: 12, planSum: 25,
    subject: 'Противопожарные мероприятия (заправка огнетушителей, испы…' },
  { dept: 'УКСиМП', ppNum: '315', kind: 'payments-to-individuals', planQuarter: 4, planMonth: 12, planSum: 146.6,
    subject: 'Социальная поддержка лиц, обучающихся по программам средн…' },
  { dept: 'УКСиМП', ppNum: '316', kind: 'payments-to-individuals', planQuarter: 3, planMonth: 9, planSum: 200,
    subject: 'Компенсация расходов, связанных с выездом на соревнования' },
  { dept: 'УКСиМП', ppNum: '448', kind: 'fees-without-contract', planQuarter: 4, planMonth: 12, planSum: 21.48544,
    subject: 'Фонд капитального ремонта' },
  { dept: 'УКСиМП', ppNum: '242', kind: 'regular-mandatory-services', planQuarter: 4, planMonth: 12, planSum: 20,
    subject: 'Обязательное страхование автогражданской ответственности…' },
  { dept: 'УКСиМП', ppNum: '344', kind: 'events-by-estimates', planQuarter: 3, planMonth: 9, planSum: 561.3,
    subject: 'Услуги по проведению мероприятий (Федерация)' },
  { dept: 'УКСиМП', ppNum: '535', kind: 'regular-mandatory-services', planQuarter: 4, planMonth: 12, planSum: 20,
    subject: 'Обязательное страхование автогражданской ответственности…' },
  { dept: 'УКСиМП', ppNum: '567', kind: 'regular-mandatory-services', planQuarter: 3, planMonth: 9, planSum: 13.5,
    subject: 'Услуги дератизации, дезинсекции' },
  { dept: 'УКСиМП', ppNum: '431', kind: 'events-by-estimates', planQuarter: 3, planMonth: 8, planSum: 973.956,
    subject: 'Поддержка национальных и казачьих ансамблей (фестиваль)' },
  { dept: 'УКСиМП', ppNum: '433', kind: 'events-by-estimates', planQuarter: 4, planMonth: 11, planSum: 412.76,
    subject: 'Проведение тематических мероприятий по сметам (9 меропри…' },
  { dept: 'УКСиМП', ppNum: '436', kind: 'events-by-estimates', planQuarter: 3, planMonth: 9, planSum: 35,
    subject: 'Районный конкурс «Служить России!», акции, листовки' },
  { dept: 'УКСиМП', ppNum: '455', kind: 'events-by-estimates', planQuarter: 3, planMonth: 9, planSum: 220,
    subject: 'Проведение тематических мероприятий по сметам (2 меропри…' },
  { dept: 'УКСиМП', ppNum: '476', kind: 'one-off-equipping', planQuarter: 3, planMonth: 8, planSum: 500.012,
    subject: 'Приобретение аппаратуры, сценических костюмов, реквизита…' },
  { dept: 'УКСиМП', ppNum: '482', kind: 'payments-to-individuals', planQuarter: 4, planMonth: 12, planSum: 720,
    subject: 'Компенсация расходов работникам учреждения за найм жилья' },
  { dept: 'УКСиМП', ppNum: '397', kind: 'on-demand-supply', planQuarter: 4, planMonth: 12, planSum: 10,
    subject: 'Ремонт принтеров, МФУ' },
  { dept: 'УКСиМП', ppNum: '465', kind: 'qualification-courses', planQuarter: 4, planMonth: 12, planSum: 7.469,
    subject: 'Курсы повышения квалификации' },
  { dept: 'УКСиМП', ppNum: '296', kind: 'regular-mandatory-services', planQuarter: 4, planMonth: 12, planSum: 5.14127,
    subject: 'Противопожарные мероприятия' },
  { dept: 'УКСиМП', ppNum: '547', kind: 'payments-to-individuals', planQuarter: 4, planMonth: 12, planSum: 89,
    subject: 'Социальная поддержка лиц, обучающихся по программам средн…' },
  { dept: 'УКСиМП', ppNum: '549', kind: 'payments-to-individuals', planQuarter: 4, planMonth: 11, planSum: 100,
    subject: 'Компенсация расходов, связанных с выездом на соревнования' },
  { dept: 'УКСиМП', ppNum: '155', kind: 'on-demand-supply', planQuarter: 3, planMonth: 9, planSum: 3.5,
    subject: 'Заправка и восстановление картриджей' },
  { dept: 'УКСиМП', ppNum: '389', kind: 'on-demand-supply', planQuarter: 4, planMonth: 12, planSum: 3.201,
    subject: 'Строительные материалы для текущего ремонта' },
] as const;

/** Стартовая разметка по ключу «книга:№ п/п». */
export const YEARLONG_START_BY_KEY: ReadonlyMap<string, YearlongStartRow> = new Map(
  YEARLONG_START_ROWS.map((r) => [yearlongKey(r.dept, r.ppNum), r]),
);

/**
 * Вид строки стадии: пользовательская разметка (с сервера) побеждает
 * стартовую; нет ни той ни другой → null («вид не определён» — нейтрально).
 */
export function resolveYearlongKind(
  dept: string,
  ppNum: unknown,
  overrides?: ReadonlyMap<string, YearlongKindId> | null,
): YearlongKindId | null {
  const key = yearlongKey(dept, ppNum);
  const overridden = overrides?.get(key);
  if (overridden) return overridden;
  return YEARLONG_START_BY_KEY.get(key)?.kind ?? null;
}

// ────────────────────────────────────────────────────────────
// 5. «Хотелки» — стадия «инициативная заявка» (п.76)
// ────────────────────────────────────────────────────────────

/**
 * Словарь маркеров «инициативная заявка» — ровно три написания из книги УО
 * (88 ячеек AF: «хотелки» 48, «Хотелки» 20, «просто хотелки» 20; п.76а).
 * Маркер — КОД, как «Х»: читается структурно, только когда содержимое ячейки
 * ЦЕЛИКОМ равно маркеру; вхождение слова внутри текста маркером НЕ является
 * (иначе это было бы чтение свободного текста — запрещено п.27).
 */
export const INITIATIVE_MARKERS = ['хотелки', 'Хотелки', 'просто хотелки'] as const;

/** Нормализованные формы словаря (регистр приведён, оба написания). */
const INITIATIVE_MARKERS_NORM: ReadonlySet<string> = new Set(
  INITIATIVE_MARKERS.map((m) => m.toLowerCase()),
);

/**
 * true, если ячейка примечания (AF) целиком — маркер инициативной заявки.
 * Сравнение после трима и приведения регистра: покрывает ровно три написания
 * словаря (и их регистровые варианты), не разрастаясь на свободный текст.
 */
export function isInitiativeMarker(afCell: unknown): boolean {
  if (typeof afCell !== 'string') return false;
  return INITIATIVE_MARKERS_NORM.has(afCell.trim().toLowerCase());
}

/** Подпись стадии инициативной заявки (п.76б). */
export const INITIATIVE_STAGE_LABEL = 'инициативная заявка без подтверждённой потребности';

/** Итог инициативных заявок по строкам: счёт и план для подписи «в т.ч.». */
export interface InitiativeTotals {
  rows: number;
  /** Сумма плана размеченных строк, тыс. руб. */
  planSum: number;
}

/** Считает инициативные заявки по любому набору строк с AF и планом. */
export function sumInitiativeRows(
  rows: ReadonlyArray<{ commentGRBS?: unknown; planSum?: unknown }>,
): InitiativeTotals {
  let count = 0;
  let plan = 0;
  for (const r of rows) {
    if (!isInitiativeMarker(r.commentGRBS)) continue;
    count += 1;
    plan += typeof r.planSum === 'number' && Number.isFinite(r.planSum) ? r.planSum : 0;
  }
  return { rows: count, planSum: plan };
}

// ────────────────────────────────────────────────────────────
// 6. Правило дожития инициативной заявки (п.76в)
// ────────────────────────────────────────────────────────────

/** Входы правила дожития — структурные ячейки строки плюс момент снимка. */
export interface InitiativeReviewInput {
  /** Ячейка примечания AF (маркер стадии). */
  commentGRBS: unknown;
  /** Итого факт (колонка Y), тыс. руб. */
  factSum: number;
  /** Дата заключения Q сырьём листа. */
  factDateCell: unknown;
  /** Год плана (колонка P); не распознан → 0. */
  planYear: number;
}

/** Начало 4 квартала данного года — рубеж правила дожития (п.76в). */
export function q4StartOf(planYear: number): Date {
  return new Date(Date.UTC(planYear, 9, 1)); // 1 октября, месяцы с нуля
}

/**
 * Правило дожития (п.76в): инициативная заявка без движения к началу
 * 4 квартала поднимается управлению карточкой «подтвердить или снять».
 * «Без движения» — структурно: факт нулевой и заключения нет (заглушка).
 * Года плана нет (0) — правило молчит: рубеж не к чему привязать, а
 * докручивать чужой год предикат не вправе.
 *
 * Здесь только предикат (экранная карточка — следующей волной): true =
 * карточку пора показывать на момент `asOf`.
 */
export function initiativeReviewDue(row: InitiativeReviewInput, asOf: Date): boolean {
  if (!isInitiativeMarker(row.commentGRBS)) return false;
  if (row.planYear <= 0) return false;
  const noMovement = row.factSum <= 0 && isAbsentCell(row.factDateCell);
  if (!noMovement) return false;
  return asOf.getTime() >= q4StartOf(row.planYear).getTime();
}
