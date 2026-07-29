import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS, DEPT_HEADER_LABELS, isMetaRow } from './column-map';

/**
 * Фикстура: строка 3 (шапка) листа ГРБС — снято с живой книги УЭР 2026-07-29,
 * дословно, включая перенос строки в Q. У всех восьми книг шапка одна и та же
 * с точностью до пробелов и уточнений в скобках, поэтому сверять карту можно
 * по одной. Страж ниже ловит сдвиг индекса на колонку — так «Комментарий
 * ГРБСа» читался из «Обоснования необходимости», а AG/AH не читались вовсе.
 */
const SHEET_HEADER_ROW_3: readonly string[] = [
  '№ п/п',
  'Наименование управления',
  'Наименование подведомственного учреждения',
  'Наименование программы',
  'Пункт и наименование подпрограммы',
  'Программное мероприятие/текущая деятельность',
  'Наименование мероприятия/наименование предмета контракта',
  'ФБ 1',
  'КБ 1',
  'МБ 1',
  'ИТОГО 1',
  'Способ определения поставщика (ЭА и аналоги/ЕП)',
  'Причина выбора способа определения поставщика (в случае выбора ЕП)',
  'Планируемый',
  'Квартал (план)',
  'Год (план)',
  'Фактический\n(в случае отсутствия проставляется Х)',
  'Квартал (факт)',
  'Год (факт)',
  'Отклонение, дни',
  'Причина отклонения',
  'ФБ 2',
  'КБ 2',
  'МБ 2',
  'ИТОГО 2',
  'ФБ 3',
  'КБ 3',
  'МБ 3',
  'ИТОГО 3',
  'Учитывать в расчете экономии да/нет',
  'Обоснование необходимости',
  'Комментарий ГРБСа',
  'Комментарий УЭР АЕМР',
  'Комментарий УФБП АЕМР',
];

/** Схлопывание пробельных последовательностей: в шапке встречаются переносы строк. */
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Замок канона колонок dept-листа (0-based). Ловит регресс мислейбла
 * «графа программы»: индекс 3 (D) = PROGRAM_NAME, индекс 4 (E) = SUBPROGRAM.
 * Раньше метки были перепутаны (DESCRIPTION=3 / PROGRAM_NAME=4), из-за чего
 * calc-engine/recalculate читали подпрограмму вместо программы.
 */
describe('column-map canon (DEPT_COLUMNS)', () => {
  it('графа программы D=3 = PROGRAM_NAME, подпрограмма E=4 = SUBPROGRAM', () => {
    expect(DEPT_COLUMNS.PROGRAM_NAME).toBe(3);
    expect(DEPT_COLUMNS.SUBPROGRAM).toBe(4);
    expect(DEPT_COLUMNS.TYPE).toBe(5);
  });

  it('мислейбл DESCRIPTION удалён (был индекс 3)', () => {
    expect(Object.keys(DEPT_COLUMNS)).not.toContain('DESCRIPTION');
  });

  it('ключевые столбцы расчёта совпадают с каноном листа', () => {
    expect(DEPT_COLUMNS.METHOD).toBe(11);
    expect(DEPT_COLUMNS.PLAN_DATE).toBe(13);
    expect(DEPT_COLUMNS.PLAN_QUARTER).toBe(14);
    expect(DEPT_COLUMNS.PLAN_YEAR).toBe(15);
    expect(DEPT_COLUMNS.FACT_DATE).toBe(16);
  });

  it('план / факт / экономия ФБ-КБ-МБ + гейт экономии', () => {
    expect([DEPT_COLUMNS.FB_PLAN, DEPT_COLUMNS.KB_PLAN, DEPT_COLUMNS.MB_PLAN]).toEqual([7, 8, 9]);
    expect([DEPT_COLUMNS.FB_FACT, DEPT_COLUMNS.KB_FACT, DEPT_COLUMNS.MB_FACT]).toEqual([21, 22, 23]);
    expect([DEPT_COLUMNS.ECONOMY_FB, DEPT_COLUMNS.ECONOMY_KB, DEPT_COLUMNS.ECONOMY_MB]).toEqual([25, 26, 27]);
    expect(DEPT_COLUMNS.FLAG).toBe(29);
  });
});

/**
 * Страж «карта ↔ живая шапка». Каждый ключ карты обязан указывать на колонку
 * с той подписью, которую он обещает: сдвиг индекса или новый ключ без
 * подписи роняют тест.
 */
describe('column-map страж: подписи карты = шапка живого листа', () => {
  it('каждый ключ DEPT_COLUMNS указывает на свою подпись строки 3', () => {
    for (const [key, idx] of Object.entries(DEPT_COLUMNS)) {
      const promised = DEPT_HEADER_LABELS[key as keyof typeof DEPT_COLUMNS];
      expect(promised, `у ключа ${key} нет подписи в DEPT_HEADER_LABELS`).toBeDefined();
      expect(norm(SHEET_HEADER_ROW_3[idx] ?? ''), `${key} → индекс ${idx}`).toBe(norm(promised));
    }
  });

  it('комментарии и обоснование стоят там, где их видит оператор', () => {
    expect(DEPT_COLUMNS.JUSTIFICATION).toBe(30); // AE
    expect(DEPT_COLUMNS.COMMENT_GRBS).toBe(31);  // AF
    expect(DEPT_COLUMNS.COMMENT_UER).toBe(32);   // AG
    expect(DEPT_COLUMNS.COMMENT_UFBP).toBe(33);  // AH
  });

  it('колонка B — наименование управления, ключа REG_NUMBER больше нет', () => {
    expect(DEPT_COLUMNS.MANAGEMENT_NAME).toBe(1);
    expect(Object.keys(DEPT_COLUMNS)).not.toContain('REG_NUMBER');
  });

  it('причина выбора ЕП (M) и отклонение в днях (T) читаются', () => {
    expect(DEPT_COLUMNS.EP_REASON).toBe(12);
    expect(DEPT_COLUMNS.DEVIATION_DAYS).toBe(19);
  });
});

/**
 * Страж мета-фильтра: служебные строки ловятся, закупки со служебным словом
 * внутри названия — нет. Примеры взяты из живых книг ГРБС (2026-07-29).
 */
describe('isMetaRow — служебная строка, а не любое упоминание слова', () => {
  it('служебные строки ловятся', () => {
    expect(isMetaRow('Итого по разделу')).toBe(true);
    expect(isMetaRow('ВСЕГО')).toBe(true);
    expect(isMetaRow('Всего по управлению')).toBe(true);
    expect(isMetaRow('Раздел 2')).toBe(true);
    // Текст шапки листа (строка 3, колонка G) — если срез шапки промахнётся.
    expect(isMetaRow(norm(SHEET_HEADER_ROW_3[6]))).toBe(true);
  });

  it('настоящие закупки из живых книг НЕ отсеиваются', () => {
    expect(isMetaRow('Капитальный ремонт пищеблока')).toBe(false);
    expect(isMetaRow('Капитальный ремонт помещений спортзала, мастерской, мед.блока')).toBe(false);
    expect(isMetaRow('реконструкция системы вентиляции пищеблока')).toBe(false);
    expect(isMetaRow('Системные блоки')).toBe(false);
    expect(isMetaRow('Системный блок')).toBe(false);
    expect(isMetaRow('Создание (реконструкция, ремонт) мест (площадок) накопления (раздельного накопления) твердых коммунальных отходов')).toBe(false);
    expect(isMetaRow('доски разделочные')).toBe(false);
    expect(isMetaRow('Обслуживание оконных блоков')).toBe(false);
  });

  it('однокоренные слова в начале строки не считаются служебными', () => {
    expect(isMetaRow('Разделочные доски')).toBe(false);
    expect(isMetaRow('Итоговый отчёт по контракту')).toBe(false);
    expect(isMetaRow('Блок питания')).toBe(false);
  });

  it('пусто → не служебная', () => {
    expect(isMetaRow('')).toBe(false);
    expect(isMetaRow('   ')).toBe(false);
  });
});
