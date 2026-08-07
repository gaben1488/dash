// ── Выгрузка таблицы «Экономия по управлениям» в файл для Excel.
//    Формат: разделитель ';', BOM в начале — так русский Excel открывает файл
//    сразу колонками. Строка управления, под ней строки подведомственных
//    (человекочитаемое имя через subordinateLabel, с отступом).

import { subordinateLabel } from '../subordinate-label';
import type { DeptEconomy } from './types';

const HEADERS = [
  'Управление', 'Лимит', 'Факт', 'Экономия', 'Официальный итог СВОД', 'Доля экономии, %',
  'Лимит ФБ', 'Факт ФБ', 'Экономия ФБ',
  'Лимит КБ', 'Факт КБ', 'Экономия КБ',
  'Лимит МБ', 'Факт МБ', 'Экономия МБ',
  'Экономия свыше 25 %', 'Расхождения', 'Подведомственных организаций',
] as const;

/** Пустые ячейки бюджет-колонок в строке подведа (нет разбивки в выгрузке). */
const SUB_TAIL_BLANKS = Array<string>(HEADERS.length - 6).fill('');

/**
 * Число для русского Excel: запятая как разделитель дробной части.
 * С точкой Excel в русской локали принимает «1000.00» за текст, и суммы
 * в выгрузке перестают складываться — ради этого и живёт функция.
 */
function money(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

/** Доля в процентах; пусто, когда лимита нет и доли не существует. */
function pct(value: number | null): string {
  return value === null ? '' : value.toFixed(1).replace('.', ',');
}

/**
 * Экранирование поля по RFC 4180: имена организаций содержат кавычки и
 * точки с запятой, без экранирования такая строка разъезжается по колонкам.
 */
function cell(raw: string): string {
  return /[";\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function line(cells: string[]): string {
  return cells.map(cell).join(';');
}

/**
 * Содержимое файла (с BOM). Колонка «Официальный итог СВОД» — годовой итог
 * без фильтров (пусто, если официального значения нет); «Экономия» — с учётом
 * активных фильтров.
 */
export function buildEconomyCsv(rows: DeptEconomy[]): string {
  const lines = rows.flatMap(d => {
    const b = d.budget;
    const main = line([
      d.dept, money(d.limit), money(d.price), money(d.economy),
      d.economyOfficial != null ? money(d.economyOfficial) : '',
      pct(d.pct),
      money(b.planFB), money(b.factFB), money(b.economyFB),
      money(b.planKB), money(b.factKB), money(b.economyKB),
      money(b.planMB), money(b.factMB), money(b.economyMB),
      d.highEconomy ? 'Да' : 'Нет', String(d.conflicts), String(d.realSubCount),
    ]);
    const subLines = d.subordinates.map(s =>
      line([
        `  ${subordinateLabel(s.name)}`,
        money(s.planTotal), money(s.factTotal), money(s.economy),
        '', pct(s.pct),
        ...SUB_TAIL_BLANKS,
      ]),
    );
    return [main, ...subLines];
  });
  const bom = '﻿';
  return bom + HEADERS.join(';') + '\n' + lines.join('\n');
}

/** Имя файла на языке читателя: «Экономия_2026-08-07.csv». */
export function economyCsvFilename(now: Date = new Date()): string {
  return `Экономия_${now.toISOString().slice(0, 10)}.csv`;
}
