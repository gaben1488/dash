/**
 * directory.test.ts — справочник учреждений и его связь с реестром
 * (спека §1.4, §2.4).
 *
 * Два обещания раздела: «сокращения нет» там, где длинный текст притворяется
 * коротким, и честный список написаний заказчика, которых справочник не
 * знает, — отсортированный по частоте, чтобы отдел свёл их к одному виду.
 */
import { describe, expect, it } from 'vitest';
import {
  MONITORING_ANCESTOR_SHEETS,
  MONITORING_MISSING_FIELDS,
  parseMonitoringDirectory,
} from './directory.js';

const GRID: unknown[][] = [
  ['№ п/п', 'ГРБС', 'Наименованиеучрежения', 'Сокращеное наименование учреждения'],
  [1, 'УО', 'муниципальное бюджетное общеобразовательное учреждение «ЕСШ №1»', 'МБОУ «ЕСШ №1»'],
  // Сокращённое дословно повторяет полное — сокращения в книге нет.
  [2, 'УО', 'муниципальное бюджетное дошкольное образовательное учреждение «Детский сад № 11 «Умка»',
    'муниципальное бюджетное дошкольное образовательное учреждение «Детский сад № 11 «Умка»'],
  [3, 'УКСиМП', '', 'МБУ «Спортивная школа»'],
];


const CURRENT_GRID: unknown[][] = [
  [
    '№ п/п', 'Род', 'Управление',
    'Новый каноничный справочник полных наименований',
    'Новый каноничный справочник кратких наименований',
    'Краткое наименование по УО (legacy)',
    'Тип учреждения', 'ОПФ', 'Алиасы и варианты написания', 'Статус', 'Примечание',
    'Наименование в книгах ГРБС', 'ИНН', 'КПП', 'ОГРН', 'Код организации в ЕИС',
    'Окружной новый каноничный справочник полных наименований',
    'Окружной новый каноничный справочник кратких наименований',
  ],
  [
    1, 'Орган управления', 'Управление делами',
    'Управление делами Администрации района',
    'Управление делами Администрации района',
    'МКУ УД', 'Администратор', '', 'УД АЕМР; УД АЕМО', 'Действующий', '',
    'УД', '1', '2', '3', '4',
    'Управление делами администрации Елизовского муниципального округа — муниципальное учреждение',
    'Управление делами администрации Елизовского муниципального округа',
  ],
];

const USAGE = [
  { customer: 'МБОУ «ЕСШ №1»', customerNormalized: 'мбоу еср', dept: 'УО' },
];

describe('parseMonitoringDirectory', () => {
  it('помечает строки, где сокращение дословно повторяет полное наименование', () => {
    const directory = parseMonitoringDirectory(GRID);
    expect(directory.entries).toHaveLength(3);
    expect(directory.entries[0].shortIsFull).toBe(false);
    expect(directory.entries[1].shortIsFull).toBe(true);
    expect(directory.withoutShortName).toBe(1);
  });

  it('пустое полное наименование называется прямо, а не заполняется сокращением', () => {
    const directory = parseMonitoringDirectory(GRID);
    expect(directory.entries[2]).toMatchObject({ fullMissing: true, shortName: 'МБУ «Спортивная школа»' });
  });

  it('связь с реестром идёт по нормализованному имени и считается в обе стороны', () => {
    const directory = parseMonitoringDirectory(GRID, [
      // Так выглядит написание после нашей нормализации: без кавычек и «№».
      { customer: 'МБОУ «ЕСШ №1»', customerNormalized: 'мбоу есш 1', dept: 'УО' },
    ]);
    // Нормализация снимает кавычки и «№», поэтому написание находит пару.
    const matched = directory.entries.find((e) => e.usageCount > 0);
    expect(matched?.shortName).toBe('МБОУ «ЕСШ №1»');
    expect(directory.customersMatched).toBe(1);
    expect(directory.customersOutside).toHaveLength(0);
  });

  it('написания вне справочника приходят по убыванию частоты с управлениями', () => {
    const directory = parseMonitoringDirectory(GRID, [
      { customer: 'УД АЕМР', customerNormalized: 'уд аемр', dept: 'УД' },
      { customer: 'УД АЕМР', customerNormalized: 'уд аемр', dept: 'УД' },
      { customer: 'Совместный аукцион ШКОЛЫ', customerNormalized: 'совместный аукцион школы', dept: 'УО' },
    ]);
    expect(directory.customersOutside.map((c) => c.name)).toEqual(['УД АЕМР', 'Совместный аукцион ШКОЛЫ']);
    expect(directory.customersOutside[0]).toMatchObject({ count: 2, depts: ['УД'] });
  });


  it('читает текущий канонический справочник и предпочитает окружные имена', () => {
    const directory = parseMonitoringDirectory(CURRENT_GRID);
    expect(directory.entries).toHaveLength(1);
    expect(directory.entries[0]).toMatchObject({
      sheet: 'Справочник заказчиков',
      grbs: 'Управление делами',
      fullName: 'Управление делами администрации Елизовского муниципального округа — муниципальное учреждение',
      shortName: 'Управление делами администрации Елизовского муниципального округа',
    });
  });

  it('связывает текущий справочник по явным алиасам, legacy и имени из книг ГРБС', () => {
    const directory = parseMonitoringDirectory(CURRENT_GRID, [
      { customer: 'УД АЕМО', customerNormalized: 'уд аемо', dept: 'УД' },
      { customer: 'МКУ УД', customerNormalized: 'мку уд', dept: 'УД' },
      { customer: 'УД', customerNormalized: 'уд', dept: 'УД' },
    ]);
    expect(directory.customersMatched).toBe(3);
    expect(directory.customersOutside).toEqual([]);
    expect(directory.entries[0].usageCount).toBe(3);
  });

  it('справочник не прочитан — все написания реестра честно оказываются вне его', () => {
    const directory = parseMonitoringDirectory(undefined, USAGE);
    expect(directory.entries).toEqual([]);
    expect(directory.customersOutside).toHaveLength(1);
    expect(directory.customersMatched).toBe(0);
  });
});

describe('листы-предки', () => {
  it('несут шапку из семнадцати колонок и список полей, которых форме не хватает', () => {
    const ancestor = MONITORING_ANCESTOR_SHEETS[0];
    expect(ancestor.header).toHaveLength(17);
    expect(ancestor.header).toContain('Кол-во заявок от поставщиков');
    expect(MONITORING_MISSING_FIELDS).toContain('Статус');
    expect(MONITORING_ANCESTOR_SHEETS.map((s) => s.sheet)).toEqual([
      'Отчет по процедурам Свод', 'СВОД', 'ГРБС',
    ]);
  });
});
