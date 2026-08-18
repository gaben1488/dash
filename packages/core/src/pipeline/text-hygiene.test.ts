/**
 * Гигиена текста — канон п.98д (пакет поручений 18.08.2026) + п.95/55:
 * «очень хорошо понятно сделанные сигналы, чтобы помогать операторам
 * приводить данные в нормальный вид».
 *
 * Правило text_hygiene — проверка УРОВНЯ ЛИСТА, как и нумерация A: находки по
 * колонкам C (подвед) и G (предмет) выходят ОДНОЙ карточкой со списком
 * «адрес → дефект → готовое исправление» (каскад п.53). Тесты идут через
 * validateData — ту же дверь, которой правило живёт в проде.
 *
 * Фикстура «Жар-Птица» воспроизводит живой кейс листа «ВСЕ» книги УО: канон
 * справочника «МБДОУ ДС № 3 «Жар-Птица»» в большинстве строк против пяти
 * строк с «№3» без пробела (строки 2309, 2521, 2647–2649).
 */
import { describe, it, expect } from 'vitest';
import { RULE_BOOK, CHECK_REGISTRY } from '@aemr/shared';
import type { ClassifiedRow, NormalizedMetric, ReportMapEntry } from '@aemr/shared';
import { validateData } from './validate.js';

const EMPTY_METRICS = new Map<string, NormalizedMetric>();
const EMPTY_REPORT_MAP: ReportMapEntry[] = [];

/** Только испытуемое правило — соседние правила RULE_BOOK не шумят в тестах. */
const HYGIENE_RULES = RULE_BOOK.filter((r) => r.id === 'text_hygiene');

const ZHAR_CANON = 'МБДОУ ДС № 3 «Жар-Птица»';
const ZHAR_VARIANT = 'МБДОУ ДС №3 «Жар-Птица»';

/** Счётная строка листа управления: подвед (C), предмет (G), способ, план. */
function row(rowIndex: number, c: unknown, g: unknown, overrides: Partial<ClassifiedRow> = {}): ClassifiedRow {
  return {
    rowIndex,
    sheet: 'ВСЕ',
    classification: 'procurement',
    classificationConfidence: 0.9,
    classificationReasons: ['test'],
    cells: { A: rowIndex, C: c, G: g, K: 100, L: 'ЭА' },
    ...overrides,
  };
}

function run(rows: ClassifiedRow[]) {
  return validateData(EMPTY_METRICS, rows, HYGIENE_RULES, EMPTY_REPORT_MAP);
}

describe('text_hygiene — правило есть и заведено в реестр', () => {
  it('RULE_BOOK содержит правило, CHECK_REGISTRY — карточку класса', () => {
    expect(HYGIENE_RULES).toHaveLength(1);
    const check = CHECK_REGISTRY.find((c) => c.id === 'text_hygiene');
    expect(check).toBeDefined();
    expect(check!.scope).toBe('department');
    // Канон п.98д: карточка отдаёт оператору готовое значение ячейки.
    expect(check!.recommendation).toContain('вставить готовые значения');
  });
});

describe('text_hygiene — одна карточка на лист (каскад п.53)', () => {
  it('чистый лист молчит', () => {
    expect(run([
      // ДС № 1 в справочнике — МАДОУ (автономное), а не МБДОУ: организационная
      // форма часть дословного имени, и подмена буквы — отступление, не описка.
      row(4, 'МАДОУ ДС № 1 «Ласточка»', 'Поставка бумаги'),
      row(5, ZHAR_CANON, 'Ремонт кровли'),
    ])).toHaveLength(0);
  });

  it('подмена организационной формы (МАДОУ → МБДОУ) — отступление от справочника', () => {
    const [issue] = run([row(4, 'МБДОУ ДС № 1 «Ласточка»', 'Поставка бумаги')]);
    expect(issue.description).toContain('вставить: «МАДОУ ДС № 1 «Ласточка»»');
  });

  it('дефекты в трёх строках дают РОВНО ОДНУ карточку со всеми адресами', () => {
    const issues = run([
      row(4, ZHAR_CANON, 'Поставка  бумаги'),
      row(5, ZHAR_CANON, 'Ремонт кровли '),
      row(6, ZHAR_VARIANT, 'Поставка мебели'),
    ]);
    expect(issues).toHaveLength(1);
    const text = issues[0].description;
    expect(text).toContain('G4');
    expect(text).toContain('G5');
    expect(text).toContain('C6');
  });

  it('карточка несёт готовое исправление для каждой названной ячейки', () => {
    const [issue] = run([row(4, ZHAR_CANON, 'Бумага ,картриджи')]);
    expect(issue.description).toContain('вставить: «Бумага, картриджи»');
  });

  it('обе колонки одной строки попадают в карточку своими адресами', () => {
    const [issue] = run([row(4, 'МБУ ДО СШОР по ЛBС', 'Поставка  мебели')]);
    expect(issue.description).toContain('C4');
    expect(issue.description).toContain('G4');
    expect(issue.description).toContain('вставить: «МБУ ДО СШОР по ЛВС»');
    expect(issue.description).toContain('вставить: «Поставка мебели»');
  });

  it('служебная строка «итого» не чистится — гигиена только по счётным строкам', () => {
    const summary = row(7, 'ИТОГО  ПО  УЧРЕЖДЕНИЮ', 'итого', {
      classification: 'summary',
      cells: { A: '', C: 'ИТОГО  ПО  УЧРЕЖДЕНИЮ', K: 300 },
    });
    expect(run([row(4, ZHAR_CANON, 'Поставка бумаги'), summary])).toHaveLength(0);
  });

  it('на своде правило не работает — гигиена проверяется по листам управлений', () => {
    const svod = [row(4, ZHAR_VARIANT, 'Поставка  бумаги', { sheet: 'СВОД ТД-ПМ' })];
    expect(run(svod)).toHaveLength(0);
  });
});

describe('text_hygiene — живой кейс «Жар-Птица» (лист ВСЕ книги УО)', () => {
  /**
   * 43 строки канона против 5 строк варианта «№3» — доля не защищает вариант:
   * истина не в большинстве строк, а в справочнике подведов.
   */
  const VARIANT_ROWS = [2309, 2521, 2647, 2648, 2649];

  function zharSheet(): ClassifiedRow[] {
    const rows: ClassifiedRow[] = [];
    for (let i = 0; i < 43; i++) rows.push(row(100 + i, ZHAR_CANON, 'Поставка продуктов питания'));
    for (const r of VARIANT_ROWS) rows.push(row(r, ZHAR_VARIANT, 'Поставка продуктов питания'));
    return rows;
  }

  it('пять отступивших строк названы поимённо, 43 канонические молчат', () => {
    const issues = run(zharSheet());
    expect(issues).toHaveLength(1);
    const text = issues[0].description;
    for (const r of VARIANT_ROWS) expect(text, `строка ${r}`).toContain(`C${r}`);
    expect(text).toContain('5 ячейках');
  });

  it('исправление — дословное имя справочника, вместе с пробелом после «№»', () => {
    const [issue] = run(zharSheet());
    expect(issue.description).toContain(`вставить: «${ZHAR_CANON}»`);
  });

  it('карточка несёт адрес первой находки и второй адрес строки (п.98б/в)', () => {
    const [issue] = run(zharSheet());
    expect(issue.checkId).toBe('text_hygiene');
    expect(issue.cell).toBe('C2309');
    // Якорь карточки — первая счётная строка листа; её № п/п — второй адрес.
    expect(issue.row).toBe(100);
    expect(issue.rowSeq).toBe('100');
  });
});

describe('text_hygiene — осторожность: легитимные различия молчат', () => {
  it('маркеры отсутствия «х» в C и G не трогаются (канон п.62)', () => {
    expect(run([
      row(4, 'х', 'Поставка бумаги'),
      row(5, 'X', 'x'),
      row(6, '-', '—'),
    ])).toHaveLength(0);
  });

  it('десятичная запятая, инициалы и кавычки справочника — не дефект', () => {
    expect(run([
      row(4, 'МБОУ «Елизовская средняя школа №1 имени М.В.Ломоносова»', 'Уголь 1,5 тонны'),
      row(5, 'МБУ ДО "КДМШ"', 'Ремонт по п.4 ст.93'),
    ])).toHaveLength(0);
  });

  it('число в текстовой колонке карточку не рождает', () => {
    expect(run([row(4, 100, 500)])).toHaveLength(0);
  });
});
