// ── Deep-link ссылки в Google Sheets для страницы «Сверка».
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

import { DEPARTMENT_IDS, DEPARTMENT_ROWS, LATIN_TO_CYRILLIC } from '@aemr/shared';

/**
 * СВОД ТД-ПМ cell references per department (КП «Итого год» row).
 * DERIVED from the canonical DEPARTMENT_ROWS so the "open in Google Sheets" deep-links
 * can never silently drift from @aemr/shared (was a hardcoded map pointing at wrong cells,
 * e.g. economy U46 vs canonical U47). Reconciliation shows year-level KP+ЕП money values,
 * so plan/fact link to the money columns K/O of the year row.
 */
export const DEPT_SVOD_CELLS: Record<string, { planCount: string; factCount: string; planTotal: string; factTotal: string; economy: string; percent: string }> =
  Object.fromEntries(
    DEPARTMENT_IDS.map((id) => {
      const cfg = DEPARTMENT_ROWS[id];
      return [LATIN_TO_CYRILLIC[id], {
        planCount: `D${cfg.kpYear}`,
        factCount: `E${cfg.kpYear}`,
        planTotal: `K${cfg.kpYear}`,
        factTotal: `O${cfg.kpYear}`,
        economy: cfg.economyKpCell ?? `U${cfg.kpYear}`,
        percent: `G${cfg.kpYear}`,
      }];
    }),
  );

/** URL книги Google Sheets, опционально с якорем на ячейку */
export function buildSheetUrl(spreadsheetId: string, cell?: string): string {
  let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  if (cell) url += `#gid=0&range=${cell}`;
  return url;
}
