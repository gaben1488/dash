/**
 * Стражи слоя формульной целостности (срез 2 волны «обмотки над таблицами»,
 * план `docs/superpowers/audits/2026-08-30-obmotka-plan.md` §5, решение
 * владельца §22 п.7).
 *
 * Держат ровно то, ради чего слой заведён:
 *  · три класса дефекта ловятся (вбитое число, мутант, дыра);
 *  · строка БЕЗ номера закупки дырой не считается, а формула, протянутая на
 *    неё впрок, дефектом не считается (урок дампов 30.08 — прежний ручной
 *    инструмент пугал числами, за которыми не стояло дефекта);
 *  · книга, у которой формулы НЕ ЧИТАЛИ, не рождает ни одного ложного
 *    дефекта: молчание слоя честное, а не «проверено, чисто»;
 *  · эталон графы берётся МОДОЙ, а не первой строкой (в УО первые строки
 *    бывают особыми);
 *  · читаются одиннадцать канонных граф, а не весь лист.
 */
import { describe, it, expect } from 'vitest';
import { CHECK_REGISTRY, DEPT_COLUMNS } from '@aemr/shared';
import {
  FORMULA_COLUMNS,
  detectFormulaIntegrity,
  formulaIntegrityIssues,
  normalizeFormula,
  type FormulaIntegrityInput,
} from './formula-integrity.js';
import { runPipeline } from './orchestrator.js';

// ────────────────────────────────────────────────────────────
// Заготовка книги
// ────────────────────────────────────────────────────────────

/** Канонная формула графы для строки листа — построчный диалект книги ГРБС. */
const CANON: Record<string, (row: number) => string> = {
  K: (r) => `=SUM(H${r}:J${r})`,
  O: (r) => `=IFERROR(ROUNDUP(MONTH(N${r})/3);"")`,
  P: (r) => `=IFERROR(YEAR(N${r});"")`,
  R: (r) => `=IFERROR(ROUNDUP(MONTH(Q${r})/3);"")`,
  S: (r) => `=IFERROR(YEAR(Q${r});"")`,
  T: (r) => `=IF(N${r}="";"";Q${r}-N${r})`,
  Y: (r) => `=SUM(V${r}:X${r})`,
  Z: (r) => `=H${r}-V${r}`,
  AA: (r) => `=I${r}-W${r}`,
  AB: (r) => `=J${r}-X${r}`,
  AC: (r) => `=SUM(Z${r}:AB${r})`,
};

const COLUMN_INDEX: Record<string, number> = {
  K: 10, O: 14, P: 15, R: 17, S: 18, Y: 24, T: 19, Z: 25, AA: 26, AB: 27, AC: 28,
};

/**
 * Строка книги: номер закупки в графе A (пустой = строка без номера) и
 * подмены формул. Строковая подмена с «#» подставляет номер строки листа —
 * так же, как читается эталон.
 */
interface RowSpec {
  seq: string | number;
  /** Подмены формульных ячеек: '' = дыра, число = вбито, строка = формула. */
  cells?: Record<string, unknown>;
}

const HEADER_ROWS = 3;

/** Книга: три строки шапки (в третьей — подписи), затем строки данных с row 4. */
function book(rows: RowSpec[]): { values: unknown[][]; formulas: unknown[][] } {
  const values: unknown[][] = [
    new Array(34).fill(''),
    new Array(34).fill(''),
    new Array(34).fill(''),
  ];
  // Подпись шапки в графе A — не номер закупки: гейт обязан её отсеять.
  values[2][DEPT_COLUMNS.ID] = '№ п/п';
  const formulas: unknown[][] = [[], [], []];

  rows.forEach((spec, i) => {
    const sheetRow = HEADER_ROWS + i + 1;
    const line: unknown[] = new Array(34).fill('');
    line[DEPT_COLUMNS.ID] = spec.seq;
    line[DEPT_COLUMNS.SUBJECT] = `Закупка ${spec.seq}`;
    values.push(line);

    const fline: unknown[] = [];
    for (const column of FORMULA_COLUMNS) {
      const override = spec.cells?.[column];
      const value = override === undefined
        ? CANON[column](sheetRow)
        : (typeof override === 'string' ? override.replace(/#/g, String(sheetRow)) : override);
      fline[COLUMN_INDEX[column]] = value;
    }
    formulas.push(fline);
  });

  return { values, formulas };
}

function detect(rows: RowSpec[], extra: Partial<FormulaIntegrityInput> = {}) {
  const { values, formulas } = book(rows);
  return detectFormulaIntegrity({ book: 'УО', values, formulas, startRow: 1, ...extra });
}

/** Пять здоровых строк — фон, на котором эталон графы очевиден. */
const HEALTHY: RowSpec[] = [
  { seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }, { seq: 5 },
];

// ────────────────────────────────────────────────────────────
// 1. Канон списка граф и паспорта
// ────────────────────────────────────────────────────────────

describe('формульная целостность — канон списка граф', () => {
  it('СТРАЖ: одиннадцать канонных граф, а не весь лист', () => {
    // Тот же список, что защищает канон таблиц (canon.cjs, goldenProtections:
    // K, O:P, R:T, Y:AC) и читает сервер (google-sheets.ts, FORMULA_COLUMNS).
    // Откат к дорогому чтению «всего листа» или потеря графы падает здесь.
    expect([...FORMULA_COLUMNS]).toEqual(['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC']);
    expect(FORMULA_COLUMNS).toHaveLength(11);
  });

  it('СТРАЖ: у трёх классов есть паспорта уровня «ошибка» с рецептом протяжки', () => {
    for (const id of ['formula_overwritten', 'formula_mutant', 'formula_hole']) {
      const check = CHECK_REGISTRY.find((c) => c.id === id);
      expect(check, `паспорт «${id}» не заведён`).toBeDefined();
      expect(check!.severity).toBe('error');
      expect(check!.group).toBe('formula_consistency');
      expect(check!.trustComponent).toBe('formula_integrity');
      expect(check!.scope).toBe('department');
      // Рецепт починки у всех трёх один и назван прямо.
      expect(check!.recommendation).toContain('Протянуть формулу из соседней строки');
    }
  });
});

// ────────────────────────────────────────────────────────────
// 2. Нормализация — та же, что в приёмке эталона
// ────────────────────────────────────────────────────────────

describe('нормализация формулы — как в qa.cjs', () => {
  it('номер собственной строки становится «#», пробелы уходят', () => {
    expect(normalizeFormula('=SUM(H34:J34)', 34)).toBe('=SUM(H#:J#)');
    expect(normalizeFormula('= SUM( H34 : J34 )', 34)).toBe('=SUM(H#:J#)');
    expect(normalizeFormula('=$H$34+$I$34', 34)).toBe('=$H$#+$I$#');
  });

  it('чужой номер строки НЕ подменяется — сдвинутая ссылка остаётся видимой', () => {
    // Ровно на этом стоит класс «мутант»: формула строки 1894, ссылающаяся
    // на строку 1893, обязана разойтись с эталоном.
    expect(normalizeFormula('=SUM(H33:J33)', 34)).toBe('=SUM(H33:J33)');
  });

  it('номер, входящий в более длинное число, не трогается', () => {
    expect(normalizeFormula('=SUM(H341:J341)', 34)).toBe('=SUM(H341:J341)');
  });
});

// ────────────────────────────────────────────────────────────
// 3. Три класса
// ────────────────────────────────────────────────────────────

describe('формульная целостность — три класса дефекта', () => {
  it('вбитое число вместо формулы ловится (класс formula_overwritten)', () => {
    // Живой случай УИО K34: вместо суммы плана стоит вбитое значение.
    const defects = detect([
      ...HEALTHY.slice(0, 2),
      { seq: 34, cells: { K: 6696.6075 } },
      ...HEALTHY.slice(2),
    ]);
    expect(defects).toHaveLength(1);
    expect(defects[0].kind).toBe('formula_overwritten');
    expect(defects[0].column).toBe('K');
    expect(defects[0].rowSeq).toBe('34');
    expect(defects[0].actual).toBe('6696.6075');
    expect(defects[0].etalon).toBe('=SUM(H#:J#)');
  });

  it('вбитый ноль тоже ловится — «пусто» и «вбит ноль» это разные вещи', () => {
    // Живой случай УИО AA23: в графе экономии вбит 0.
    const defects = detect([...HEALTHY, { seq: 23, cells: { AA: 0 } }]);
    expect(defects).toHaveLength(1);
    expect(defects[0].kind).toBe('formula_overwritten');
    expect(defects[0].column).toBe('AA');
    expect(defects[0].actual).toBe('0');
  });

  it('мутант =SUM(V:W) при эталоне =SUM(V:X) ловится (класс formula_mutant)', () => {
    // Живой случай УО Y1894: сумма факта считает два источника из трёх.
    const defects = detect([
      ...HEALTHY,
      { seq: 1894, cells: { Y: '=SUM(V#:W#)' } },
    ]);
    expect(defects).toHaveLength(1);
    expect(defects[0].kind).toBe('formula_mutant');
    expect(defects[0].column).toBe('Y');
    expect(defects[0].cell).toBe('Y9');
    expect(defects[0].actual).toBe('=SUM(V9:W9)');
    expect(defects[0].etalon).toBe('=SUM(V#:X#)');
  });

  it('съехавшая на соседнюю строку ссылка — тоже мутант', () => {
    const defects = detect([
      ...HEALTHY,
      { seq: 6, cells: { K: '=SUM(H8:J8)' } },
    ]);
    expect(defects).toHaveLength(1);
    expect(defects[0].kind).toBe('formula_mutant');
  });

  it('пустая формульная ячейка при живом номере закупки ловится (класс formula_hole)', () => {
    const defects = detect([
      ...HEALTHY,
      { seq: 6, cells: { AC: '' } },
    ]);
    expect(defects).toHaveLength(1);
    expect(defects[0].kind).toBe('formula_hole');
    expect(defects[0].column).toBe('AC');
    expect(defects[0].actual).toBe('');
  });

  it('здоровая книга молчит', () => {
    expect(detect(HEALTHY)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// 4. Строки без номера закупки
// ────────────────────────────────────────────────────────────

describe('формульная целостность — строки без номера в графе A', () => {
  it('пустая строка хвоста дырой НЕ считается', () => {
    // Урок дампов 30.08: ручной инструмент насчитал «дыры» на 58 пустых
    // строках хвоста УО, за которыми не стояло ни одного дефекта.
    const defects = detect([
      ...HEALTHY,
      { seq: '', cells: Object.fromEntries(FORMULA_COLUMNS.map((c) => [c, ''])) },
      { seq: '', cells: Object.fromEntries(FORMULA_COLUMNS.map((c) => [c, ''])) },
    ]);
    expect(defects).toEqual([]);
  });

  it('формула, протянутая впрок на строку без номера, дефектом НЕ считается', () => {
    const defects = detect([...HEALTHY, { seq: '' }, { seq: '   ' }]);
    expect(defects).toEqual([]);
  });

  it('мусор в графе A (не номер) выводит строку из-под суда целиком', () => {
    const defects = detect([
      ...HEALTHY,
      { seq: 'нет номера', cells: { K: 999 } },
      { seq: 0, cells: { Y: '' } },
    ]);
    expect(defects).toEqual([]);
  });

  it('подпись шапки «№ п/п» номером закупки не считается', () => {
    // Шапка книги в графе A несёт подпись, а не число; формул в ней нет.
    // Гейт «A — число больше нуля» обязан отсеять её молча.
    const { values, formulas } = book(HEALTHY);
    expect(values[2][DEPT_COLUMNS.ID]).toBe('№ п/п');
    expect(detectFormulaIntegrity({ book: 'УО', values, formulas, startRow: 1 })).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// 5. Книга без прочитанных формул
// ────────────────────────────────────────────────────────────

describe('формульная целостность — формулы не читали', () => {
  it('пустая сетка формул НЕ рождает дефектов: слой честно молчит', () => {
    // Формулы читаются по вебхуку и в ночном обходе (§22 п.7); быстрое
    // обновление за них не платит — и не имеет права выдавать своё молчание
    // за проверенную книгу.
    const { values } = book(HEALTHY);
    expect(detectFormulaIntegrity({ book: 'УО', values, formulas: [], startRow: 1 })).toEqual([]);
  });

  it('явное «формулы не читались» перевешивает даже поданную сетку', () => {
    const defects = detect(
      [...HEALTHY, { seq: 6, cells: { K: 123 } }],
      { formulasRead: false },
    );
    expect(defects).toEqual([]);
  });

  it('непрочитанная ОТДЕЛЬНАЯ графа не превращается в тысячу дыр', () => {
    // Сервер читает четырьмя диапазонами (K, O:P, R:T, Y:AC): не вернувшийся
    // диапазон значит «не читали эту графу», а не «формул нет во всей книге».
    const { values, formulas } = book(HEALTHY);
    for (const line of formulas) {
      if (line.length > 0) line[COLUMN_INDEX.T] = '';
    }
    const defects = detectFormulaIntegrity({ book: 'УО', values, formulas, startRow: 1 });
    expect(defects).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// 6. Эталон — мода
// ────────────────────────────────────────────────────────────

describe('формульная целостность — эталон графы', () => {
  it('СТРАЖ: эталон берётся МОДОЙ, а не формулой первой строки', () => {
    // В УО первые строки бывают особыми. Возьми слой первую строку за эталон —
    // и вся здоровая графа объявится мутантом, а настоящий дефект уйдёт в норму.
    const defects = detect([
      { seq: 1, cells: { K: '=SUM(H#:I#)' } },
      { seq: 2 }, { seq: 3 }, { seq: 4 }, { seq: 5 },
    ]);
    expect(defects).toHaveLength(1);
    expect(defects[0].row).toBe(4);
    expect(defects[0].kind).toBe('formula_mutant');
    expect(defects[0].etalon).toBe('=SUM(H#:J#)');
  });

  it('дефект называет ближайшую строку-донора, из которой тянуть', () => {
    const defects = detect([
      { seq: 1 }, { seq: 2 }, { seq: 3 },
      { seq: 4, cells: { K: '' } },
      { seq: 5 },
    ]);
    expect(defects).toHaveLength(1);
    expect(defects[0].row).toBe(7);
    // Соседи-доноры — строки 6 и 8; ближе взята верхняя (равенство → выше).
    expect(defects[0].etalonRow).toBe(6);
  });
});

// ────────────────────────────────────────────────────────────
// 7. Состав дефекта и замечания
// ────────────────────────────────────────────────────────────

describe('формульная целостность — состав дефекта и замечания', () => {
  const rows: RowSpec[] = [...HEALTHY, { seq: 1175, cells: { K: 229.4 } }];

  it('дефект несёт книгу, адрес ячейки, номер закупки, класс, факт и эталон', () => {
    const defects = detect(rows);
    expect(defects[0]).toMatchObject({
      book: 'УО',
      column: 'K',
      row: 9,
      cell: 'K9',
      rowSeq: '1175',
      kind: 'formula_overwritten',
      actual: '229.4',
      etalon: '=SUM(H#:J#)',
    });
  });

  it('замечание адресуется до ячейки и берёт рецепт из паспорта', () => {
    const { values, formulas } = book(rows);
    const issues = formulaIntegrityIssues({ book: 'УО', values, formulas, startRow: 1 }, 'uo');
    expect(issues).toHaveLength(1);
    expect(issues[0].cell).toBe('K9');
    expect(issues[0].row).toBe(9);
    expect(issues[0].rowSeq).toBe('1175');
    expect(issues[0].sheet).toBe('УО');
    expect(issues[0].departmentId).toBe('uo');
    expect(issues[0].checkId).toBe('formula_overwritten');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].title).toContain('K9');
    expect(issues[0].description).toContain('закупка № 1175');
    expect(issues[0].description).toContain('=SUM(H#:J#)');
    expect(issues[0].recommendation).toContain('Протянуть формулу из соседней строки');
  });

  it('id замечания держится за номер закупки, а не за номер строки', () => {
    // Строки листа двигаются (п.98б). Вставка строки выше не имеет права
    // осиротить статус, поставленный оператором на это замечание.
    const before = formulaIntegrityIssues(
      { book: 'УО', ...book(rows), startRow: 1 },
      'uo',
    );
    const after = formulaIntegrityIssues(
      { book: 'УО', ...book([{ seq: 900 }, ...rows]), startRow: 1 },
      'uo',
    );
    expect(after.map((i) => i.id)).toContain(before[0].id);
    // Адрес при этом обязан обновиться: строка уехала вниз.
    expect(after.find((i) => i.id === before[0].id)!.cell).toBe('K10');
  });
});

// ────────────────────────────────────────────────────────────
// 8. Подключение к конвейеру
// ────────────────────────────────────────────────────────────

describe('формульная целостность — подключение к конвейеру', () => {
  const rows: RowSpec[] = [...HEALTHY, { seq: 1175, cells: { K: 229.4 } }];

  function run(withFormulas: boolean) {
    const { values, formulas } = book(rows);
    return runPipeline({
      batchGetData: [],
      sheetRows: { 'УО': values },
      ...(withFormulas ? { sheetFormulas: { 'УО': formulas } } : {}),
      reportMap: [],
      rules: [],
      spreadsheetId: 'test',
    });
  }

  it('прочитанные формулы доезжают до замечаний снимка', () => {
    const found = run(true).issues.filter((i) => i.checkId === 'formula_overwritten');
    expect(found).toHaveLength(1);
    expect(found[0].cell).toBe('K9');
    expect(found[0].departmentId).toBe('uo');
  });

  it('без прочитанных формул конвейер не выдумывает дефектов', () => {
    expect(run(false).issues.filter((i) => i.checkId?.startsWith('formula_'))).toEqual([]);
  });
});
