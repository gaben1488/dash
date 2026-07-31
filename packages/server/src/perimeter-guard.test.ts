/**
 * Страж периметра книги ГРБС.
 *
 * Цена дефекта, пойманного 29.07.2026: чтение вкладок книги управления мимо
 * агрегатной «ВСЕ» дало 6106 строк вместо 2729 — популяция удвоилась, потому
 * что подведы посчитались и в собственной вкладке, и в агрегате. Наружу это
 * вышло не ошибкой, а правдоподобным числом, и в том вся беда.
 *
 * Правило: имя вкладки ГРБС резолвит только канон — readDeptSheet (кандидаты
 * «ВСЕ» → «Все» → имя управления) и построенный на нём rows-read. Прямой
 * getSheetData* с произвольным именем листа обходит канон и потому обязан
 * быть либо на константе СВОД/ШДЮ (это другие книги, там периметра нет),
 * либо в файле из списка ниже — с названной причиной.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { departmentSheetNameCandidates } from './services/sheet-name-candidates.js';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Продуктовые .ts пакета: тесты мокают чтение, смотреть на них нечего. */
function sources(dir: string = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Аргументы-имена листов, у которых периметра ГРБС нет: это книги СВОД и ШДЮ. */
const NON_DEPT_SHEETS = new Set(['SVOD_SHEET_NAME', 'SHDYU_MONTHLY_SHEET_NAME', 'SHDYU_SHEET_NAME']);

/** Кому прямое чтение разрешено — с причиной. Список растёт только осознанно. */
const ALLOWED: Record<string, string> = {
  'services/google-sheets.ts': 'дом резолвера: readDeptSheet сам перебирает кандидаты «ВСЕ»/«Все»/имя',
  'services/rows-read.ts': 'ступень 2 каскада — DEPRECATED-зеркало листа управления внутри книги СВОД',
  'services/snapshot.ts': 'вкладки книги СВОД по ALL_SHEETS; книги ГРБС грузит fetchDepartmentSpreadsheets',
  'routes/changes.ts': 'журнал правок _ChangeLog — служебная вкладка, не строки управления; периметр строк не задет',
};

const CALL = /\bgetSheetData(FromSpreadsheet|WithFormulas)?\s*\(([^)]*)\)/g;

describe('периметр книги ГРБС', () => {
  it('чтение вкладки управления идёт только через канонический резолвер', () => {
    const strays: string[] = [];
    for (const file of sources()) {
      const rel = relative(SRC, file).split(sep).join('/');
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Объявления и комментарии — не вызовы.
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || /\bfunction\s+getSheetData/.test(line)) continue;
        CALL.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CALL.exec(line))) {
          // У getSheetData имя листа первым, у ...FromSpreadsheet/...WithFormulas — вторым.
          const sheetArg = m[2].split(',')[m[1] ? 1 : 0]?.trim() ?? '';
          if (NON_DEPT_SHEETS.has(sheetArg) || ALLOWED[rel]) continue;
          strays.push(`${rel}:${i + 1} — getSheetData(${sheetArg})`);
        }
      }
    }
    // Пусто — значит другого пути к вкладке ГРБС, кроме канона, в коде нет.
    expect(strays).toEqual([]);
  });

  it('канон реально подключён там, где читается книга управления', () => {
    // Обратная сторона запрета: мало запретить обход, надо чтобы канон стоял
    // на обоих путях — и в чтении строк, и в валидации источника. Раньше
    // валидация читала лист по имени управления и падала там, где загрузка шла.
    for (const rel of ['services/rows-read.ts', 'services/source-validation.ts']) {
      expect(readFileSync(join(SRC, rel), 'utf8'), rel).toContain('readDeptSheet');
    }
  });

  it('агрегат «ВСЕ» пробуется раньше собственной вкладки управления', () => {
    // Порядок кандидатов и есть периметр: сперва агрегат книги, и только если
    // его нет — вкладка с именем ГРБС. Перестановка вернёт двойной счёт подведов.
    expect(departmentSheetNameCandidates('ВСЕ', 'УО')).toEqual(['ВСЕ', 'Все', 'УО']);
    expect(departmentSheetNameCandidates('УИО', 'УИО')).toEqual(['УИО']);
  });
});
