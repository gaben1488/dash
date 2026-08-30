/**
 * Стражи вывода формульной целостности на экраны (срез 4 волны обмотки,
 * 30.08.2026).
 *
 * Под охраной три обещания:
 *   1. ПОДПИСИ КЛАССОВ НА МЕСТЕ — три идентификатора, которыми экран зовёт
 *      классы, существуют в реестре проверок, стоят в группе формульной
 *      согласованности и несут слагаемое доверия «целостность формул». Экран
 *      не выдумывает ни имени, ни рецепта: и то и другое берётся из паспорта.
 *   2. «НЕТ ДАННЫХ ≠ НОЛЬ» — пятно Пульта при непрочитанных формулах говорит
 *      «не читались», а не «ноль дефектов», и счёта не показывает вовсе.
 *   3. СЧЁТ ПЯТНА СЧИТАЕТСЯ ИЗ ДАННЫХ — из самих замечаний, а не из
 *      захардкоженного числа; разбор описания сверен с ПРОИЗВОДИТЕЛЕМ
 *      (исходник core/pipeline/formula-integrity.ts читается тестом).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_REGISTRY, getCheckById } from '@aemr/shared';
import {
  FORMULA_DEFECT_CHECK_IDS,
  FORMULA_DEFECT_GROUP,
  FORMULA_INTEGRITY_TITLE,
  collectFormulaDefects,
  countFormulaDefects,
  formulaDefectName,
  formulaIntegritySpot,
  formulaRowKey,
  indexFormulaDefectsByRow,
  isFormulaDefectIssue,
  parseActual,
  parseDonorRow,
  parseEtalon,
  type FormulaReadState,
} from './formula-defects';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Исходник слоя-производителя: он задаёт формулировки, которые здесь разбираются. */
const PRODUCER = readFileSync(
  join(HERE, '..', '..', '..', '..', 'core', 'src', 'pipeline', 'formula-integrity.ts'),
  'utf8',
);

// ────────────────────────────────────────────────────────────
// 1. Подписи классов на месте
// ────────────────────────────────────────────────────────────

describe('три класса формульной целостности: паспорта на месте', () => {
  it('каждый идентификатор экрана найден в реестре проверок', () => {
    for (const id of FORMULA_DEFECT_CHECK_IDS) {
      const entry = getCheckById(id);
      expect(
        entry,
        `Класс «${id}» показывается на Пульте, Контроле и в Реестре, но паспорта в `
        + 'CHECK_REGISTRY у него нет: подпись, механизм и рецепт починки взять неоткуда.',
      ).toBeDefined();
    }
  });

  it('все три стоят в группе формульной согласованности и несут своё слагаемое доверия', () => {
    for (const id of FORMULA_DEFECT_CHECK_IDS) {
      const entry = getCheckById(id);
      expect(entry?.group, `Класс «${id}» ушёл из группы ${FORMULA_DEFECT_GROUP}`)
        .toBe(FORMULA_DEFECT_GROUP);
      expect(entry?.trustComponent, `Класс «${id}» перестал считаться целостностью формул`)
        .toBe('formula_integrity');
    }
  });

  it('имя класса на экране — дословно имя паспорта, своей формулировки нет', () => {
    for (const id of FORMULA_DEFECT_CHECK_IDS) {
      const entry = CHECK_REGISTRY.find((c) => c.id === id);
      expect(formulaDefectName(id)).toBe(entry?.name);
      expect(formulaDefectName(id)).not.toBe('');
    }
  });

  it('перечень закрыт: экран знает ровно три класса', () => {
    expect([...FORMULA_DEFECT_CHECK_IDS]).toEqual([
      'formula_overwritten',
      'formula_mutant',
      'formula_hole',
    ]);
  });
});

// ────────────────────────────────────────────────────────────
// 2. Разбор описания сверен с производителем
// ────────────────────────────────────────────────────────────

describe('разбор описания замечания против формулировок производителя', () => {
  it('ядро печатает ровно те обороты, по которым экран вынимает значения', () => {
    // Поменяется фраза в core/pipeline/formula-integrity.ts — упадёт этот
    // страж, а не молча опустеет карточка дефекта на экране.
    for (const fragment of [
      'формула не протянута, ячейка пуста. Эталон графы: ',
      'вместо формулы стоит «',
      '» расходится с эталоном графы ',
      '; целая формула — в строке ',
    ]) {
      expect(
        PRODUCER.includes(fragment),
        `Производитель больше не печатает оборот «${fragment}» — разбор описания на экране ослеп`,
      ).toBe(true);
    }
  });

  it('затёртая формула: что стоит и каков эталон читаются из описания', () => {
    const description =
      'УИО, ячейка K34 (закупка № 34): вместо формулы стоит «6696,6075». '
      + 'Эталон графы: =SUM(H#:J#); целая формула — в строке 35.';
    expect(parseActual(description, 'formula_overwritten')).toBe('6696,6075');
    expect(parseEtalon(description)).toBe('=SUM(H#:J#)');
    expect(parseDonorRow(description)).toBe(35);
  });

  it('мутант: своя форма фразы разбирается тем же слоем', () => {
    const description =
      'УО, ячейка Y1894 (закупка № 2431): формула «=SUM(V1894:W1894)» расходится с эталоном '
      + 'графы =SUM(V#:X#); целая формула — в строке 1893.';
    expect(parseActual(description, 'formula_mutant')).toBe('=SUM(V1894:W1894)');
    expect(parseEtalon(description)).toBe('=SUM(V#:X#)');
    expect(parseDonorRow(description)).toBe(1893);
  });

  it('дыра протяжки: в ячейке пусто — это null, а не пустая строка', () => {
    const description =
      'УКСиМП, ячейка AA23 (закупка № 23): формула не протянута, ячейка пуста. '
      + 'Эталон графы: =I#-W#.';
    expect(parseActual(description, 'formula_hole')).toBeNull();
    expect(parseEtalon(description)).toBe('=I#-W#');
    expect(parseDonorRow(description)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// 3. Сбор, счёт и сшивка со строкой
// ────────────────────────────────────────────────────────────

const ISSUES = [
  {
    id: 'f1',
    checkId: 'formula_overwritten',
    sheet: 'УИО',
    departmentId: 'uio',
    cell: 'K34',
    row: 34,
    rowSeq: '34',
    description:
      'УИО, ячейка K34 (закупка № 34): вместо формулы стоит «6696,6075». '
      + 'Эталон графы: =SUM(H#:J#); целая формула — в строке 35.',
  },
  {
    id: 'f2',
    checkId: 'formula_mutant',
    sheet: 'УО',
    departmentId: 'uo',
    cell: 'Y1894',
    row: 1894,
    rowSeq: '2431',
    description:
      'УО, ячейка Y1894 (закупка № 2431): формула «=SUM(V1894:W1894)» расходится с эталоном '
      + 'графы =SUM(V#:X#).',
  },
  {
    id: 'other',
    checkId: 'plan_year_missing',
    sheet: 'УО',
    departmentId: 'uo',
    description: 'Не про формулы вовсе',
  },
];

describe('сбор дефектов и счёт из данных', () => {
  it('чужие замечания отсеиваются, свои опознаются по идентификатору паспорта', () => {
    expect(isFormulaDefectIssue(ISSUES[0]!)).toBe(true);
    expect(isFormulaDefectIssue(ISSUES[2]!)).toBe(false);
    expect(collectFormulaDefects(ISSUES).map((d) => d.id)).toEqual(['f1', 'f2']);
  });

  it('адрес и значения доезжают до экрана целиком', () => {
    const [uio] = collectFormulaDefects(ISSUES);
    expect(uio!.book).toBe('УИО');
    expect(uio!.cell).toBe('K34');
    expect(uio!.rowSeq).toBe('34');
    expect(uio!.actual).toBe('6696,6075');
    expect(uio!.etalon).toBe('=SUM(H#:J#)');
    expect(uio!.className).toBe(formulaDefectName('formula_overwritten'));
    expect(uio!.recommendation).not.toBe('');
  });

  it('счёт считается ИЗ ДАННЫХ: всего, по классам и по книгам', () => {
    const counts = countFormulaDefects(collectFormulaDefects(ISSUES));
    expect(counts.total).toBe(2);
    expect(counts.byClass.formula_overwritten).toBe(1);
    expect(counts.byClass.formula_mutant).toBe(1);
    expect(counts.byClass.formula_hole).toBe(0);
    expect(counts.byBook).toEqual({ 'УИО': 1, 'УО': 1 });
  });

  it('сшивка со строкой Реестра идёт по номеру закупки, а не по номеру строки листа', () => {
    const index = indexFormulaDefectsByRow(collectFormulaDefects(ISSUES));
    // Ключ строки Реестра собирается из её собственных полей — и совпадает.
    expect(index.get(formulaRowKey('УО', '2431'))?.map((d) => d.cell)).toEqual(['Y1894']);
    // Латинская форма ключа управления канонизируется той же функцией.
    expect(formulaRowKey('uio', '34')).toBe(formulaRowKey('УИО', '34'));
    expect(index.get(formulaRowKey('uio', '34'))?.map((d) => d.cell)).toEqual(['K34']);
    // Номер строки листа ключом не является: сдвиг строк не орфанит дефект.
    expect(index.get(formulaRowKey('УО', '1894'))).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// 4. Пятно Пульта: «нет данных ≠ ноль»
// ────────────────────────────────────────────────────────────

const EMPTY_COUNTS = countFormulaDefects([]);
const LIVE_COUNTS = countFormulaDefects(collectFormulaDefects(ISSUES));

function state(patch: Partial<FormulaReadState>): FormulaReadState {
  return {
    columns: ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC'],
    sinkConnected: true,
    books: [],
    notRead: [],
    ...patch,
  };
}

describe('пятно Пульта «Целостность формул книг»', () => {
  it('состояния нет вовсе — пятно не рисуется: отсутствие ответа не ноль', () => {
    expect(formulaIntegritySpot(null, EMPTY_COUNTS)).toBeNull();
  });

  it('формулы не читались — сказано «не читались», счёта нет, дверь закрыта', () => {
    const spot = formulaIntegritySpot(state({ notRead: ['УО', 'УИО'] }), EMPTY_COUNTS);
    expect(spot).not.toBeNull();
    expect(spot!.title).toBe(FORMULA_INTEGRITY_TITLE);
    expect(spot!.cells).toBeNull();
    expect(spot!.text).toContain('не читались');
    expect(spot!.text).toContain('не значит');
    expect(spot!.hasDoor).toBe(false);
  });

  it('прочитаны, но разбор не подключён — счёта нет и сказано почему', () => {
    const spot = formulaIntegritySpot(
      state({
        sinkConnected: false,
        books: [{ book: 'УО', at: '2026-08-30T02:00:00Z', cells: 900, handled: false, failedBecause: 'разбор формул не подключён' }],
      }),
      EMPTY_COUNTS,
    );
    expect(spot!.cells).toBeNull();
    expect(spot!.text).toContain('разбор формул не подключён');
    expect(spot!.text).toContain('не «дефектов нет»');
    expect(spot!.hasDoor).toBe(false);
  });

  it('разобрано и чисто — это НОЛЬ, и он назван нулём, а не молчанием', () => {
    const spot = formulaIntegritySpot(
      state({ books: [{ book: 'УО', at: '2026-08-30T02:00:00Z', cells: 900, handled: true }] }),
      EMPTY_COUNTS,
    );
    expect(spot!.cells).toBe(0);
    expect(spot!.text).toContain('Дефектов формул не найдено');
    expect(spot!.hasDoor).toBe(false);
  });

  it('дефекты есть — счёт из данных, разбивка по классам, дверь открыта', () => {
    const spot = formulaIntegritySpot(
      state({
        books: [
          { book: 'УО', at: '2026-08-30T02:00:00Z', cells: 900, handled: true },
          { book: 'УИО', at: '2026-08-30T02:00:00Z', cells: 400, handled: true },
        ],
      }),
      LIVE_COUNTS,
    );
    expect(spot!.cells).toBe(2);
    expect(spot!.text).toContain(formulaDefectName('formula_overwritten'));
    expect(spot!.text).toContain(formulaDefectName('formula_mutant'));
    expect(spot!.hasDoor).toBe(true);
    expect(spot!.breakdown.map((b) => b.count)).toEqual([1, 1, 0]);
  });

  it('часть книг не читалась — оговорка стоит рядом со счётом, а не пропадает', () => {
    const spot = formulaIntegritySpot(
      state({
        books: [{ book: 'УО', at: '2026-08-30T02:00:00Z', cells: 900, handled: true }],
        notRead: ['УИО', 'УКСиМП'],
      }),
      LIVE_COUNTS,
    );
    expect(spot!.text).toContain('не читались вовсе');
    expect(spot!.text).toContain('УИО');
    expect(spot!.text).toContain('УКСиМП');
  });
});
