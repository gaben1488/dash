/**
 * timeline-view.ts — чистая витрина таймлайна строки (без React).
 *
 * Превращает RowTimeline (@aemr/core) в список элементов показа:
 *   - технические события snapshot_observed (сам факт наблюдения, без правки)
 *     в ленту не идут — читателю важны изменения, а не расписание снимков;
 *   - «просрочка закрыта заключением» разворачивается в ДВА элемента: красное
 *     начало просрочки и зелёное снятие в день заключения (канон п.75в:
 *     просрочки — особенно);
 *   - плановая дата вставляется якорной насечкой на линию по своей дате;
 *   - подписи русские, значения ячеек форматируются по роли колонки
 *     (даты — дд.мм.гггг, деньги — с разрядами и «тыс. руб.», тексты — как есть).
 *
 * Свободный текст комментариев НЕ интерпретируется (канон п.27): правка
 * комментария показывается как правка («было → стало»), без выводов.
 */
import type { RowTimeline, TimelineEventKind, TimelineSource } from '@aemr/core';

export type DisplayKind = TimelineEventKind | 'overdue_cleared' | 'plan_anchor';

/** Тон элемента — ключ палитры RowTimeline.tsx (обе темы там же). */
export type DisplayAccent =
  | 'blue'     // плановая дата
  | 'emerald'  // заключение, снятие просрочки
  | 'amber'    // снятая дата заключения, смена способа
  | 'violet'   // деньги
  | 'zinc'     // комментарии
  | 'red'      // просрочка — акцент
  | 'sky';     // якорь плановой даты

export interface TimelineDisplayItem {
  key: string;
  /** Момент для сортировки (ISO-инстант или ISO-дата). */
  at: string;
  /** «14.08.2026» — дата события. */
  dateLabel: string;
  /** «13:45» — только у моментальных записей журнала; у датных событий null. */
  timeLabel: string | null;
  title: string;
  /** «было → стало» или пояснение; null — заголовка достаточно. */
  detail: string | null;
  /** Источник события; у якоря плановой даты источника нет. */
  source: TimelineSource | null;
  /** Адрес ячейки книги («N178»); null — не привязан к ячейке. */
  cell: string | null;
  kind: DisplayKind;
  accent: DisplayAccent;
  /** Акцентный элемент рисуется крупнее (начало просрочки). */
  emphasis: boolean;
}

/** Русская подпись колонки книги для событий сумм и комментариев. */
export const COLUMN_ROLE_RU: Readonly<Record<string, string>> = {
  H: 'план, федеральный бюджет',
  I: 'план, краевой бюджет',
  J: 'план, местный бюджет',
  K: 'план, итого',
  V: 'факт, федеральный бюджет',
  W: 'факт, краевой бюджет',
  X: 'факт, местный бюджет',
  Y: 'факт, итого',
  Z: 'экономия, федеральный бюджет',
  AA: 'экономия, краевой бюджет',
  AB: 'экономия, местный бюджет',
  AC: 'экономия, итого',
  M: 'основание выбора единственного поставщика',
  U: 'причина отклонения от срока',
  AE: 'дополнительная информация',
  AF: 'журнал исполнения',
  AG: 'номер процедуры',
  AH: 'комментарий',
};

/** ISO «2026-08-14…» → «14.08.2026»; не-ISO значение возвращается как есть. */
export function formatDateRu(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

/** Буква колонки из адреса ячейки («AG178» → «AG»). */
function letterOfCell(cell: string | undefined): string {
  const m = String(cell ?? '').match(/^([A-Z]{1,2})\d+$/i);
  return m ? m[1].toUpperCase() : '';
}

/** Значение датной ячейки: ISO → дд.мм.гггг, пусто → «пусто», прочее — как есть. */
function dateValue(v: string | undefined): string {
  const s = String(v ?? '').trim();
  return s === '' ? 'пусто' : formatDateRu(s);
}

/** Значение денежной ячейки: число с разрядами; книги ведутся в тыс. руб. (п.52). */
function sumValue(v: string | undefined): string {
  const s = String(v ?? '').trim();
  if (s === '') return 'пусто';
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

/** Текстовое значение: обрезка до 90 знаков, пустота — словом. */
function textValue(v: string | undefined): string {
  const s = String(v ?? '').trim();
  if (s === '') return 'пусто';
  return s.length > 90 ? `${s.slice(0, 89)}…` : s;
}

/** «ЧЧ:ММ» локального времени для моментальных записей журнала. */
function timeOf(at: string): string | null {
  if (!at.includes('T')) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Ключ сортировки: мс момента; чистая ISO-дата — полночь UTC. */
function msOf(at: string): number {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
}

/** Приоритет при равных моментах: якорь плановой даты — раньше событий дня. */
function tieOrder(kind: DisplayKind): number {
  return kind === 'plan_anchor' ? 0 : 1;
}

/**
 * Собирает элементы показа из таймлайна. Порядок — хронологический
 * (сверху — начало истории, снизу — самое свежее).
 */
export function buildTimelineDisplay(timeline: RowTimeline): TimelineDisplayItem[] {
  const items: TimelineDisplayItem[] = [];

  for (const [i, event] of timeline.events.entries()) {
    const base = {
      at: event.at,
      dateLabel: formatDateRu(event.at.slice(0, 10)),
      timeLabel: event.source === 'журнал' ? timeOf(event.at) : null,
      source: event.source,
      cell: event.cell ?? null,
      emphasis: false,
    };
    switch (event.kind) {
      case 'snapshot_observed':
        break; // факт наблюдения без правки — не событие для читателя
      case 'plan_date_changed': {
        const from = dateValue(event.from);
        const to = dateValue(event.to);
        items.push({
          ...base,
          key: `e${i}`,
          kind: event.kind,
          accent: 'blue',
          title: from === 'пусто' ? 'Плановая дата проставлена'
            : to === 'пусто' ? 'Плановая дата снята'
            : 'Плановая дата перенесена',
          detail: `${from} → ${to}`,
        });
        break;
      }
      case 'fact_date_set': {
        const from = dateValue(event.from);
        const to = dateValue(event.to);
        const removed = to === 'пусто';
        items.push({
          ...base,
          key: `e${i}`,
          kind: event.kind,
          accent: removed ? 'amber' : 'emerald',
          title: from === 'пусто' ? 'Появилось заключение контракта'
            : removed ? 'Дата заключения снята'
            : 'Дата заключения изменена',
          detail: `${from} → ${to}`,
        });
        break;
      }
      case 'sum_changed': {
        const role = COLUMN_ROLE_RU[letterOfCell(event.cell)] ?? 'сумма';
        items.push({
          ...base,
          key: `e${i}`,
          kind: event.kind,
          accent: 'violet',
          title: `Изменена сумма: ${role}`,
          detail: `${sumValue(event.from)} → ${sumValue(event.to)} тыс. руб.`,
        });
        break;
      }
      case 'method_changed':
        items.push({
          ...base,
          key: `e${i}`,
          kind: event.kind,
          accent: 'amber',
          title: 'Изменён способ определения поставщика',
          detail: `${textValue(event.from)} → ${textValue(event.to)}`,
        });
        break;
      case 'comment_changed': {
        const role = COLUMN_ROLE_RU[letterOfCell(event.cell)] ?? 'комментарий';
        items.push({
          ...base,
          key: `e${i}`,
          kind: event.kind,
          accent: 'zinc',
          title: `Правка текста: ${role}`,
          detail: `${textValue(event.from)} → ${textValue(event.to)}`,
        });
        break;
      }
      case 'overdue_started': {
        items.push({
          ...base,
          key: `e${i}`,
          kind: event.kind,
          accent: 'red',
          emphasis: true,
          title: 'Началась просрочка',
          detail: event.from
            ? `плановая дата ${formatDateRu(event.from)} прошла, заключения не было`
            : 'плановая дата прошла, заключения не было',
        });
        // Заключение позже плана: просрочка закрылась в день заключения.
        if (event.to) {
          items.push({
            at: event.to,
            dateLabel: formatDateRu(event.to),
            timeLabel: null,
            source: event.source,
            cell: null,
            emphasis: false,
            key: `e${i}-cleared`,
            kind: 'overdue_cleared',
            accent: 'emerald',
            title: 'Просрочка снята заключением',
            detail: `контракт заключён ${formatDateRu(event.to)}`,
          });
        }
        break;
      }
    }
  }

  // Якорная насечка плановой даты — точка «куда всё шло» на той же линии.
  if (timeline.plannedDate) {
    items.push({
      key: 'plan-anchor',
      at: timeline.plannedDate,
      dateLabel: formatDateRu(timeline.plannedDate),
      timeLabel: null,
      source: null,
      cell: null,
      kind: 'plan_anchor',
      accent: 'sky',
      title: 'Плановая дата заключения',
      detail: null,
      emphasis: false,
    });
  }

  items.sort((a, b) =>
    msOf(a.at) - msOf(b.at)
    || tieOrder(a.kind) - tieOrder(b.kind)
    || a.key.localeCompare(b.key),
  );
  return items;
}

/** Дней до/после плановой даты — русской фразой («через 3 дня», «просрочено 12 дней»). */
export function daysPhrase(daysToPlan: number): string {
  const n = Math.abs(daysToPlan);
  const word = (x: number): string => {
    const m10 = x % 10;
    const m100 = x % 100;
    if (m10 === 1 && m100 !== 11) return 'день';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
    return 'дней';
  };
  if (daysToPlan < 0) return `просрочено ${n} ${word(n)}`;
  if (daysToPlan === 0) return 'плановая дата сегодня';
  return `через ${n} ${word(n)}`;
}
