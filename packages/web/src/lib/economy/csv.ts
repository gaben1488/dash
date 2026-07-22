// ── CSV-экспорт таблицы «Экономия по управлениям» (E11-5).
//    Формат: ';'-разделитель, BOM для Excel, строка ГРБС + вложенные строки
//    подведов (человекочитаемое имя через subordinateLabel, с отступом).

import { subordinateLabel } from '../subordinate-label';
import type { DeptEconomy } from './types';

const HEADERS = [
  'Управление', 'Лимит', 'Факт', 'Экономия', 'СВОД', '%',
  'Лимит ФБ', 'Факт ФБ', 'Эко ФБ', 'Лимит КБ', 'Факт КБ', 'Эко КБ',
  'Лимит МБ', 'Факт МБ', 'Эко МБ', '>25%', 'Конфликты', 'Подведы',
] as const;

/** Пустые ячейки бюджет-колонок в строке подведа (нет разбивки в CSV). */
const SUB_TAIL_BLANKS = Array<string>(HEADERS.length - 6).fill('');

/**
 * Содержимое CSV (с BOM). Колонка «СВОД» — официальный годовой итог без
 * фильтров (пусто, если официального значения нет); «Экономия» — с учётом
 * активных фильтров.
 */
export function buildEconomyCsv(rows: DeptEconomy[]): string {
  const lines = rows.flatMap(d => {
    const b = d.budget;
    const main = [
      d.dept, d.limit.toFixed(2), d.price.toFixed(2), d.economy.toFixed(2),
      d.economyOfficial != null ? d.economyOfficial.toFixed(2) : '',
      d.pct.toFixed(1),
      b.planFB.toFixed(2), b.factFB.toFixed(2), b.economyFB.toFixed(2),
      b.planKB.toFixed(2), b.factKB.toFixed(2), b.economyKB.toFixed(2),
      b.planMB.toFixed(2), b.factMB.toFixed(2), b.economyMB.toFixed(2),
      d.highEconomy ? 'Да' : 'Нет', String(d.conflicts), String(d.realSubCount),
    ].join(';');
    const subLines = d.subordinates.map(s =>
      [
        `  ${subordinateLabel(s.name)}`,
        s.planTotal.toFixed(2), s.factTotal.toFixed(2), s.economy.toFixed(2),
        '', s.pct.toFixed(1),
        ...SUB_TAIL_BLANKS,
      ].join(';'),
    );
    return [main, ...subLines];
  });
  const bom = '﻿';
  return bom + HEADERS.join(';') + '\n' + lines.join('\n');
}

/** economy_YYYY-MM-DD.csv. */
export function economyCsvFilename(now: Date = new Date()): string {
  return `economy_${now.toISOString().slice(0, 10)}.csv`;
}
