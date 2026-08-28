import { describe, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { detectSignals } from './pipeline/signals.js';

// Живой дамп всех книг: путь задаётся окружением (свежий дамп каждый прогон —
// мандат), жёсткий путь чужой сессии удалён. Без дампа прогон честно
// пропускается: это харнесс по живым данным, не юнит-страж.
const DUMP = process.env.AEMR_ALL_BOOKS_DUMP
  ?? 'C:/Users/filat/dash/packages/server/data/all-books-rows.json';
const BASE = DUMP.slice(0, DUMP.lastIndexOf('/') + 1);

describe.skipIf(!existsSync(DUMP))('живой прогон сигналов по рабочим листам всех книг', () => {
  it('считает картину проблем', () => {
    const books = JSON.parse(readFileSync(DUMP, 'utf8')) as
      Record<string, Array<{ row: number; cells: Record<string, string> }>>;
    const byKind: Record<string, { rows: number; plan: number }> = {};
    const byBook: Record<string, Record<string, number>> = {};
    const examples: Record<string, string[]> = {};
    let total = 0;
    for (const [book, rows] of Object.entries(books)) {
      byBook[book] = {};
      for (const r of rows) {
        total += 1;
        const s = detectSignals(r.cells) as unknown as Record<string, boolean>;
        const plan = Number(String(r.cells.K ?? '0').replace(/\s/gu, '').replace(',', '.')) || 0;
        for (const [key, on] of Object.entries(s)) {
          if (on !== true) continue;
          if (['signed', 'hasFact', 'economyFlag', 'planSoon'].includes(key)) continue;
          byKind[key] ??= { rows: 0, plan: 0 };
          byKind[key].rows += 1;
          byKind[key].plan += plan;
          byBook[book][key] = (byBook[book][key] ?? 0) + 1;
          examples[key] ??= [];
          if (examples[key].length < 4) {
            examples[key].push(`${book} стр ${r.row} № ${r.cells.A ?? '—'} · ${(r.cells.G ?? '').slice(0, 46)} · план ${plan}`);
          }
        }
      }
    }
    writeFileSync(BASE + 'signal-scan.json',
      JSON.stringify({ total, byKind, byBook, examples }, null, 1), 'utf8');
  });
});
