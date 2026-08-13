/**
 * Anticorruption module — Layer C of the decision-engine port (aemr-bot passport 09).
 *
 * Каждый индикатор = «ТРЕБУЕТ ПРОВЕРКИ», НЕ обвинение (статистика ≠ детерминизм, ложные
 * срабатывания допустимы). Партиальный набор (на ТЕКУЩИХ данных, без cross-snapshot и ИНН):
 *   ✅ #1 splitting (дробление-индекс 0-100) — флагман, нового в dash не было
 *   ✅ #2 zero_competition (массовая нулевая экономия в конкурентных)
 *   ✅ #4 price_inflation (экономия лимит−факт >25%)
 *   ✅ #8 ep_over_limit (ЕП > 600К) — переиспользует порог 44-ФЗ в антикор-рамке
 *   ✅ #9 ep_annual_share (годовая доля ЕП > порога)
 *   🔌 #10 supplier_concentration — pluggable-заглушка (нужен ИНН поставщика, его пока нет в данных)
 *   ⏳ #3 reclassification / #6 mass_injection / #7 stagnation — нужна история снимков (cross-snapshot), позже
 *   ⏳ #5 collusion — нужно число участников, его нет в данных
 *
 * Флаги дают штраф к индексу дисциплины (Layer B): high −15, medium −10, low −5.
 */

import { LAW_44FZ, classifyEPReason } from './compliance-44fz.js';

export type AntiCorruptionIndicator =
  | 'splitting'
  | 'zero_competition'
  | 'price_inflation'
  | 'ep_over_limit'
  | 'ep_annual_share'
  | 'supplier_concentration';

export type FlagSeverity = 'low' | 'medium' | 'high';

export interface AntiCorruptionRow {
  rowIndex: number;
  method: string;
  planTotal: number;
  factTotal: number;
  economy: number;
  subject: string;
  /** #10 — опционально; пока отсутствует в данных. Когда появится — индикатор концентрации включится. */
  supplierInn?: string;
}

export interface AntiCorruptionFlag {
  indicator: AntiCorruptionIndicator;
  severity: FlagSeverity;
  /** 0-100, только для splitting */
  score?: number;
  rowIndex?: number;
  subject?: string;
  message: string;
}

export interface AntiCorruptionInput {
  rows: AntiCorruptionRow[];
  /** Годовые агрегаты для #9 (доля ЕП). */
  epTotal?: number;
  totalPlan?: number;
  /** Порог доли ЕП для роли ГРБС (по умолчанию 0.5). */
  epShareLimit?: number;
}

export interface AntiCorruptionResult {
  grbsId: string;
  flags: AntiCorruptionFlag[];
  /** Сумма штрафов для индекса дисциплины (Layer B). Отрицательная. */
  disciplinaryPenalty: number;
}

// Единицы: rows[].planTotal/factTotal/economy — тыс. руб. (канон колонок книг ГРБС),
// как и LAW_44FZ.epSingleContractLimit ниже. ECONOMY_EPSILON=1 значит 1 тыс. руб.,
// не 1 ₽ — подпись исправлена bug-hunt 2026-08-08 (БАГ #1).
const ECONOMY_EPSILON = 1; // тыс. ₽ — экономия |x|<1 тыс. считается нулевой (float/округление)

/** Штраф к дисциплине по severity. */
export function penaltyForSeverity(s: FlagSeverity): number {
  return s === 'high' ? -15 : s === 'medium' ? -10 : -5;
}

/** Нормализация предмета для группировки (без дат — группируем по предмету). */
function normalizeSubject(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * #1 Дробление — индекс 0-100 на группу однородных ЕП.
 * Без дат (ненадёжны): окно = весь период. Сигнал = много ЕП однородного предмета,
 * массово в «предлимитной» полосе (480-600 тыс. — чуть ниже потолка 600 тыс.), на крупную сумму.
 *
 * Единицы: rows[].planTotal — тыс. руб. (канон колонок книг ГРБС), поэтому limit/bandLow
 * и пороги суммы группы (10_000/20_000) — тоже тыс. руб. (10 млн / 20 млн руб.). До fix
 * bug-hunt 2026-08-08 (БАГ #1) planTotal сравнивался как рубли — предлимитная полоса
 * 480-600 тыс. требовала контрактов на полмиллиарда, недостижимо на реальных данных.
 */
export function detectSplitting(rows: AntiCorruptionRow[]): AntiCorruptionFlag[] {
  const epRows = rows.filter(r => r.method === 'ЕП' && r.planTotal > 0);
  const groups = new Map<string, AntiCorruptionRow[]>();
  for (const r of epRows) {
    const key = normalizeSubject(r.subject);
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const limit = LAW_44FZ.epSingleContractLimit; // 600 (тыс. руб.)
  const bandLow = limit * 0.8; // 480 (тыс. руб.) — «предлимитная» полоса
  const flags: AntiCorruptionFlag[] = [];

  for (const [subj, group] of groups) {
    if (group.length < 5) continue; // дробление имеет смысл от 5 контрактов
    let score = 0;
    score += 20;
    if (group.length >= 10) score += 10;

    const inBand = group.filter(r => r.planTotal >= bandLow && r.planTotal < limit).length;
    if (inBand / group.length > 0.6) score += 20;

    const total = group.reduce((s, r) => s + r.planTotal, 0); // тыс. руб.
    if (total > 10_000) score += 15; // 10 млн руб.
    if (total > 20_000) score += 10; // 20 млн руб.

    // однородность правового основания
    const clusters = new Set(group.map(r => classifyEPReason(r.subject)));
    if (clusters.size === 1) score += 20;

    score = Math.min(score, 100);
    if (score > 60) {
      flags.push({
        indicator: 'splitting',
        severity: 'high',
        score,
        subject: subj,
        message: `Возможное дробление: ${group.length} ЕП на однородный предмет «${subj}» на сумму ${(total / 1_000).toFixed(1)} млн ₽ (индекс ${score}/100) — требует проверки`,
      });
    }
  }
  return flags;
}

/**
 * #2 Нулевая конкуренция — массово: >50% конкурентных закупок дали ~0 экономии (при ≥5 конкурентных).
 * Возможна имитация конкуренции. Агрегатный флаг (не пер-строчный — иначе шум, см. SIGNAL_VALIDATION).
 */
export function detectZeroCompetition(rows: AntiCorruptionRow[]): AntiCorruptionFlag[] {
  const competitive = rows.filter(r => r.method !== 'ЕП' && r.factTotal > 0);
  if (competitive.length < 5) return [];
  const zero = competitive.filter(r => Math.abs(r.economy) < ECONOMY_EPSILON);
  const share = zero.length / competitive.length;
  if (share > 0.5) {
    return [{
      indicator: 'zero_competition',
      severity: 'medium',
      message: `Нулевая экономия в ${zero.length}/${competitive.length} (${(share * 100).toFixed(0)}%) конкурентных закупках — возможна имитация конкуренции, требует проверки`,
    }];
  }
  return [];
}

/**
 * #4 Завышение НМЦ — экономия (лимит−факт) > 25%. ⚠ это лимит-прокси, НМЦК в данных нет (как антидемпинг).
 */
export function detectPriceInflation(rows: AntiCorruptionRow[]): AntiCorruptionFlag[] {
  const flags: AntiCorruptionFlag[] = [];
  for (const r of rows) {
    if (r.planTotal <= 0) continue;
    const pct = r.economy / r.planTotal;
    if (pct > LAW_44FZ.antiDumpingThreshold) {
      flags.push({
        indicator: 'price_inflation',
        severity: 'low',
        rowIndex: r.rowIndex,
        message: `Экономия (лимит−факт) ${(pct * 100).toFixed(0)}% > 25% (строка ${r.rowIndex}) — возможно завышение начальной цены, требует проверки (⚠ прокси от лимита, не НМЦК)`,
      });
    }
  }
  return flags;
}

/**
 * #8 ЕП сверх предельного размера одного контракта (600К) — антикор-рамка.
 * r.planTotal уже в тыс. руб. — деление на 1000 в сообщении убрано (bug-hunt
 * 2026-08-08, БАГ #1): второе деление превращало «601 тыс.» в «1 тыс.».
 */
export function detectEpOverLimit(rows: AntiCorruptionRow[]): AntiCorruptionFlag[] {
  const flags: AntiCorruptionFlag[] = [];
  for (const r of rows) {
    if (r.method !== 'ЕП') continue;
    if (r.planTotal > LAW_44FZ.epSingleContractLimit) {
      flags.push({
        indicator: 'ep_over_limit',
        severity: 'high',
        rowIndex: r.rowIndex,
        message: `ЕП ${r.planTotal.toFixed(0)} тыс ₽ > предельных 600 тыс (строка ${r.rowIndex}) — требует проверки основания`,
      });
    }
  }
  return flags;
}

/** #9 Годовая доля ЕП выше порога роли. */
export function detectAnnualEpShare(epTotal: number, totalPlan: number, limit: number): AntiCorruptionFlag[] {
  if (totalPlan <= 0) return [];
  const share = epTotal / totalPlan;
  if (share > limit) {
    return [{
      indicator: 'ep_annual_share',
      severity: 'medium',
      message: `Годовая доля ЕП ${(share * 100).toFixed(0)}% > порога ${(limit * 100).toFixed(0)}% — концентрация на неконкурентных закупках, требует проверки`,
    }];
  }
  return [];
}

/**
 * #10 Концентрация у одного поставщика (>50%). 🔌 PLUGGABLE-заглушка.
 * Включится, когда в AntiCorruptionRow появится supplierInn. Сейчас (ИНН нет) → [].
 */
export function detectSupplierConcentration(rows: AntiCorruptionRow[]): AntiCorruptionFlag[] {
  const withInn = rows.filter(r => r.supplierInn && r.factTotal > 0);
  if (withInn.length === 0) return []; // ИНН нет в данных — индикатор спит
  const byInn = new Map<string, number>();
  let total = 0;
  for (const r of withInn) {
    byInn.set(r.supplierInn!, (byInn.get(r.supplierInn!) ?? 0) + r.factTotal);
    total += r.factTotal;
  }
  if (total <= 0) return [];
  const flags: AntiCorruptionFlag[] = [];
  for (const [inn, sum] of byInn) {
    const share = sum / total;
    if (share > 0.5) {
      flags.push({
        indicator: 'supplier_concentration',
        severity: 'high',
        message: `Концентрация ${(share * 100).toFixed(0)}% объёма у поставщика ИНН ${inn} — требует проверки`,
      });
    }
  }
  return flags;
}

/**
 * Оркестратор: все индикаторы по одному ГРБС → флаги + штраф дисциплины.
 */
export function detectAntiCorruption(grbsId: string, input: AntiCorruptionInput): AntiCorruptionResult {
  const { rows, epTotal = 0, totalPlan = 0, epShareLimit = 0.5 } = input;
  const flags: AntiCorruptionFlag[] = [
    ...detectSplitting(rows),
    ...detectZeroCompetition(rows),
    ...detectPriceInflation(rows),
    ...detectEpOverLimit(rows),
    ...detectAnnualEpShare(epTotal, totalPlan, epShareLimit),
    ...detectSupplierConcentration(rows),
  ];
  const disciplinaryPenalty = flags.reduce((s, f) => s + penaltyForSeverity(f.severity), 0);
  return { grbsId, flags, disciplinaryPenalty };
}
