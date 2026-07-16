/* Проба: режут ли включённые в Google-листах фильтры выдачу values API (полнота тракта). */
import { writeFileSync } from 'node:fs';
import { google } from '../packages/server/node_modules/googleapis/build/src/index.js';
import { readDeptSheet } from '../packages/server/src/services/google-sheets.js';
import { DEPARTMENT_SPREADSHEETS, config } from '../packages/server/src/config.js';

async function main(): Promise<void> {
  const auth = new google.auth.JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const api = google.sheets({ version: 'v4', auth });
  const out: string[] = ['# Полнота тракта: фильтры листов vs values API', ''];

  for (const [dept, ssId] of Object.entries(DEPARTMENT_SPREADSHEETS)) {
    try {
      const meta = await api.spreadsheets.get({
        spreadsheetId: ssId,
        fields: 'sheets(properties(title,gridProperties(rowCount)),basicFilter)',
      });
      const sheet = await readDeptSheet(dept, ssId);
      const gridSheet = (meta.data.sheets ?? []).find(s => s.properties?.title === sheet.sheetName);
      const gridRows = gridSheet?.properties?.gridProperties?.rowCount ?? 0;
      const hasFilter = !!gridSheet?.basicFilter;
      const filterRange = gridSheet?.basicFilter?.range
        ? `строки ${gridSheet.basicFilter.range.startRowIndex ?? 0}-${gridSheet.basicFilter.range.endRowIndex ?? '∞'}`
        : '';
      const nonEmpty = sheet.values.filter(r => r && r.some(c => String(c ?? '').trim() !== '')).length;
      out.push(
        `${dept} (лист «${sheet.sheetName}»): ФИЛЬТР=${hasFilter ? `ВКЛЮЧЁН (${filterRange})` : 'нет'} | ` +
        `grid=${gridRows} строк | values API вернул=${sheet.values.length} | непустых=${nonEmpty}`,
      );
    } catch (e) {
      out.push(`${dept}: FAIL ${(e as Error).message.slice(0, 80)}`);
    }
  }
  out.push('', 'Вывод: если values≈grid (и >> непустых видимых) даже при ВКЛЮЧЁННОМ фильтре — фильтры листа НЕ режут API-выдачу.');
  writeFileSync('C:/Users/filat/AppData/Local/Temp/aemr-reports/filters_completeness.txt', out.join('\n'), 'utf-8');
  console.log('done');
}
main();
