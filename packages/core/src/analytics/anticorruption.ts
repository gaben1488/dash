/**
 * Anticorruption module — Layer C of the decision-engine port (aemr-bot passport 09).
 *
 * Каждый индикатор = «ТРЕБУЕТ ПРОВЕРКИ», НЕ обвинение (статистика ≠ детерминизм, ложные
 * срабатывания допустимы). Партиальный набор (на ТЕКУЩИХ данных, без cross-snapshot и ИНН):
 *   ✅ #1 splitting (дробление-индекс 0-100) — флагман, нового в dash не было
 *   Недоступен #2 zero_competition: нужны данные о торгах
 *   Недоступен #4 price_inflation: нужны НМЦК и ценовое обоснование
 *   ✅ #8 ep_over_limit (ЕП > 600К) — переиспользует порог 44-ФЗ в антикор-рамке
 *   ✅ #9 ep_annual_share (годовая доля ЕП > порога)
 *   🔌 #10 supplier_concentration — pluggable-заглушка (нужен ИНН поставщика, его пока нет в данных)
 *   ⏳ #3 reclassification / #6 mass_injection / #7 stagnation — нужна история снимков (cross-snapshot), позже
 *   ⏳ #5 collusion — нужно число участников, его нет в данных
 *
 * Флаги требуют проверки и не дают штрафа к дисциплине без подтверждённого нарушения.
 */

import { classifyEPReason } from './compliance-44fz.js';
import { normalizeMethod, capturedThresholdValue, type DatedThreshold } from '@aemr/shared';

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
  /** Frozen internal threshold by role, without a fallback to today's parameters. */
  epShareThreshold?: DatedThreshold;
  /** Frozen source-law reference for the same capture; no implicit current-day lookup. */
  epSingleThreshold?: DatedThreshold;
}

export interface AntiCorruptionResult {
  grbsId: string;
  flags: AntiCorruptionFlag[];
  /** Совместимое поле старого API: 0, поскольку скрининг не доказывает нарушение. */
  disciplinaryPenalty: number;
  unavailableIndicators: { indicator: AntiCorruptionIndicator; reason: string }[];
}


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
export function detectSplitting(rows: AntiCorruptionRow[], captured?: DatedThreshold): AntiCorruptionFlag[] {
  const limit = capturedThresholdValue(captured, 'thousandRub');
  if (limit === null) return [];
  const epRows = rows.filter(r => normalizeMethod(r.method) === 'ЕП' && r.planTotal > 0);
  const groups = new Map<string, AntiCorruptionRow[]>();
  for (const r of epRows) {
    const key = normalizeSubject(r.subject);
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const bandLow = limit * 0.8; // Captured reference in thousandRub, not a current-day constant.
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

/** #8 Retained legacy indicator ID; a PLAN POSITION is never an individual contract. */
export function detectEpOverLimit(rows: AntiCorruptionRow[], captured?: DatedThreshold): AntiCorruptionFlag[] {
  const limit = capturedThresholdValue(captured, 'thousandRub');
  if (limit === null) return [];
  const flags: AntiCorruptionFlag[] = [];
  for (const r of rows) {
    if (normalizeMethod(r.method) !== 'ЕП' || !Number.isFinite(r.planTotal)) continue;
    if (r.planTotal > limit) {
      flags.push({
        indicator: 'ep_over_limit',
        severity: 'low',
        rowIndex: r.rowIndex,
        message: `Плановая сумма позиции ЕП ${r.planTotal.toFixed(1)} тыс. ₽ выше справочного разового ориентира ${limit.toFixed(0)} тыс. ₽ (строка ${r.rowIndex}). Цены и основания отдельных договоров не установлены; превышение нормы не доказано.` +
          (captured?.status === 'verified' ? ' Редакция числового порога подтверждена, применимость основания — нет.' : ' Редакция числового порога для даты среза не подтверждена.'),
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
      severity: 'low',
      message: `Годовая доля ЕП ${(share * 100).toFixed(0)}% выше неподтверждённого внутреннего ориентира ${(limit * 100).toFixed(0)}%; это информационный сигнал, а не правовой предел или нарушение.`,
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
  const { rows, epTotal = 0, totalPlan = 0, epShareThreshold, epSingleThreshold } = input;
  const shareLimit = capturedThresholdValue(epShareThreshold, 'ratio');
  const flags: AntiCorruptionFlag[] = [
    ...detectSplitting(rows, epSingleThreshold),
    ...detectEpOverLimit(rows, epSingleThreshold),
    ...(shareLimit === null ? [] : detectAnnualEpShare(epTotal, totalPlan, shareLimit)),
    ...detectSupplierConcentration(rows),
  ];
  // Screening flags are questions for review, not evidence of a disciplinary violation.
  const disciplinaryPenalty = 0;
  return { grbsId, flags, disciplinaryPenalty, unavailableIndicators: [
    ...(capturedThresholdValue(epSingleThreshold, 'thousandRub') === null
      ? [{ indicator: 'ep_over_limit' as const, reason: 'В снимке отсутствует юридический ориентир с подтверждённой единицей; текущее значение не подставлено.' }] : []),
    ...(shareLimit === null
      ? [{ indicator: 'ep_annual_share' as const, reason: 'В снимке нет сохранённого внутреннего ориентира доли ЕП для роли ГРБС.' }] : []),
    { indicator: 'zero_competition', reason: 'Нет данных об участниках и ходе торгов; официальная экономия не измеряет конкуренцию.' },
    { indicator: 'price_inflation', reason: 'Нет сопоставимой НМЦК и ценового обоснования; экономия по AD не доказывает завышение цены.' },
  ] };
}
