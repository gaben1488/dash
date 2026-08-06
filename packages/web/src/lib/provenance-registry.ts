// ── Живой провенанс официальных метрик для попапов БЗ (Д11 реестра дефектов).
//    Сервер отдаёт по каждой официальной метрике лист, ячейку, формулу и время
//    чтения (officialMetrics снимка) — этот модуль делает их доступными
//    попапам по ключу БЗ и выбранному периоду. Закон 1 продукта: каждое число
//    доводится до источника «книга → лист → строка → ячейка».
//
//    Честность: карта ниже покрывает только те ключи, чьё соответствие
//    официальным строкам СВОДа известно достоверно. Нет соответствия — блок
//    просто не показывается; выдуманного провенанса не бывает.

import { buildSheetUrl } from './recon/sheet-links';

/** Официальная метрика снимка (форма ответа сервера, поля по факту). */
interface OfficialMetricLike {
  sourceSheet?: string;
  sourceCell?: string;
  formula?: string;
  readAt?: string;
  displayValue?: string;
  numericValue?: number;
}

export interface ProvenanceSource {
  /** Человеческая подпись строки источника («КП, план позиций») */
  label: string;
  sheet: string;
  cell: string;
  formula?: string;
  readAt?: string;
  display?: string;
  /** Ссылка в книгу, если известен spreadsheetId снимка */
  url?: string;
}

let metrics: Record<string, OfficialMetricLike> = {};
let spreadsheetId: string | undefined;

/** Вызывается при получении dashboardData (store.fetchDashboard / refresh). */
export function setOfficialProvenance(
  official: Record<string, OfficialMetricLike> | undefined,
  sheetId?: string,
): void {
  metrics = official ?? {};
  spreadsheetId = sheetId;
}

type KeyBuilder = (period: string) => string;

/** Соответствие «ключ БЗ → официальные строки СВОДа» (только достоверные). */
const MAP: Record<string, Array<{ k: KeyBuilder; label: string }>> = {
  plan_count: [
    { k: (p) => `competitive.${p}.count`, label: 'КП, план позиций' },
    { k: (p) => `sole.${p}.count`, label: 'ЕП, план позиций' },
  ],
  fact_count: [
    { k: (p) => `competitive.${p}.fact_count`, label: 'КП, заключено' },
    { k: (p) => `sole.${p}.fact_count`, label: 'ЕП, заключено' },
  ],
  exec_count_pct: [
    { k: (p) => `competitive.${p}.fact_count`, label: 'КП, заключено' },
    { k: (p) => `sole.${p}.fact_count`, label: 'ЕП, заключено' },
    { k: (p) => `competitive.${p}.count`, label: 'КП, план позиций' },
    { k: (p) => `sole.${p}.count`, label: 'ЕП, план позиций' },
  ],
  execution_pct: [
    { k: (p) => `competitive.${p}.total_fact`, label: 'КП, факт деньгами' },
    { k: (p) => `sole.${p}.total_fact`, label: 'ЕП, факт деньгами' },
    { k: (p) => `competitive.${p}.total_plan`, label: 'КП, план деньгами' },
    { k: (p) => `sole.${p}.total_plan`, label: 'ЕП, план деньгами' },
  ],
  plan_total: [
    { k: (p) => `competitive.${p}.total_plan`, label: 'КП, план деньгами' },
    { k: (p) => `sole.${p}.total_plan`, label: 'ЕП, план деньгами' },
  ],
  fact_total: [
    { k: (p) => `competitive.${p}.total_fact`, label: 'КП, факт деньгами' },
    { k: (p) => `sole.${p}.total_fact`, label: 'ЕП, факт деньгами' },
  ],
  competitive_count: [{ k: (p) => `competitive.${p}.count`, label: 'КП, план позиций' }],
  comp_fact_count: [{ k: (p) => `competitive.${p}.fact_count`, label: 'КП, заключено' }],
  ep_count: [{ k: (p) => `sole.${p}.count`, label: 'ЕП, план позиций' }],
  ep_fact_count: [{ k: (p) => `sole.${p}.fact_count`, label: 'ЕП, заключено' }],
  comp_exec_count_pct: [{ k: (p) => `competitive.${p}.percent`, label: 'КП, исполнение' }],
  ep_exec_count_pct: [{ k: (p) => `sole.${p}.percent`, label: 'ЕП, исполнение' }],
};

/** Периоды-запасные: официальный ярус ведётся по кварталам и году. */
function candidatePeriods(period: string): string[] {
  const base = ['q1', 'q2', 'q3', 'q4', 'year'].includes(period) ? [period] : [];
  return [...base, 'year'];
}

/**
 * Официальные источники для ключа БЗ за период. Пустой массив — соответствие
 * неизвестно или снимок не содержит этих строк; блок в попапе не рисуется.
 */
export function officialProvenanceFor(kbKey: string, period: string): ProvenanceSource[] {
  const entries = MAP[kbKey];
  if (!entries) return [];
  const out: ProvenanceSource[] = [];
  for (const { k, label } of entries) {
    let m: OfficialMetricLike | undefined;
    for (const p of candidatePeriods(period)) {
      m = metrics[k(p)];
      if (m) break;
    }
    if (!m?.sourceSheet || !m.sourceCell) continue;
    out.push({
      label,
      sheet: m.sourceSheet,
      cell: m.sourceCell,
      formula: m.formula,
      readAt: m.readAt,
      display: m.displayValue ?? (m.numericValue != null ? String(m.numericValue) : undefined),
      url: spreadsheetId ? buildSheetUrl(spreadsheetId, m.sourceCell) : undefined,
    });
  }
  return out;
}
