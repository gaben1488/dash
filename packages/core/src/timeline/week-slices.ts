/**
 * week-slices.ts — исторические точки строки ДО журнала правок: три архивные
 * недели из фикстур ручного отчёта (08.05, 29.05, 26.06.2026).
 *
 * Фикстуры (`../report/__fixtures__/week-*.json`) собраны из живых книг тех
 * недель скриптом extract-week-fixture.mts и уже служат регрессу «расчёт
 * против ручного отчёта». Здесь они — третий источник таймлайна (п.75в):
 * состояние строки в три момента, когда ни журнала, ни снимков ещё не было.
 *
 * ЧЕСТНОСТЬ СОПОСТАВЛЕНИЯ. Фикстура НЕ хранит номер строки листа: в ней
 * лежат только счётные строки (kept) в 22 колонках из 34. Поэтому строка
 * опознаётся структурным ключом-содержимым: № п/п (A) + подвед (C) + предмет
 * (G, в фикстуре обрезан — сравнение по общему префиксу). Ноль кандидатов
 * ИЛИ больше одного — наблюдение той недели НЕ выдаётся: показать чужую
 * строку хуже, чем честно промолчать. Отсутствие совпадения не значит
 * «строки не было»: фикстура несёт только строки счётного набора той недели.
 */

import { COL_LETTER_INDEX } from '@aemr/shared';
import w0805 from '../report/__fixtures__/week-08.05.2026.json';
import w2905 from '../report/__fixtures__/week-29.05.2026.json';
import w2606 from '../report/__fixtures__/week-26.06.2026.json';

/** Форма фикстуры недели (подмножество полей, нужное срезам). */
interface WeekFixtureLike {
  /** «08.05.2026» — дата папки ручного отчёта. */
  date: string;
  /** Номер суток среза (дней от 1970-01-01). */
  asOfDay: number;
  /** Индексы колонок книги (0-based, канон DEPT_COLUMNS), попавшие в фикстуру. */
  columns: number[];
  /** Счётные строки по книгам; ключи — кириллические имена листов. */
  rowsByDept: Record<string, unknown[][]>;
}

const WEEK_FIXTURES: readonly WeekFixtureLike[] = [
  w0805 as unknown as WeekFixtureLike,
  w2905 as unknown as WeekFixtureLike,
  w2606 as unknown as WeekFixtureLike,
];

/** Обратная карта: 0-based индекс колонки → буква («13» → «N»). */
const INDEX_TO_LETTER: ReadonlyMap<number, string> = new Map(
  Object.entries(COL_LETTER_INDEX).map(([letter, idx]) => [idx, letter]),
);

/** Даты доступных срезов недель (ISO) — для честной подписи глубины истории. */
export const WEEK_SLICE_DATES: readonly string[] = WEEK_FIXTURES.map((f) => {
  const m = f.date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : f.date;
});

/** Структурный ключ-содержимое для опознания строки в фикстуре. */
export interface WeekSliceKey {
  /** Кириллическое имя книги («УЭР») — ключ rowsByDept фикстур. */
  dept: string;
  /** Колонка A текущей строки (№ п/п). */
  id: unknown;
  /** Колонка C текущей строки (подвед). */
  subordinate: unknown;
  /** Колонка G текущей строки (предмет; фикстурный обрезан — общий префикс). */
  subject: unknown;
}

/** Наблюдение строки в срезе недели. */
export interface WeekSliceObservation {
  /** ISO-дата среза («2026-05-08»). */
  at: string;
  /** Частичные ячейки по буквам — только колонки, которые фикстура несёт. */
  cells: Record<string, unknown>;
}

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Предметы совпадают по общему префиксу (фикстурный обрезан посреди слова). */
function subjectsCompatible(a: string, b: string): boolean {
  if (a === '' || b === '') return a === b;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * Наблюдения строки в архивных срезах недель. Для каждой недели строка
 * опознаётся ключом A+C+G; неоднозначность или отсутствие — неделя честно
 * пропускается. Возвращается по возрастанию даты среза.
 */
export function weekSliceObservations(key: WeekSliceKey): WeekSliceObservation[] {
  const wantId = norm(key.id);
  const wantSub = norm(key.subordinate);
  const wantSubject = norm(key.subject);
  if (wantId === '' && wantSubject === '') return [];

  const out: WeekSliceObservation[] = [];
  for (let f = 0; f < WEEK_FIXTURES.length; f++) {
    const fixture = WEEK_FIXTURES[f];
    const rows = fixture.rowsByDept[key.dept];
    if (!rows) continue;

    const candidates: unknown[][] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      // Позиции A/C/G внутри фикстурной строки — по карте columns.
      const at = (colIdx: number): unknown => {
        const pos = fixture.columns.indexOf(colIdx);
        return pos >= 0 ? row[pos] : undefined;
      };
      if (norm(at(0)) !== wantId) continue;            // A — № п/п
      if (norm(at(2)) !== wantSub) continue;           // C — подвед
      if (!subjectsCompatible(norm(at(6)), wantSubject)) continue; // G — предмет
      candidates.push(row);
    }
    if (candidates.length !== 1) continue; // 0 или >1 — честный пропуск недели

    const cells: Record<string, unknown> = {};
    fixture.columns.forEach((colIdx, pos) => {
      const letter = INDEX_TO_LETTER.get(colIdx);
      if (letter) cells[letter] = candidates[0][pos] ?? null;
    });
    out.push({ at: WEEK_SLICE_DATES[f], cells });
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}
