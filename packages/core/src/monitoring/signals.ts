/**
 * signals.ts — сигналы вкладки мониторинга (спека §5; канон п.53, п.104).
 *
 * Каждый сигнал — карточка диагноста из трёх обязательных частей: МЕХАНИЗМ
 * (почему так вышло), АДРЕС (лист, строка, ячейка — иначе карточка
 * бесполезна) и ДЕЙСТВИЕ (что сделать). Тон — объяснение, не упрёк:
 * «экономия внесена вручную — формула на этой строке разорвана» вместо
 * «ошибка заполнения».
 *
 * Пространство имён у сигналов своё (`monitoring_*`): они не смешиваются с
 * сигналами книг ГРБС, потому что чинятся в другой книге и другими руками.
 *
 * Продукт НИЧЕГО не чинит молча. Искажённый код, сумма текстом, невозможная
 * дата — всё остаётся в реестре как есть, а наружу выходит адрес и
 * предложение. Правка — в книге, руками владельца (§7).
 */

import type { MonitoringDirectory } from './directory.js';
import type { MonitoringJournal } from './journal.js';
import type { MonitoringDefectKind, MonitoringProcedure } from './procedures.js';
import type { MonitoringSvod } from './svod.js';
import type { MonitoringMatchResult } from '../pipeline/monitoring-match.js';
import { SVOD_CONTROL_ADDRESS } from './svod.js';

/** Классы сигналов мониторинга — закрытый словарь. */
export type MonitoringSignalKind =
  | 'monitoring_text_number'
  | 'monitoring_blank_space'
  | 'monitoring_broken_code'
  | 'monitoring_manual_savings'
  | 'monitoring_control_error'
  | 'monitoring_svod_gap'
  | 'monitoring_broken_date'
  | 'monitoring_negative_duration'
  | 'monitoring_missing_stage'
  | 'monitoring_false_calm'
  | 'monitoring_customer_unknown'
  | 'monitoring_no_successor'
  | 'monitoring_map_book_only'
  | 'monitoring_map_no_book_row'
  | 'monitoring_map_duplicate_in_book'
  | 'monitoring_map_nmck_mismatch'
  | 'monitoring_map_fact_mismatch';

/** Критичность: очередь чтения, а не оценка человека. */
export type MonitoringSignalSeverity = 'high' | 'medium' | 'low';

export interface MonitoringSignalAddress {
  /** «5. УДТХиРКИ!D34» либо «УО:412» для строки книги ГРБС. */
  readonly address: string;
  /** Что именно увидено по этому адресу. */
  readonly note: string;
}

export interface MonitoringSignal {
  readonly kind: MonitoringSignalKind;
  readonly title: string;
  readonly severity: MonitoringSignalSeverity;
  /** Почему так вышло — механизм, а не диагноз человеку. */
  readonly mechanism: string;
  /** Что сделать. */
  readonly action: string;
  /** Сколько всего адресов у сигнала (может быть больше, чем показано). */
  readonly count: number;
  /** Адреса; список обрезан лимитом, count держит полное число. */
  readonly addresses: readonly MonitoringSignalAddress[];
}

/** Сколько адресов кладём в ответ на один сигнал: список сворачиваемый. */
const DEFAULT_ADDRESS_LIMIT = 40;

interface SignalTemplate {
  readonly kind: MonitoringSignalKind;
  readonly title: string;
  readonly severity: MonitoringSignalSeverity;
  readonly mechanism: string;
  readonly action: string;
}

/** Дефект строки → сигнал: одно место, где живут формулировки карточек. */
const DEFECT_SIGNALS: ReadonlyArray<{ defect: MonitoringDefectKind; template: SignalTemplate }> = [
  {
    defect: 'text-number',
    template: {
      kind: 'monitoring_text_number',
      title: 'Сумма записана текстом',
      severity: 'high',
      mechanism: 'Значение вставлено из документа или с площадки вместе с неразрывным пробелом либо точкой вместо запятой. На экране это выглядит числом, но формула СУММ такую ячейку не складывает, поэтому свод книги занижен.',
      action: 'Перезаписать число заново. После правки итог свода вырастет — получателей отчёта стоит предупредить заранее.',
    },
  },
  {
    defect: 'blank-space',
    template: {
      kind: 'monitoring_blank_space',
      title: 'Пробел вместо числа',
      severity: 'medium',
      mechanism: 'Ячейка выглядит пустой, но хранит пробел. Попадая в разбивку экономии по бюджетам, она заставляет контроль книги сравнивать не то, что видно на экране.',
      action: 'Очистить ячейку либо поставить ноль.',
    },
  },
  {
    defect: 'broken-code',
    template: {
      kind: 'monitoring_broken_code',
      title: 'Код процедуры не читается',
      severity: 'high',
      mechanism: 'Код набирается руками в начале текста предмета, и опечатка рвёт связь с книгами ГРБС: потерянная буква, лишний дефис, год из трёх цифр, перепутанный префикс. Строка остаётся в реестре, но пару в плане ей найти нечем.',
      action: 'Поправить написание кода в книге; продукт искажение не чинит молча.',
    },
  },
  {
    defect: 'manual-savings',
    template: {
      kind: 'monitoring_manual_savings',
      title: 'Экономия внесена вручную',
      severity: 'medium',
      mechanism: 'Формула книги считает ОКРУГЛ(начальная цена − цена аукциона; 3) даже тогда, когда торги ещё не прошли, поэтому число забивают руками. Связь с исходными ячейками при этом рвётся: при изменении начальной цены экономия не пересчитается.',
      action: 'Читать такие строки как «внесено вручную». По книге предложение отдельное — формула, которая молчит при незаполненной цене.',
    },
  },
  {
    defect: 'control-error',
    template: {
      kind: 'monitoring_control_error',
      title: 'Контроль книги показывает «ошибка»',
      severity: 'high',
      mechanism: 'Собственный контроль книги сравнивает экономию ВСЕГО с суммой МБ+КБ+ФБ. Расхождение означает, что сэкономленные деньги не разнесены по источникам финансирования.',
      action: 'Заполнить разбивку: эти данные знает исполнитель, машинно они не восстанавливаются. Это единственный сигнал, который книга поднимает сама.',
    },
  },
  {
    defect: 'broken-date',
    template: {
      kind: 'monitoring_broken_date',
      title: 'Дата записана так, что датой не читается',
      severity: 'medium',
      mechanism: 'Опечатка в наборе («23.062026», «03.06.25026») превращает дату в текст. Строка молча выпадает из сортировки, из отбора по периоду и из расчёта сроков — и нигде об этом не сообщает.',
      action: 'Перезаписать значение датой.',
    },
  },
  {
    defect: 'negative-duration',
    template: {
      kind: 'monitoring_negative_duration',
      title: 'Этап длится отрицательное число дней',
      severity: 'medium',
      mechanism: 'Торги стоят раньше публикации либо подача заявок раньше объявления. Чаще всего это ошибка в годе или в порядке цифр одной из дат.',
      action: 'Сверить пару дат на строке и поправить ту, что набрана неверно.',
    },
  },
  {
    defect: 'missing-stage',
    template: {
      kind: 'monitoring_missing_stage',
      title: 'Этап пути пропущен',
      severity: 'low',
      mechanism: 'У процедуры есть дата торгов, но нет даты публикации либо окончания подачи заявок: путь неполон, и срок этапа посчитать не из чего.',
      action: 'Дозаполнить пропущенную дату.',
    },
  },
  {
    defect: 'false-calm',
    template: {
      kind: 'monitoring_false_calm',
      title: 'Незавершённая строка выглядит проверенной',
      severity: 'medium',
      mechanism: 'Цена и экономия пусты, поэтому контроль книги сравнивает ноль с нулём и показывает зелёное «верно». Строка, у которой нет итога, выглядит так же, как строка, у которой всё сошлось.',
      action: 'Заполнить цену аукциона либо пометить строку незавершённой.',
    },
  },
];

/**
 * Собрать сигналы вкладки.
 *
 * Порядок сигналов в ответе — по критичности, внутри критичности — по числу
 * адресов: читатель начинает с того, что весит больше всего.
 */
export function buildMonitoringSignals(input: {
  readonly procedures: readonly MonitoringProcedure[];
  readonly journal?: MonitoringJournal;
  readonly directory?: MonitoringDirectory;
  readonly svod?: MonitoringSvod;
  readonly match?: MonitoringMatchResult;
  readonly addressLimit?: number;
}): MonitoringSignal[] {
  const limit = input.addressLimit ?? DEFAULT_ADDRESS_LIMIT;
  const signals: MonitoringSignal[] = [];

  // 1–9. Сигналы из дефектов строк реестра.
  const byDefect = new Map<MonitoringDefectKind, MonitoringSignalAddress[]>();
  for (const p of input.procedures) {
    for (const defect of p.defects) {
      const bucket = byDefect.get(defect.kind);
      const entry = { address: defect.address, note: defect.note };
      if (bucket === undefined) byDefect.set(defect.kind, [entry]);
      else bucket.push(entry);
    }
  }
  for (const { defect, template } of DEFECT_SIGNALS) {
    const addresses = byDefect.get(defect);
    if (addresses === undefined || addresses.length === 0) continue;
    signals.push({ ...template, count: addresses.length, addresses: addresses.slice(0, limit) });
  }

  // 10. Разрыв на своде: контроля там нет вовсе, поэтому он невидим.
  if (input.svod?.total != null) {
    const gap = input.svod.total.controlGapRub;
    if (gap !== null && Math.abs(gap) >= 0.005) {
      signals.push({
        kind: 'monitoring_svod_gap',
        title: 'Экономия свода не сходится с разбивкой по бюджетам',
        severity: 'high',
        mechanism: 'На листе управления контрольная колонка есть, а на своде её нет вовсе, поэтому разрыв между итогом экономии и суммой МБ+КБ+ФБ ничем не показан и накапливается незаметно.',
        action: 'Добавить контрольную колонку на свод книги. На вкладке она уже стоит.',
        count: 1,
        addresses: [{
          address: SVOD_CONTROL_ADDRESS,
          note: `Итог экономии и сумма долей расходятся на ${gap.toFixed(2)} руб.`,
        }],
      });
    }
  }

  // 11. Заказчик не найден в справочнике.
  const outside = input.directory?.customersOutside ?? [];
  if (outside.length > 0) {
    signals.push({
      kind: 'monitoring_customer_unknown',
      title: 'Написание заказчика не найдено в справочнике',
      severity: 'low',
      mechanism: 'Колонка заказчика — свободный текст, проверки ввода в книге нет. Одно и то же учреждение записывается по-разному, а часть написаний вообще не учреждения («Совместный аукцион ШКОЛЫ» — это признак совместной закупки).',
      action: 'Свести написания к одному виду по этому списку — после этого станет возможен разрез по заказчику.',
      count: outside.length,
      addresses: outside.slice(0, limit).map((c) => ({
        address: c.name,
        note: `${c.count} строк, управления: ${c.depts.join(', ')}.`,
      })),
    });
  }

  // 12. Процедура сорвалась, преемница не найдена.
  if (input.journal !== undefined) {
    const withSuccessor = new Set(input.journal.edges.map((e) => e.from));
    const orphans: MonitoringSignalAddress[] = [];
    for (const p of input.procedures) {
      if (p.stage !== 'no_result' || p.code === null) continue;
      if (withSuccessor.has(p.code)) continue;
      orphans.push({
        address: `${p.sheet}!A${p.row}`,
        note: `${p.code}: торги не состоялись, ссылки на новую процедуру в переходящем реестре нет.`,
      });
    }
    if (orphans.length > 0) {
      signals.push({
        kind: 'monitoring_no_successor',
        title: 'Процедура сорвалась, преемница не найдена',
        severity: 'medium',
        mechanism: 'Торги прошли без результата, но в колонке судьбы переходящего реестра нет ссылки на новую закупку: чем кончилась история, из книги не видно.',
        action: 'Посмотреть, объявлена ли процедура заново, и проставить связь в переходящем реестре.',
        count: orphans.length,
        addresses: orphans.slice(0, limit),
      });
    }
  }

  // 13–17. Сигналы маппинга с книгами ГРБС (§4.5).
  if (input.match !== undefined) {
    signals.push(...mappingSignals(input.match, limit));
  }

  const severityOrder: Record<MonitoringSignalSeverity, number> = { high: 0, medium: 1, low: 2 };
  return signals.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.count - a.count,
  );
}

/** Пять сигналов, рождающихся прямо из построчной сверки с книгами ГРБС. */
export function mappingSignals(
  result: MonitoringMatchResult,
  limit = DEFAULT_ADDRESS_LIMIT,
): MonitoringSignal[] {
  const out: MonitoringSignal[] = [];

  if (result.bookOnly.length > 0) {
    out.push({
      kind: 'monitoring_map_book_only',
      title: 'Код есть в книге управления, а процедуры в мониторинге нет',
      severity: 'medium',
      mechanism: 'В плановой книге номер процедуры проставлен, но реестр мониторинга такой процедуры не знает: либо она не заведена в книгу мониторинга, либо код искажён с одной из сторон.',
      action: 'Сверить написание кода в обеих книгах и завести недостающую строку.',
      count: result.bookOnly.length,
      addresses: result.bookOnly.slice(0, limit).map((b) => ({
        address: b.bookRow.rowKey,
        note: `${b.code}: строка плана есть, процедуры в мониторинге нет.`,
      })),
    });
  }

  if (result.monitoringOnly.length > 0) {
    out.push({
      kind: 'monitoring_map_no_book_row',
      title: 'Процедура есть, строки плана нет',
      severity: 'medium',
      mechanism: 'Процедура ведётся в мониторинге, но ни одна строка книг ГРБС на её код не ссылается: закупка идёт вне плана либо номер процедуры в плановой книге не проставлен.',
      action: 'Проставить номер процедуры в книге управления либо объяснить внеплановую закупку.',
      count: result.monitoringOnly.length,
      addresses: result.monitoringOnly.slice(0, limit).map((m) => ({
        address: m.procedures.map((p) => p.procKey).join(', '),
        note: `${m.code}: строки плана под этот код не нашлось.`,
      })),
    });
  }

  const sameBook = result.ambiguous.filter((a) => a.sameBook);
  if (sameBook.length > 0) {
    out.push({
      kind: 'monitoring_map_duplicate_in_book',
      title: 'Один код процедуры дважды в одной книге',
      severity: 'high',
      mechanism: 'Две строки одной плановой книги претендуют на одну процедуру. У совместной закупки код штатно стоит в нескольких книгах — по одной на управление, — но повтор внутри книги означает копию строки либо ошибку в номере.',
      action: 'Сверить обе строки: суммы по такой процедуре сверить не с чем, пока связь не станет однозначной.',
      count: sameBook.length,
      addresses: sameBook.slice(0, limit).map((a) => ({
        address: a.bookRows.map((r) => r.rowKey).join(', '),
        note: `${a.code}: ${a.bookRows.length} строки в книгах, из них минимум две в одной.`,
      })),
    });
  }

  const nmckMismatch = result.matched.filter((m) => m.nmck.agrees === false);
  if (nmckMismatch.length > 0) {
    out.push({
      kind: 'monitoring_map_nmck_mismatch',
      title: 'Плановая сумма книги и начальная цена расходятся',
      severity: 'medium',
      mechanism: 'Плановая колонка книги ГРБС и начальная цена процедуры — не одно и то же число по замыслу: где-то в план пишут начальную цену из заявки, где-то — лимит бюджетных обязательств, а где-то из плана задним числом вычитают изъятую экономию. Расхождение показывает, какая практика на этой строке.',
      action: 'Сверить строку плана и процедуру: расхождение здесь чаще про семантику плановой колонки, чем про ошибку.',
      count: nmckMismatch.length,
      addresses: nmckMismatch.slice(0, limit).map((m) => ({
        address: `${m.bookRow.rowKey} ↔ ${m.primary.procKey}`,
        note: `${m.code}: план ${(m.nmck.bookRub ?? 0).toFixed(2)} руб., начальная цена ${(m.nmck.monitoringRub ?? 0).toFixed(2)} руб.`,
      })),
    });
  }

  const factMismatch = result.matched.filter((m) => m.fact.agrees === false);
  if (factMismatch.length > 0) {
    out.push({
      kind: 'monitoring_map_fact_mismatch',
      title: 'Факт книги и цена победителя расходятся',
      severity: 'medium',
      mechanism: 'Фактическая сумма в книге управления и цена аукциона в мониторинге должны сойтись после заключения договора. Расхождение означает либо незавершённый контракт, либо ошибку в одной из книг.',
      action: 'Посмотреть, заключён ли договор, и сверить сумму с той, что стоит в книге управления.',
      count: factMismatch.length,
      addresses: factMismatch.slice(0, limit).map((m) => ({
        address: `${m.bookRow.rowKey} ↔ ${m.primary.procKey}`,
        note: `${m.code}: факт книги ${(m.fact.bookRub ?? 0).toFixed(2)} руб., цена победителя ${(m.fact.monitoringRub ?? 0).toFixed(2)} руб.`,
      })),
    });
  }

  return out;
}
