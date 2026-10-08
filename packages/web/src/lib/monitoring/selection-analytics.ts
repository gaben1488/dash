/** Analytics uses the selected registry snapshot, without a second source read. */
import { monitoringAnalytics, monitoringDate, parseWinnerCell, type MonitoringProcedure, type ProcedureStage, type MonitoringDefectKind } from '@aemr/core';
import type { RegistryProcedure } from './contract';
import { normalizeAnalytics, type AnalyticsPayload, type SeasonBasis } from './analytics-contract';

function stage(value: string): ProcedureStage {
  switch (value) {
    case 'application': case 'published': case 'bidding': case 'awarded': case 'no_result': case 'reissued': return value;
    default: return 'unknown';
  }
}
function defectKind(value: string): value is MonitoringDefectKind {
  return ['text-number', 'blank-space', 'broken-date', 'broken-code', 'manual-savings', 'control-error', 'false-calm', 'missing-stage', 'negative-duration', 'source-error', 'source-warning', 'source-incomplete'].includes(value);
}
export function analyticsProcedure(p: RegistryProcedure): MonitoringProcedure {
  const method = p.method === 'ЭА' || p.method === 'ЭАС' || p.method === 'ЭЗК' || p.method === 'ЭЕП' ? p.method : null;
  return {
    ...p, method, stage: stage(p.stage), ordinal: p.ppNum === null ? null : Number(p.ppNum),
    applicationDate: monitoringDate(p.applicationDate), publicationDate: monitoringDate(p.publicationDate),
    deadlineDate: monitoringDate(p.deadlineDate), auctionDate: monitoringDate(p.auctionDate),
    winner: { ...parseWinnerCell(p.winner ?? [p.winnerName, p.winnerInn].filter(Boolean).join('\n')), name: p.winnerName, inn: p.winnerInn, innRepeated: p.innRepeated },
    defects: p.defects.flatMap(d => defectKind(d.kind) ? [{ ...d, kind: d.kind }] : []),
  };
}
export function selectedAnalytics(procedures: readonly RegistryProcedure[], readAt: string, basis: SeasonBasis): AnalyticsPayload {
  return normalizeAnalytics({
    source: { bookName: 'План-реестр процедур определения поставщика', readAt, moneyUnit: 'руб', sheetsRead: [...new Set(procedures.map(p => p.sheet))], sheetsFailed: {} },
    analytics: monitoringAnalytics(procedures.map(analyticsProcedure), { seasonBasis: basis }), notes: [],
  });
}
