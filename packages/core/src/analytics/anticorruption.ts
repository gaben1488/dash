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
import { normalizeMethod, assessThreshold, EP_ROLE_THRESHOLD_IDS, type DatedThreshold, type ThresholdAssessment } from '@aemr/shared';

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
  thresholdEvidence?: ThresholdAssessment;
}

export interface AntiCorruptionInput {
  rows: AntiCorruptionRow[];
  /** Same-count denominator for role-based screening; NOT money. */
  epCount?: number;
  totalCount?: number;
  /** @deprecated Ambiguous money-valued legacy inputs must not be compared to a count threshold. */
  epTotal?: number;
  /** @deprecated As above; financial/legal annual checks need contract + customer scope. */
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
  const epRows = rows.filter(r => normalizeMethod(r.method) === 'ЕП'
    && Number.isFinite(r.planTotal) && r.planTotal > 0);
  if (!epRows.length) return [];
  // Compare only plan positions against a frozen reference. Their count is
  // NOT evidence of multiple contracts or circumvention of article 93.
  const reference = assessThreshold({
    id: 'law.epSmallSingleContract', captured, value: epRows[0].planTotal,
    unit: 'thousandRub', basis: 'plan_position_total', purpose: 'screening',
  });
  if (reference.status !== 'reference') return [];
  const limit = reference.evidence!.value;
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
        message: `Группа из ${group.length} плановых позиций ЕП по предмету «${subj}» на сумму ${(total / 1_000).toFixed(1)} млн ₽ (внутренний индекс ${score}/100). Договоры, даты и основания не установлены: дробление и нарушение не доказаны.`,
        thresholdEvidence: reference,
      });
    }
  }
  return flags;
}

/** #8 Retained legacy indicator ID; a PLAN POSITION is never an individual contract. */
export function detectEpOverLimit(rows: AntiCorruptionRow[], captured?: DatedThreshold): AntiCorruptionFlag[] {
  const flags: AntiCorruptionFlag[] = [];
  for (const r of rows) {
    if (normalizeMethod(r.method) !== 'ЕП') continue;
    const assessment = assessThreshold({
      id: 'law.epSmallSingleContract', captured, value: r.planTotal,
      unit: 'thousandRub', basis: 'plan_position_total', purpose: 'screening',
    });
    if (assessment.status !== 'reference' || !assessment.exceeded) continue;
    const limit = assessment.evidence!.value;
    flags.push({
      indicator: 'ep_over_limit', severity: 'low',
      rowIndex: r.rowIndex,
      message: `Плановая сумма позиции ЕП ${r.planTotal.toFixed(1)} тыс. ₽ выше справочного разового ориентира ${limit.toFixed(0)} тыс. ₽ (строка ${r.rowIndex}). Цены и основания отдельных договоров не установлены; превышение нормы не доказано.` +
        (captured?.status === 'verified' ? ' Редакция числового порога подтверждена, применимость основания — нет.' : ' Редакция числового порога для даты среза не подтверждена.'),
      thresholdEvidence: assessment,
    });
  }
  return flags;
}

/** #9 Share of EP PLAN POSITIONS by count. Not annual legal SGOZ/money. */
export function detectAnnualEpShare(epCount: number, totalCount: number, limit: number): AntiCorruptionFlag[] {
  if (!Number.isFinite(epCount) || !Number.isFinite(totalCount)
    || totalCount <= 0 || epCount < 0 || epCount > totalCount) return [];
  const share = epCount / totalCount;
  if (share > limit) {
    return [{
      indicator: 'ep_annual_share',
      severity: 'low',
      message: `Доля плановых позиций ЕП по количеству ${(share * 100).toFixed(0)}% выше неподтверждённого внутреннего ориентира ${(limit * 100).toFixed(0)}%; это информационный сигнал, не годовой денежный предел или нарушение.`,
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
  const { rows, epCount, totalCount, epShareThreshold, epSingleThreshold } = input;
  const share = epCount !== undefined && totalCount !== undefined && totalCount > 0
    && Number.isFinite(epCount) && Number.isFinite(totalCount)
    && epCount >= 0 && epCount <= totalCount ? epCount / totalCount : null;
  const role = epShareThreshold?.id;
  const shareAssessment = role && Object.values(EP_ROLE_THRESHOLD_IDS).includes(role)
    ? assessThreshold({
      id: role, captured: epShareThreshold, value: share,
      unit: 'ratio', basis: 'department_ep_count_share', purpose: 'screening',
    })
    : null;
  const flags: AntiCorruptionFlag[] = [
    ...detectSplitting(rows, epSingleThreshold),
    ...detectEpOverLimit(rows, epSingleThreshold),
    ...(shareAssessment?.status === 'reference' && share !== null
      ? detectAnnualEpShare(epCount!, totalCount!, shareAssessment.evidence!.value)
        .map(flag => ({ ...flag, thresholdEvidence: shareAssessment }))
      : []),
    ...detectSupplierConcentration(rows),
  ];
  // Screenings do not prove breaches and never result in disciplinary scores.
  const disciplinaryPenalty = 0;
  const reference = assessThreshold({
    id: 'law.epSmallSingleContract', captured: epSingleThreshold,
    value: rows.find(row => normalizeMethod(row.method) === 'ЕП')?.planTotal,
    unit: 'thousandRub', basis: 'plan_position_total', purpose: 'screening',
  });
  return { grbsId, flags, disciplinaryPenalty, unavailableIndicators: [
    ...(reference.status === 'unavailable'
      ? [{ indicator: 'ep_over_limit' as const, reason: `Справочная проверка ЕП недоступна (${reference.reason}); текущий порог не подставлен.` }] : []),
    ...(shareAssessment?.status === 'reference'
      ? [] : [{ indicator: 'ep_annual_share' as const, reason: `Сопоставимая доля ЕП по количеству недоступна (${shareAssessment?.reason ?? 'missing_count_basis'}); денежные объёмы не подменяют количество.` }]),
    { indicator: 'zero_competition', reason: 'Нет данных об участниках и ходе торгов; официальная экономия не измеряет конкуренцию.' },
    { indicator: 'price_inflation', reason: 'Нет сопоставимой НМЦК и ценового обоснования; экономия по AD не доказывает завышение цены.' },
  ] };
}
