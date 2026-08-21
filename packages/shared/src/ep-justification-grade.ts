/**
 * Обоснованность закупки у единственного поставщика — канон п.98ж
 * (идея руководства 18.08.2026: «показывать, насколько меньше становится ЕП и
 * особенно НЕОБОСНОВАННОГО ЕП; категория обоснованный ЕП: монополисты,
 * направляли КП в адрес УЭР, наименьшая цена и т. д.»).
 *
 * Словарь причин (dictionaries/ep-reason-clusters.ts) отвечает на вопрос «что
 * написал исполнитель». Этот модуль отвечает на другой вопрос — «имел ли он
 * право так закупать и чем это подтверждается», и делит причины на четыре
 * степени по ДВУМ основаниям сразу:
 *
 *   1. Закон (44-ФЗ). Часть причин прямо названа в статье 93: монополия,
 *      авария, охрана Росгвардии, исключительные права издателя и разработчика,
 *      несостоявшаяся процедура, малый объём. Такая закупка законна сама по
 *      себе, спорить не о чем.
 *   2. Наша практика. Часть причин закон не называет, но район подтверждает их
 *      процедурой: направили коммерческие предложения, согласовали с УЭР,
 *      выбрали наименьшую цену. Это не безальтернативность, а доказанная
 *      выгода — и она проверяема документом.
 *
 * Остальное — усмотрение заказчика («нецелесообразно проводить аукцион»,
 * «для оперативности») либо пустота. Именно последние две степени и есть тот
 * ЕП, который район хочет сокращать; первые две сокращать бессмысленно —
 * монополиста конкурсом не заменить.
 *
 * ВАЖНО (канон п.27): степень выводится ИЗ КЛАСТЕРА причины, а кластер — из
 * словаря по колонке M. Свободный текст здесь машинно не толкуется: если
 * причина не распозналась, степень честно «не установлена», а не угадана.
 */
import { canonicalizeReasonEp } from './dictionaries/ep-reason-clusters.js';
import type { EpReasonCluster } from './dictionaries/ep-reason-clusters.js';

export type EpJustificationGrade =
  /** Закон прямо разрешает: конкуренции нет по природе предмета. */
  | 'lawful-exclusive'
  /** Наша практика подтверждает выгоду документом: КП, согласование, цена. */
  | 'verified-benefit'
  /** Усмотрение заказчика: причина названа, но проверить её нечем. */
  | 'discretionary'
  /** Обоснования нет: пусто, не распознано либо названа не та процедура. */
  | 'unfounded';

export interface EpGradeEntry {
  grade: EpJustificationGrade;
  /** Чем подтверждается — фраза для карточки. */
  evidence: string;
}

/** Подписи степеней для экрана. */
export const EP_GRADE_LABELS: Readonly<Record<EpJustificationGrade, string>> = {
  'lawful-exclusive': 'Безальтернативная по закону',
  'verified-benefit': 'Выгода подтверждена документом',
  discretionary: 'Решение заказчика',
  unfounded: 'Без обоснования',
};

/** Что каждая степень означает — подсказка на экране, тон объяснения. */
export const EP_GRADE_EXPLAIN: Readonly<Record<EpJustificationGrade, string>> = {
  'lawful-exclusive':
    'Закон прямо допускает закупку у единственного поставщика: конкуренции ' +
    'нет по природе предмета — монополия, охрана, исключительные права, ' +
    'авария, несостоявшаяся процедура. Сокращать такие закупки конкурсом нельзя.',
  'verified-benefit':
    'Безальтернативности нет, но выгода подтверждена процедурой: собраны ' +
    'коммерческие предложения, выбрана наименьшая цена, решение согласовано ' +
    'с управлением экономического развития. Проверяется документом.',
  discretionary:
    'Причина названа, но проверить её нечем: нецелесообразность, срочность, ' +
    'удобство поставщика. Именно этот слой закупок сокращается объединением ' +
    'и выходом на торги.',
  unfounded:
    'Обоснование отсутствует, не распознано либо названа процедура вместо ' +
    'основания. Такую закупку нечем защитить при проверке.',
};

/**
 * Кластер причины → степень обоснованности.
 *
 * Разнесение сделано по правовому основанию кластера и по тому, оставляет ли
 * причина документальный след. Спорные случаи разобраны в комментариях: они
 * и есть материал для разговора с владельцем (канон п.98ж — «оценить и
 * указать, если у нас это не совсем гуд»).
 */
export const EP_GRADE_BY_CLUSTER: Readonly<Record<string, EpGradeEntry>> = {
  // ── Закон: конкуренции нет по природе предмета ──
  EP_MONOPOLY: { grade: 'lawful-exclusive', evidence: 'Субъект естественной монополии (п. 1 ч. 1 ст. 93)' },
  EP_UTILITIES: { grade: 'lawful-exclusive', evidence: 'Коммунальный ресурс от единственной сети' },
  EP_SOLE_SUPPLIER_RESOURCE: { grade: 'lawful-exclusive', evidence: 'Единственный поставщик ресурса на территории' },
  EP_SOLE_LOCAL_PROVIDER: { grade: 'lawful-exclusive', evidence: 'На территории района исполнитель один' },
  EP_ROSGVARDIA: { grade: 'lawful-exclusive', evidence: 'Охрана силами Росгвардии (п. 6 ч. 1 ст. 93)' },
  EP_PUBLISHER_EXCLUSIVE: { grade: 'lawful-exclusive', evidence: 'Исключительные права издателя (п. 14 ч. 1 ст. 93)' },
  EP_SOFTWARE_DEV: { grade: 'lawful-exclusive', evidence: 'Правообладатель программы' },
  EP_EMERGENCY: { grade: 'lawful-exclusive', evidence: 'Авария либо чрезвычайная ситуация (п. 9 ч. 1 ст. 93)' },
  EP_PRESCRIPTION: { grade: 'lawful-exclusive', evidence: 'Предписание надзорного органа' },
  EP_AUCTION_FAILED: { grade: 'lawful-exclusive', evidence: 'Процедура не состоялась (п. 25 ч. 1 ст. 93)' },
  EP_ART93_DIRECT: { grade: 'lawful-exclusive', evidence: 'Прямая ссылка на пункт статьи 93' },
  EP_LAW_223: { grade: 'lawful-exclusive', evidence: 'Закупка по положению 223-ФЗ, вне 44-ФЗ' },
  // Малый объём — законное основание (п. 4 ч. 1 ст. 93), но именно эти закупки
  // объединяются в совместные торги: закон разрешает, экономика подсказывает
  // обратное. Степень «по закону», а сокращение идёт через объединение.
  EP_SMALL_VOLUME: { grade: 'lawful-exclusive', evidence: 'Закупка малого объёма (п. 4 ч. 1 ст. 93)' },
  EP_NAMED_SOLE: { grade: 'lawful-exclusive', evidence: 'Назван безальтернативный поставщик' },
  EP_MONOPOLIST: { grade: 'lawful-exclusive', evidence: 'Естественный монополист (147-ФЗ)' },
  EP_ART93_SUBJECT: { grade: 'lawful-exclusive', evidence: 'Субъект-основание статьи 93' },

  // ── Наша практика: выгода подтверждена документом ──
  EP_UER_APPROVED: { grade: 'verified-benefit', evidence: 'Согласовано с управлением экономического развития' },
  EP_QUOTES_LOWEST: { grade: 'verified-benefit', evidence: 'Собраны коммерческие предложения, цена наименьшая' },
  EP_LOWEST_PRICE: { grade: 'verified-benefit', evidence: 'Цена ниже расчётной начальной цены' },
  EP_OFFICIAL_DEALER: { grade: 'verified-benefit', evidence: 'Авторизованный дилер марки' },
  // Распоряжение администрации № 112 — местный акт: не статья 93, но и не
  // усмотрение исполнителя, решение принято на уровне района.
  EP_DECREE_112: { grade: 'verified-benefit', evidence: 'Распоряжение администрации района № 112' },
  EP_DECREE_112_SHORT: { grade: 'verified-benefit', evidence: 'Распоряжение администрации района № 112' },
  EP_GOVERNOR_ORDER: { grade: 'verified-benefit', evidence: 'Поручение губернатора края' },
  EP_DECREE_112_FULL: { grade: 'verified-benefit', evidence: 'Распоряжение администрации района № 112' },
  EP_LOCAL_PROD: { grade: 'verified-benefit', evidence: 'Местный производитель по поручению губернатора' },
  EP_LOCAL_VENDOR: { grade: 'verified-benefit', evidence: 'Местный производитель по поручению губернатора' },
  // Самая частая формулировка корпуса (381 строка). Выгода названа, но
  // подтверждается она только собранными предложениями — их наличие проверяет
  // отдельный вопрос владельцу: требовать ли ссылку на КП в этой формулировке.
  EP_CONCLUDE_LOWEST: { grade: 'verified-benefit', evidence: 'Заключение по наименьшей цене' },
  EP_LOWEST_COST: { grade: 'verified-benefit', evidence: 'Наименьшая стоимость услуг' },

  // ── Усмотрение заказчика: причина есть, проверить нечем ──
  EP_NOT_WORTHWHILE: { grade: 'discretionary', evidence: 'Сочли проведение аукциона нецелесообразным' },
  EP_URGENCY: { grade: 'discretionary', evidence: 'Срочность закупки' },
  EP_LOGISTICS: { grade: 'discretionary', evidence: 'Удобное расположение поставщика' },
  EP_MIXED_NOMENCLATURE: { grade: 'discretionary', evidence: 'Разнородная номенклатура' },
  EP_LIMITED_MARKET: { grade: 'discretionary', evidence: 'Мало подрядчиков на рынке' },
  EP_NO_BIDDERS: { grade: 'discretionary', evidence: 'Поставщики на торги не выходят' },

  // ── Обоснования нет ──
  EP_NONCOMPETITIVE: { grade: 'unfounded', evidence: 'Сказано «неконкурентная закупка» без причины' },
  // Малая электронная закупка — это ПРОЦЕДУРА (форма аукциона до 600 тыс.),
  // а не основание закупки у единственного поставщика: строка сама себе
  // противоречит (сигнал methodReasonMismatch).
  EP_SMALL_EL_PURCH: { grade: 'unfounded', evidence: 'Названа процедура аукциона, а не основание' },
  // «В соответствии с действующим законодательством» — 17 строк корпуса. Слова
  // есть, основания нет: закон не называет, проверить нечего.
  EP_CURRENT_LAW: { grade: 'unfounded', evidence: 'Сослались на законодательство без указания нормы' },
};

/** Степень для распознанного кластера; неизвестный кластер — «без обоснования». */
export function epGradeOfCluster(cluster: EpReasonCluster | 'EMPTY' | 'UNMAPPED' | string): EpGradeEntry {
  const hit = EP_GRADE_BY_CLUSTER[cluster];
  if (hit) return hit;
  if (cluster === 'EMPTY') return { grade: 'unfounded', evidence: 'Графа обоснования пуста' };
  return { grade: 'unfounded', evidence: 'Формулировка не распознана справочником' };
}

/**
 * Строгость «ЕП свыше 600 тыс.» — развилка по обоснованию.
 *
 * Решение владельца п.137(2) от 21.08.2026 (вариант C спеки консолидации,
 * дословно «как рекомендуешь»): класс критический при степенях «без
 * обоснования» и «решение заказчика», информационный при «безальтернативная по
 * закону» и «выгода подтверждена документом».
 *
 * Почему развилка, а не одно значение. До неё продукт спорил сам с собой:
 * реестр проверок оценивал класс как info (до 600 тыс. закупка законна, выше —
 * требует обоснования), а чип Реестра красил красным критическим. И спор был
 * не только о тоне: из 76 красных чипов у 60 соседняя вкладка держала наготове
 * оправдание (40 — «безальтернативная по закону», 20 — «выгода подтверждена
 * документом»), и лишь по четырём строкам обе поверхности говорили одно и то
 * же. Красный чип на монополисте — не риск, а шум, который обесценивал
 * остальные шестнадцать.
 *
 * ДОМ ПРАВИЛА ОДИН — здесь. Строгость спрашивают три поверхности: чип Реестра,
 * замечание конвейера и проверка источника на сервере. Развилка, записанная
 * в одной из трёх, разъехалась бы на следующем снимке — ровно так продукт и
 * нажил шесть подписей на один класс.
 */
export type EpRiskStrictness = 'critical' | 'info';

/** Степени, при которых закупка свыше лимита остаётся риском. */
export const EP_RISK_STRICT_GRADES: readonly EpJustificationGrade[] = ['unfounded', 'discretionary'];

/** Строгость ЕП-риска по уже известной степени обоснованности. */
export function epRiskStrictnessOfGrade(grade: EpJustificationGrade): EpRiskStrictness {
  return EP_RISK_STRICT_GRADES.includes(grade) ? 'critical' : 'info';
}

/**
 * Строгость ЕП-риска по тексту графы M (обоснование).
 *
 * Степень читается тем же словарём кластеров, что и вкладка «Конкуренция»:
 * второго механизма законности здесь не заводится. Нераспознанная и пустая
 * формулировка даёт степень «без обоснования» — то есть строгий конец
 * развилки: судить не о чем, значит и снисхождения нет.
 */
export function epRiskStrictnessOfReason(reason: unknown): EpRiskStrictness {
  const text = typeof reason === 'string' ? reason : '';
  // Тот же предел длины, что в конвейере (защита от разбора гигантской ячейки):
  // регулярные выражения части кластеров содержат «.*».
  const { cluster } = canonicalizeReasonEp(text.slice(0, EP_REASON_SCAN_LIMIT));
  return epRiskStrictnessOfGrade(epGradeOfCluster(cluster).grade);
}

/** Предел разбора текста обоснования — общий для всех вызывающих. */
export const EP_REASON_SCAN_LIMIT = 2000;

export interface EpGradeTotals {
  /** Строк и денег по каждой степени. */
  byGrade: Record<EpJustificationGrade, { rows: number; sum: number }>;
  rows: number;
  sum: number;
  /** Доля денег, которую можно вывести на торги (усмотрение + без обоснования). */
  reducibleShare: number | null;
  /** Деньги той же группы — «сокращаемый ЕП». */
  reducibleSum: number;
}

const EMPTY_TOTALS = (): Record<EpJustificationGrade, { rows: number; sum: number }> => ({
  'lawful-exclusive': { rows: 0, sum: 0 },
  'verified-benefit': { rows: 0, sum: 0 },
  discretionary: { rows: 0, sum: 0 },
  unfounded: { rows: 0, sum: 0 },
});

/**
 * Свод по степеням. «Сокращаемым» считается ЕП последних двух степеней:
 * монополиста и аварию конкурсом не заменить, а решение заказчика и пустое
 * обоснование — можно. Именно эта доля и есть цель района.
 */
export function epGradeTotals(
  rows: readonly { cluster: string; sum: number }[],
): EpGradeTotals {
  const byGrade = EMPTY_TOTALS();
  let rowsTotal = 0;
  let sumTotal = 0;
  for (const r of rows) {
    const { grade } = epGradeOfCluster(r.cluster);
    const money = Number.isFinite(r.sum) ? r.sum : 0;
    byGrade[grade].rows += 1;
    byGrade[grade].sum += money;
    rowsTotal += 1;
    sumTotal += money;
  }
  const reducibleSum = byGrade.discretionary.sum + byGrade.unfounded.sum;
  return {
    byGrade,
    rows: rowsTotal,
    sum: Math.round(sumTotal * 100) / 100,
    reducibleSum: Math.round(reducibleSum * 100) / 100,
    reducibleShare: sumTotal > 0 ? Math.round((reducibleSum / sumTotal) * 1000) / 10 : null,
  };
}
