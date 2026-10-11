/**
 * История происхождения строк из сохранённых подтверждённых недельных срезов.
 *
 * В отличие от /api/integrity (последний контроль → текущие книги), здесь
 * каждая пара — два архивных четверговых среза. Они уже хранятся бессрочно
 * согласно retention. Это восстановимая, read-only история наблюдений:
 * отсутствие прежнего номера НЕ доказывает удаление и НЕ называет автора.
 *
 * Данные существующих снимков НЕ модифицируются. Сомнительный/потерянный
 * срез — обозначенный разрыв, а не подстановка другого снимка задним числом.
 */
import { diffSnapshots, entriesFromRowDiff, type ChangeEntry, type SnapshotRow } from '@aemr/core';
import { DAYS_PER_WEEK, findDept } from '@aemr/shared';
import { config } from '../config.js';
import { verifiedBaselineRows } from '../routes/integrity.js';
import { productCalendarDay } from './product-calendar.js';
import { getWeeklySnapshotHistory } from './snapshot.js';

export interface WeeklyLineageControl {
  id: string;
  createdAt: string;
}
export interface VerifiedLineageControl extends WeeklyLineageControl {
  rows: Map<string, SnapshotRow[]>;
  error: string | null;
}
export interface WeeklyLineagePeriod {
  fromId: string;
  toId: string;
  fromAt: string;
  toAt: string;
  status: 'checked' | 'partial' | 'unavailable';
  notes: string[];
  eventCount: number;
}
export interface WeeklyLineageEvent {
  fromId: string;
  toId: string;
  entry: ChangeEntry;
}
export interface WeeklyLineageResult {
  source: 'confirmed-weekly-snapshots';
  anchorId: string | null;
  periods: WeeklyLineagePeriod[];
  totalEvents: number;
  events: WeeklyLineageEvent[];
}

/**
 * Разделение по КАЛЕНДАРЮ ПРОДУКТА (+12), не UTC.
 * За четверг может оказаться несколько сохранений: последнее — свидетель
 * этой даты; предыдущие нельзя выдавать за соседнюю неделю.
 */
export function selectWeeklyControls(
  all: readonly WeeklyLineageControl[],
  nowMs: number,
  offsetHours: number,
): WeeklyLineageControl[] {
  const byDay = new Map<number, WeeklyLineageControl>();
  for (const item of all) {
    const at = Date.parse(item.createdAt);
    if (!Number.isFinite(at) || at > nowMs) continue;
    const day = productCalendarDay(new Date(at), offsetHours);
    if (day % DAYS_PER_WEEK !== 0) continue;
    const previous = byDay.get(day);
    if (!previous || item.createdAt > previous.createdAt) byDay.set(day, item);
  }
  return [...byDay.entries()].sort(([a], [b]) => b - a).map(([, value]) => value);
}

/** Чистая предметная проекция. При разрыве неделю НЕ перепрыгиваем. */
export function compareVerifiedWeeklyControls(
  controls: readonly VerifiedLineageControl[],
  offsetHours: number,
  selectedDept?: string,
): WeeklyLineageResult {
  const periods: WeeklyLineagePeriod[] = [];
  const events: WeeklyLineageEvent[] = [];
  for (let i = 0; i + 1 < controls.length; i += 1) {
    const newer = controls[i];
    const older = controls[i + 1];
    const dayNew = productCalendarDay(new Date(newer.createdAt), offsetHours);
    const dayOld = productCalendarDay(new Date(older.createdAt), offsetHours);
    const period: WeeklyLineagePeriod = {
      fromId: older.id, toId: newer.id,
      fromAt: older.createdAt, toAt: newer.createdAt,
      status: 'checked', notes: [], eventCount: 0,
    };

    if (dayNew - dayOld !== DAYS_PER_WEEK) {
      period.status = 'unavailable';
      period.notes.push('Между контрольными четвергами отсутствуют срезы; нельзя определять событие в пропущенную неделю.');
    }
    if (older.error || newer.error) {
      period.status = 'unavailable';
      if (older.error) period.notes.push('Начальный контроль не пригоден: ' + older.error);
      if (newer.error) period.notes.push('Конечный контроль не пригоден: ' + newer.error);
    }
    if (period.status === 'unavailable') {
      periods.push(period);
      continue;
    }

    const keys = [...new Set([...older.rows.keys(), ...newer.rows.keys()])];
    for (const key of keys) {
      const dept = findDept(key)?.id ?? key;
      if (selectedDept && selectedDept !== dept) continue;
      const diff = diffSnapshots(older.rows.get(key) ?? [], newer.rows.get(key) ?? []);
      const entries = entriesFromRowDiff(dept, diff, {
        baselineId: older.id,
        controlAt: older.createdAt,
        observedAt: newer.createdAt,
      });

      for (const entry of entries) {
        events.push({ fromId: older.id, toId: newer.id, entry });
      }
      period.eventCount += entries.length;
      const duplicateKeys = [...new Set([
        ...(diff.ambiguousKeys?.before ?? []), ...(diff.ambiguousKeys?.after ?? []),
      ])];
      if (duplicateKeys.length) {
        period.status = 'partial';
        period.notes.push(dept + ': повторяющиеся № п/п ' + duplicateKeys.join(', ') + ' — судьбу строк нельзя установить однозначно.');
      }
      if (diff.unkeyed.before || diff.unkeyed.after) {
        period.status = 'partial';
        period.notes.push(dept + ': строки без № п/п (контроль ' +
          diff.unkeyed.before + ', следующий срез ' + diff.unkeyed.after + ').');
      }
    }
    periods.push(period);
  }
  return {
    source: 'confirmed-weekly-snapshots',
    anchorId: controls[0]?.id ?? null,
    periods,
    totalEvents: events.length,
    events,
  };
}

export function getWeeklyProcurementLineage(options: {
  book?: string;
  weeks: number;
  limit: number;
  offset: number;
  anchor?: string;
  now?: number;
}): WeeklyLineageResult & {
  total: number; shown: number; nextOffset: number | null; book: string | null;
} {
  // Метаданные небольшие. Отсекаем и читаем JSON только у недель,
  // которые требуются выбранной странице; без повторного Google-запроса.
  const weekly = selectWeeklyControls(
    getWeeklySnapshotHistory(500),
    options.now ?? Date.now(),
    config.weeklySnapshot.utcOffsetHours,
  );
  const anchorIndex = options.anchor ? weekly.findIndex((r) => r.id === options.anchor) : 0;
  if (options.anchor && anchorIndex < 0) {
    throw new Error('UNKNOWN_WEEKLY_LINEAGE_ANCHOR');
  }
  const selected = weekly.slice(anchorIndex, anchorIndex + options.weeks + 1);
  const verified = selected.map((control): VerifiedLineageControl => {
    const result = verifiedBaselineRows(control);
    return { ...control, ...result };
  });
  const selection = options.book ? findDept(options.book)?.id : undefined;
  if (options.book && !selection) throw new Error('UNKNOWN_LINEAGE_DEPARTMENT');

  const timeline = compareVerifiedWeeklyControls(
    verified, config.weeklySnapshot.utcOffsetHours, selection,
  );
  const total = timeline.events.length;
  const slice = timeline.events.slice(options.offset, options.offset + options.limit);
  return {
    ...timeline,
    events: slice,
    total, shown: slice.length,
    nextOffset: options.offset + slice.length < total ? options.offset + slice.length : null,
    book: selection ?? null,
  };
}
