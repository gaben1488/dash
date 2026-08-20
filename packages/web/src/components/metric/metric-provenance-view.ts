/**
 * metric-provenance-view.ts — родословная числа, переведённая на язык экрана
 * (канон п.104, 18.08.2026).
 *
 * ЗАЧЕМ. Продукт показывает без малого сотню чисел, и все они выглядят
 * одинаково — цифра на плитке. Читатель не может отличить число, снятое с
 * официального листа, от числа, которое мы придумали сами. Карта
 * `@aemr/shared/metric-provenance.ts` уже отвечает на этот вопрос данными;
 * здесь она превращается в четыре понятных читателю класса и в готовые
 * подписи, чтобы ни один экран не сочинял формулировку заново.
 *
 * ЧЕТЫРЕ КЛАССА и почему именно они:
 *   • «совпадает» — источник считает так же, число обязано сходиться;
 *   • «расходится» — источник считает иначе; разница названа вслух, потому
 *     что молчащее расхождение читатель принимает за нашу ошибку счёта;
 *   • «сирота» — показателя нет ни в одном из пяти документов, он наш;
 *     показывать такое не запрещено, запрещено показывать МОЛЧА;
 *   • «пробел» — источник дал данные, но сам такого показателя не считает:
 *     обе половины дроби лежат на листе, дробь построили мы.
 *
 * ПОРЯДОК РАЗБОРА важен. Расхождение проверяется первым: показатель может
 * быть одновременно нашей инициативой и расходиться с листом
 * (`lifecycle_type_unknown` — наш периметр «ВСЕ» шире листового «*»), и
 * тогда предупреждение важнее происхождения.
 *
 * Модуль чистый: ни React, ни хранилища. Это позволяет проверять разбор
 * без jsdom и переиспользовать подписи в любом месте — попап, значок,
 * будущий экран сводки происхождения.
 */
import {
  METRIC_SOURCE_LABELS,
  metricProvenance,
  type MetricProvenance,
  type MetricSourceId,
} from '@aemr/shared';

/** Отношение нашего числа к источнику — так, как его читает человек. */
export type ProvenanceClass = 'exact' | 'divergent' | 'orphan' | 'gap';

/** Готовая к показу карточка происхождения одного показателя. */
export interface ProvenanceCard {
  readonly metricKey: string;
  /** Класс отношения к источнику. */
  readonly kind: ProvenanceClass;
  readonly sourceId: MetricSourceId;
  /** Человеческое имя источника («Лист „СВОД ТД-ПМ“» и т. п.). */
  readonly sourceLabel: string;
  /** Одна фраза-вердикт для шапки блока. */
  readonly verdict: string;
  /** Как считает ИСТОЧНИК — дословно из карты. */
  readonly howSourceCounts: string;
  /** Адрес на листе либо в документе, если он известен точно. */
  readonly sheetRef?: string;
  /** Расхождение, оговорка либо обоснование инициативы. */
  readonly note?: string;
}

/**
 * Вердикты классов. Тон п.53 — объяснение механизма, не упрёк: «считаем
 * иначе», а не «ошибка»; «в источниках не значится», а не «выдумано».
 */
export const PROVENANCE_VERDICTS: Readonly<Record<ProvenanceClass, string>> = {
  exact: 'Считаем так же, как источник',
  divergent: 'Считаем иначе, чем источник',
  orphan: 'Наша инициатива — в источниках не значится',
  gap: 'Источник даёт данные, но такого показателя не считает',
};

/** Разбор записи карты на класс. Расхождение старше происхождения — см. шапку. */
export function classifyProvenance(provenance: MetricProvenance): ProvenanceClass {
  if (provenance.match === 'divergent') return 'divergent';
  if (provenance.source === 'own') return 'orphan';
  if (provenance.match === 'initiative') return 'gap';
  return 'exact';
}

/**
 * Карточка происхождения показателя либо null, если родословная не
 * установлена. Null здесь — честная пустота, а не ошибка: показатель просто
 * не попал в карту, и попап обязан вести себя так, будто блока не было.
 */
export function provenanceCard(metricKey: string): ProvenanceCard | null {
  const provenance = metricProvenance(metricKey);
  if (!provenance) return null;
  const kind = classifyProvenance(provenance);
  return {
    metricKey,
    kind,
    sourceId: provenance.source,
    sourceLabel: METRIC_SOURCE_LABELS[provenance.source],
    verdict: PROVENANCE_VERDICTS[kind],
    howSourceCounts: provenance.howSourceCounts,
    ...(provenance.sheetRef ? { sheetRef: provenance.sheetRef } : {}),
    ...(provenance.note ? { note: provenance.note } : {}),
  };
}

/**
 * Текст значка-предупреждения у числа либо null, если наш счёт сходится с
 * источником. Значок нужен потому, что расхождение обязано быть видно ДО
 * наведения: десять чисел продукта считаются не так, как их считает документ,
 * и читатель, который никогда не откроет попап, всё равно должен это знать.
 */
export function divergenceWarning(metricKey: string): string | null {
  const provenance = metricProvenance(metricKey);
  if (!provenance || provenance.match !== 'divergent') return null;
  const head =
    `На источнике считается иначе (${METRIC_SOURCE_LABELS[provenance.source]}): ` +
    provenance.howSourceCounts;
  return provenance.note ? `${head}\nВ чём разница: ${provenance.note}` : head;
}

/** Показатель расходится с источником — короткий предикат для вёрстки. */
export function isDivergent(metricKey: string): boolean {
  return metricProvenance(metricKey)?.match === 'divergent';
}
