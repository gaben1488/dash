/**
 * 44-ФЗ Compliance Analysis Module
 * Checks procurement compliance with Federal Law 44-ФЗ requirements.
 * Based on procurement_report.gs LAW_44FZ_ and EP_SHARE_THRESHOLDS_.
 */

import type { GRBSRole } from './grbs-profile.js';

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
}

/** Legal thresholds from 44-ФЗ */
export const LAW_44FZ = {
  /** п.4 ч.1 ст.93 — single EP contract limit */
  epSingleContractLimit: 600_000,
  /** п.5 ч.1 ст.93 — education services EP limit */
  epEducationLimit: 5_000_000,
  /** п.5 ч.1 ст.93 — education EP annual share limit */
  epEducationShareLimit: 0.50,
  /** Electronic shop (магазин) purchase limit */
  eShopLimit: 5_000_000,
  /** Request for quotations (запрос котировок) limit */
  quotationLimit: 10_000_000,
  /** Annual EP limit for п.4 — 2M or 10% of total */
  epAnnualSmallPurchaseLimit: 2_000_000,
  /** Anti-dumping threshold (ст. 37) */
  antiDumpingThreshold: 0.25,
  /** Annual EP share limit (% of total) */
  epAnnualShareLimit: 0.10,
  /** Annual EP absolute limit */
  epAnnualAbsoluteLimit: 100_000_000,
} as const;

/** EP share thresholds by ГРБС role */
export const EP_SHARE_BY_ROLE: Record<GRBSRole, number> = {
  'ОПЕРАЦИОННЫЙ': 0.50,
  'ИНВЕСТИЦИОННЫЙ': 0.30,
  'СМЕШАННЫЙ': 0.40,
};

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
 * Check EP single contract limit (п.4 ч.1 ст.93 44-ФЗ).
 * EP contracts cannot exceed 600K rubles.
 */
export function checkEPContractLimits(rows: RowData[], grbsId: string): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const row of rows) {
    if (row.method !== 'ЕП') continue;
    if (row.planTotal > LAW_44FZ.epSingleContractLimit) {
      issues.push({
        grbsId,
        ruleCode: 'ep_contract_limit',
        severity: 'critical',
        title: `ЕП превышает лимит 600 тыс. ₽ (строка ${row.rowIndex})`,
        description: `Сумма контракта ${(row.planTotal / 1000).toFixed(1)} тыс. ₽ превышает предельный размер для ЕП по п.4 ч.1 ст.93`,
        article: 'ст. 93 ч.1 п.4',
        threshold: LAW_44FZ.epSingleContractLimit,
        actualValue: row.planTotal,
        rowIndex: row.rowIndex,
      });
    }
  }
  return issues;
}

/**
 * Check anti-dumping (ст. 37 44-ФЗ).
 * Economy > 25% triggers mandatory compliance check.
 */
export function checkAntiDumping(rows: RowData[], grbsId: string): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const row of rows) {
    if (row.method === 'ЕП') continue; // anti-dumping only for competitive
    if (row.planTotal <= 0) continue;
    const economyPct = row.economy / row.planTotal;
    if (economyPct > LAW_44FZ.antiDumpingThreshold) {
      issues.push({
        grbsId,
        ruleCode: 'anti_dumping',
        severity: 'warning',
        title: `Высокая экономия: лимит−факт ${(economyPct * 100).toFixed(1)}% (строка ${row.rowIndex})`,
        description: `Экономия (лимит−факт) превышает 25%. Внимание: антидемпинг по ст.37 44-ФЗ требует НМЦК, которой нет в данных`,
        article: 'ст. 37',
        threshold: LAW_44FZ.antiDumpingThreshold,
        actualValue: economyPct,
        rowIndex: row.rowIndex,
      });
    }
  }
  return issues;
}

/**
 * Check EP share limits by ГРБС role.
 */
export function checkEPShareLimits(
  epCount: number,
  totalCount: number,
  epTotal: number,
  yearPlanTotal: number,
  role: GRBSRole,
  grbsId: string,
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const roleLimit = EP_SHARE_BY_ROLE[role];

  if (totalCount > 0) {
    const epShareByCount = epCount / totalCount;
    if (epShareByCount > roleLimit) {
      issues.push({
        grbsId,
        ruleCode: 'ep_share_role',
        severity: 'warning',
        title: `Доля ЕП ${(epShareByCount * 100).toFixed(1)}% превышает норму для роли "${role}"`,
        description: `Допустимая доля ЕП для роли ${role}: ${(roleLimit * 100).toFixed(0)}%. Фактическая: ${(epShareByCount * 100).toFixed(1)}%`,
        article: 'ст. 93',
        threshold: roleLimit,
        actualValue: epShareByCount,
      });
    }
  }

  // Annual absolute limit check
  if (epTotal > LAW_44FZ.epAnnualAbsoluteLimit) {
    issues.push({
      grbsId,
      ruleCode: 'ep_annual_absolute',
      severity: 'critical',
      title: `Годовой объём ЕП превышает 100 млн ₽`,
      description: `Объём ЕП: ${(epTotal / 1_000_000).toFixed(1)} млн ₽. Предельный годовой объём: 100 млн ₽`,
      article: 'ст. 93',
      threshold: LAW_44FZ.epAnnualAbsoluteLimit,
      actualValue: epTotal,
    });
  }

  return issues;
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
    if (row.method !== 'ЕП') continue;
    breakdown.total++;
    const reason = classifyEPReason(row.subject);
    breakdown.byReason[reason].count++;
    breakdown.byReason[reason].totalAmount += row.planTotal;
  }

  return breakdown;
}
