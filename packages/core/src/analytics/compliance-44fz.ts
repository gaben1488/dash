/**
 * 44-ФЗ Compliance Analysis Module
 * Checks procurement compliance with Federal Law 44-ФЗ requirements.
 * Based on procurement_report.gs LAW_44FZ_ and EP_SHARE_THRESHOLDS_.
 */

import type { DatedThreshold, ThresholdAssessment } from '@aemr/shared';
import type { GRBSRole } from './grbs-profile.js';
import { INTERNAL_EP_SHARE_BY_ROLE, LAW_44FZ_THRESHOLDS, normalizeMethod, assessThreshold, EP_ROLE_THRESHOLD_IDS } from '@aemr/shared';

export interface ComplianceIssue {
  grbsId: string;
  ruleCode: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  article: string;  // e.g., "ст. 93 ч.1 п.4"
  threshold: number;
  actualValue: number;
  rowIndex?: number;
  /** An informational reference is never a finding of a legal breach. */
  thresholdEvidence?: ThresholdAssessment;
}

/**
 * Legal thresholds from 44-ФЗ.
 * Единицы: тыс. руб. — как денежные колонки книг ГРБС (H/I/J/K, V/W/X/Y).
 * До fix bug-hunt 2026-08-08 (БАГ #1) пороги были в рублях, а сравнивались
 * с planTotal в тысячах — сравнение требовало контракта на 600 млн, чтобы
 * сработать. Источник — @aemr/shared LAW_44FZ_THRESHOLDS (суффикс ThousandRub).
 */
export const LAW_44FZ = {
  /** п.4 ч.1 ст.93 — single EP contract limit (тыс. руб.) */
  epSingleContractLimit: LAW_44FZ_THRESHOLDS.epSmallPurchaseSingleContractLimitThousandRub,
  /** п.5 ч.1 ст.93 — education/culture EP single contract limit (600 тыс.) */
  epEducationLimit: LAW_44FZ_THRESHOLDS.epEducationSingleContractLimitThousandRub,
  /** п.5 ч.1 ст.93 — education EP annual: 5 млн ИЛИ 50% СГОЗ, потолок 30 млн (тыс. руб.) */
  epEducationAnnualFixedLimit: LAW_44FZ_THRESHOLDS.epEducationAnnualFixedLimitThousandRub,
  epEducationShareLimit: LAW_44FZ_THRESHOLDS.epEducationAnnualShareLimit,
  epEducationAnnualAbsoluteLimit: LAW_44FZ_THRESHOLDS.epEducationAnnualAbsoluteLimitThousandRub,
  /** Electronic shop (магазин) purchase limit (тыс. руб.) */
  eShopLimit: LAW_44FZ_THRESHOLDS.eShopPurchaseLimitThousandRub,
  /** Request for quotations (запрос котировок) limit (тыс. руб.) */
  quotationLimit: LAW_44FZ_THRESHOLDS.quotationPurchaseLimitThousandRub,
  /** Annual EP limit for п.4 — 2M or 10% of total, capped at 50M (тыс. руб.) */
  epAnnualSmallPurchaseLimit: LAW_44FZ_THRESHOLDS.epSmallPurchaseAnnualFixedLimitThousandRub,
  /** Anti-dumping threshold (ст. 37) */
  antiDumpingThreshold: LAW_44FZ_THRESHOLDS.antiDumpingSavingsShare,
  /** Annual EP share limit (% of total) */
  epAnnualShareLimit: LAW_44FZ_THRESHOLDS.epSmallPurchaseAnnualShareLimit,
  /** Annual EP absolute limit (тыс. руб.) */
  epAnnualAbsoluteLimit: LAW_44FZ_THRESHOLDS.epSmallPurchaseAnnualAbsoluteLimitThousandRub,
} as const;

/**
 * Доли ЕП по роли ГРБС — НЕ закон, а внутренний ориентир из легаси-генератора
 * предыдущей команды (procurement_report.gs, EP_SHARE_THRESHOLDS_); происхождение
 * значений не документировано (подтверждено пользователю 24.07.2026). В UI
 * подписывается «внутренняя норма района (настраивается)»; целевое место —
 * редактируемый справочник настроек аналитика (дизайн-док §5.1-3/4), не константа.
 */
export const EP_SHARE_BY_ROLE: Record<GRBSRole, number> = INTERNAL_EP_SHARE_BY_ROLE;

/** EP reason codes (п-codes from 44-ФЗ ст. 93) */
export type EPReasonCode =
  | 'п1_монополии'
  | 'п4_малые'
  | 'п5_образование'
  | 'п6_работы'
  | 'п8_имущество'
  | 'п9_ремонт'
  | 'п14_периодика'
  | 'п23_услуги'
  | 'п29_жкх'
  | 'иное';

export interface EPReasonBreakdown {
  total: number;
  byReason: Record<EPReasonCode, { count: number; totalAmount: number }>;
}

interface RowData {
  rowIndex: number;
  method: string;
  planTotal: number;
  factTotal: number;
  economy: number;
  subject: string;
  epReason?: string;
}

/**
 * Identify rows requiring contract detail. A row total does not establish
 * an individual contract price or the applicability of п.4 ч.1 ст.93.
 *
 * row.planTotal и LAW_44FZ.epSingleContractLimit уже в тыс. руб. (канон колонок
 * книг ГРБС) — второе деление на 1000 в сообщении убрано (bug-hunt 2026-08-08,
 * БАГ #1): оно предполагало planTotal в рублях и превращало «600 тыс.» в «0.6».
 */
export function checkEPContractLimits(rows: RowData[], grbsId: string, context?: DatedThreshold): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const row of rows) {
    if (normalizeMethod(row.method) !== 'ЕП') continue;
    // A row in a master register is a plan position, NOT a separate contract.
    // The shared evaluator permits only an informational comparison here.
    const assessment = assessThreshold({
      id: 'law.epSmallSingleContract', captured: context,
      value: row.planTotal, unit: 'thousandRub',
      basis: 'plan_position_total', purpose: 'screening',
    });
    if (assessment.status !== 'reference' || !assessment.exceeded) continue;
    const limit = assessment.evidence!.value;
    issues.push({
      grbsId,
      ruleCode: 'ep_contract_limit',
      severity: 'info',
      title: `Недостаточно данных для проверки сумм отдельных договоров (строка ${row.rowIndex})`,
      description: `Плановая сумма позиции ${row.planTotal.toFixed(1)} тыс. ₽ выше справочного ориентира ${limit.toFixed(0)} тыс. ₽. Состав договоров, их цены и применимое основание не установлены; превышение цены договора не доказано. ${context?.status === 'verified' ? 'Редакция порога подтверждена, применимость нет.' : 'Редакция правового порога не подтверждена.'}`,
      article: 'ст. 93 ч.1 п.4 (справочное сравнение, не юридическая квалификация)',
      threshold: limit,
      actualValue: row.planTotal,
      rowIndex: row.rowIndex,
      thresholdEvidence: assessment,
    });
  }
  return issues;
}

export const ANTI_DUMPING_UNAVAILABLE = {
  ruleCode: 'anti_dumping',
  status: 'insufficient_data',
  reason: 'Антидемпинговая проверка не выполнена: нет подтверждённых НМЦК, предложенной цены и условий применения. Учтённая экономия и плановая сумма их не заменяют.',
} as const;

export const EP_CONTRACT_SCOPE_UNAVAILABLE = {
  ruleCode: 'ep_single_contract',
  status: 'insufficient_data',
  reason: 'В реестрах отражены плановые позиции, а не доказанные отдельные договоры. Применимое основание, цена каждого договора и редакция нормы не подтверждены: юридическая проверка лимита не выполнена.',
} as const;

export const EP_ANNUAL_UNAVAILABLE = {
  ruleCode: 'ep_annual_absolute',
  status: 'insufficient_data',
  reason: 'Годовые ограничения ЕП не проверены: общий объём управления не разделён по заказчикам, правовым основаниям и применимым условиям. Он не доказывает превышение лимита.',
} as const;

/**
 * Compatibility boundary for callers using master-register RowData.
 * This model has no procurement-level initial/offer prices or applicability.
 * An empty issue list is not a legal PASS; API exposes ANTI_DUMPING_UNAVAILABLE.
 */
export function checkAntiDumping(_rows: RowData[], _grbsId: string): ComplianceIssue[] {
  return [];
}

/**
 * Describe deviation from an unconfirmed legacy role reference, not law.
 * epTotal/yearPlanTotal — тыс. руб. (канон колонок книг ГРБС): млн = тыс./1000,
 * поэтому в сообщении ниже epTotal делится на 1_000, а не на 1_000_000
 * (последнее предполагало бы рубли — хвост БАГ #1, bug-hunt 2026-08-08:
 * «50 001 тыс.» печаталось бы как «0.1 млн ₽»).
 */
export function checkEPShareLimits(
  epCount: number,
  totalCount: number,
  _epTotal: number,
  _yearPlanTotal: number,
  role: GRBSRole,
  grbsId: string,
  captured?: DatedThreshold,
): ComplianceIssue[] {
  // Numerator and denominator here are COUNTS, not planned money. The annual
  // financial/legal cap is a different rule and cannot be inferred from them.
  const share = Number.isFinite(epCount) && Number.isFinite(totalCount)
    && totalCount > 0 && epCount >= 0 && epCount <= totalCount
    ? epCount / totalCount : null;
  const assessment = assessThreshold({
    id: EP_ROLE_THRESHOLD_IDS[role], captured, value: share,
    unit: 'ratio', basis: 'department_ep_count_share', purpose: 'screening',
  });
  if (assessment.status !== 'reference' || !assessment.exceeded || share === null) return [];
  const limit = assessment.evidence!.value;
  return [{
    grbsId,
    ruleCode: 'ep_share_role',
    severity: 'info',
    title: `Доля ЕП по количеству ${(share * 100).toFixed(1)}% выше неподтверждённого внутреннего ориентира`,
    description: `Для роли ${role} в прежнем генераторе задан ориентир ${(limit * 100).toFixed(0)}% ПО КОЛИЧЕСТВУ позиций. Его основание не подтверждено; это не правовая норма и не доказательство нарушения. Доля по денежной сумме рассчитывается отдельно и с этим ориентиром не сравнивается.`,
    article: 'Внутренний ориентир; источник не подтверждён',
    threshold: limit,
    actualValue: share,
    thresholdEvidence: assessment,
  }];
}

/**
 * Classify EP reason from subject text using regex patterns.
 */
export function classifyEPReason(subject: string): EPReasonCode {
  const s = subject.toLowerCase();
  if (/монопол|единствен.*поставщ|естествен.*монопол/i.test(s)) return 'п1_монополии';
  if (/до\s*[36]00|малая.*закупк|п[.\s]?4/i.test(s)) return 'п4_малые';
  if (/образован|учебн|методич|школ|детск.*сад|дошкольн/i.test(s)) return 'п5_образование';
  if (/работ.*содержан|текущ.*ремонт/i.test(s)) return 'п6_работы';
  if (/имуществ|аренд|нежил/i.test(s)) return 'п8_имущество';
  if (/ремонт.*помещ|капитальн.*ремонт/i.test(s)) return 'п9_ремонт';
  if (/подписк|периодич|газет|журнал/i.test(s)) return 'п14_периодика';
  if (/услуг.*связ|интернет|телефон/i.test(s)) return 'п23_услуги';
  if (/коммунал|электроэнерг|теплоснабж|водоснабж|жкх/i.test(s)) return 'п29_жкх';
  return 'иное';
}

/**
 * Build EP reason breakdown for a department.
 */
export function analyzeEPReasons(rows: RowData[]): EPReasonBreakdown {
  const breakdown: EPReasonBreakdown = {
    total: 0,
    byReason: {} as any,
  };

  const reasons: EPReasonCode[] = [
    'п1_монополии', 'п4_малые', 'п5_образование', 'п6_работы',
    'п8_имущество', 'п9_ремонт', 'п14_периодика', 'п23_услуги', 'п29_жкх', 'иное',
  ];
  for (const r of reasons) {
    breakdown.byReason[r] = { count: 0, totalAmount: 0 };
  }

  for (const row of rows) {
    if (normalizeMethod(row.method) !== 'ЕП') continue;
    breakdown.total++;
    const reason = classifyEPReason(row.subject);
    breakdown.byReason[reason].count++;
    breakdown.byReason[reason].totalAmount += row.planTotal;
  }

  return breakdown;
}
