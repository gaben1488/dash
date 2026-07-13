export const ECONOMY_EMPTY_STATE_COPY = {
  title: 'Нет данных по экономии',
  body: 'Экономия считается только по утвержденным строкам: факт-дата заполнена, AD="да", сумма Z+AA+AB. Данные появятся после загрузки из Google Sheets.',
} as const;

/** Russian plural: pluralRu(1,'строка','строки','строк') → 'строка' */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d > 1 && d < 5) return few;
  if (d === 1) return one;
  return many;
}

export interface EconomyBannerInput {
  /** Конфликты флага экономии (по ОТФИЛЬТРОВАННЫМ депам). */
  conflicts: number;
  /** Число ГРБС/строк с экономией >25% (по ОТФИЛЬТРОВАННЫМ депам). */
  over25?: number;
}

export interface EconomyBannerStatus {
  ok: boolean;
  tone: 'ok' | 'warn';
  /** Текст после «{сумма} экономии{фильтр} • ». */
  label: string;
}

/**
 * Статус assertion-баннера страницы «Экономия».
 *
 * «В норме» — ТОЛЬКО когда нет ни отклонений >25%, ни конфликтов флага
 * экономии. Прежняя логика игнорировала конфликты и показывала «Все
 * показатели в норме» рядом со 120 расхождениями (баг T7).
 */
export function economyBannerStatus(input: EconomyBannerInput): EconomyBannerStatus {
  const conflicts = input.conflicts ?? 0;
  const over25 = input.over25 ?? 0;
  const ok = conflicts === 0 && over25 === 0;
  if (ok) {
    return { ok: true, tone: 'ok', label: 'Все показатели в норме' };
  }
  const parts: string[] = [];
  if (over25 > 0) {
    const w = pluralRu(over25, 'строка', 'строки', 'строк');
    parts.push(`${over25} ${w} >25% — проверить по ст.37 44-ФЗ`);
  }
  if (conflicts > 0) {
    const w = pluralRu(conflicts, 'строка', 'строки', 'строк');
    parts.push(`${conflicts} ${w} с конфликтом флага экономии — проверить`);
  }
  return { ok: false, tone: 'warn', label: parts.join(' • ') };
}

export interface EconomyInsightDept {
  dept: string;
  economy: number;
}

export interface EconomyInsightInput {
  /**
   * ОТФИЛЬТРОВАННЫЙ набор депов (только выбранные). Лидер считается строго
   * по нему — чужой ГРБС физически не может попасть в фразу.
   */
  depts: EconomyInsightDept[];
  totalEconomy: number;
  totalPlan: number;
  /** Экономия по МБ (по отфильтрованному набору). */
  mbEconomy: number;
  /** Число ГРБС с экономией >25% (по отфильтрованному набору). */
  highEconomyCount: number;
  /** Конфликты флага экономии (по отфильтрованному набору). */
  conflicts: number;
  formatMoney: (v: number) => string;
}

/**
 * Одно-предложный авто-инсайт страницы «Экономия».
 *
 * Все слагаемые считаются по переданному отфильтрованному набору `depts`.
 * Лидер выбирается из него же, а хвост про расхождения формулируется
 * нейтрально («конфликт флага экономии»), без хардкода чужого ГРБС
 * «УФБП/ГРБС» (баг T7).
 */
export function buildEconomyInsight(input: EconomyInsightInput): string {
  const {
    depts,
    totalEconomy,
    totalPlan,
    mbEconomy,
    highEconomyCount,
    conflicts,
    formatMoney,
  } = input;

  const parts: string[] = [];
  const pct = totalPlan > 0 ? (totalEconomy / totalPlan) * 100 : 0;
  parts.push(`Экономия ${formatMoney(totalEconomy)} (${pct.toFixed(1)}% от лимита).`);

  const leader = depts.reduce<EconomyInsightDept | null>(
    (best, d) => (best === null || d.economy > best.economy ? d : best),
    null,
  );
  if (leader) {
    parts.push(`Лидер — ${leader.dept} (${formatMoney(leader.economy)}).`);
  }

  const mbShare = totalEconomy > 0 ? ((mbEconomy / totalEconomy) * 100).toFixed(0) : '0';
  parts.push(`МБ = ${mbShare}% экономии.`);

  if (highEconomyCount > 0) {
    parts.push(`${highEconomyCount} ГРБС с экономией >25% — проверить ст.37 44-ФЗ.`);
  }
  if (conflicts > 0) {
    const w = pluralRu(conflicts, 'строка', 'строки', 'строк');
    parts.push(`${conflicts} ${w} с конфликтом флага экономии.`);
  }

  return parts.join(' ');
}
