/**
 * Ответ по сигналу — прямо на месте.
 *
 * ТРЕБОВАНИЕ ВЛАДЕЛЬЦА ДОСЛОВНО: «по каждому сигналу виден ответ — какая
 * строка, что в ней, почему», и виден он без ухода на другую вкладку.
 *
 * ЧТО БЫЛО. Карточка сигнала несла адрес мёртвым текстом: «8. УО!D34». Это
 * половина ответа — «где», — и она бесполезна без второй половины: читатель
 * видит адрес, но не видит, ЧТО по этому адресу записано, и вынужден идти
 * искать строку руками среди трёхсот семидесяти. Карта вкладки записала это
 * прямо: «адреса сигналов — мёртвый текст, провала в строку реестра нет».
 *
 * ЧТО ТЕПЕРЬ. Адрес разбирается на лист и строку, по ним находится строка
 * реестра, и рядом с адресом печатается её суть: код процедуры, заказчик,
 * предмет, НМЦК, стадия. Строка — это и есть ответ на «какая строка и что в
 * ней»; «почему» уже несёт сам сигнал своим механизмом.
 *
 * ЧЕСТНАЯ НЕНАХОДКА — ОТДЕЛЬНОЕ СОСТОЯНИЕ, А НЕ ПУСТОТА. Не всякий адрес
 * сигнала указывает на строку реестра: сверка с книгами ГРБС адресует чужой
 * книгой («УО:412»), контроль свода — ячейкой свода, справочник — именем
 * учреждения. Такой адрес НАЗЫВАЕТСЯ как непринадлежащий реестру, а не
 * выдаётся за «строка не найдена»: это разные новости, и путать их нельзя
 * (канон п.36 о трёх родах пустоты).
 */
import type { RegistryProcedure } from './contract';

/** Разобранный адрес сигнала: лист книги и номер строки на нём. */
export interface SignalAddressRef {
  readonly sheet: string;
  readonly row: number;
  /** Буква колонки, если адрес был ячейкой («D» из «8. УО!D34»). */
  readonly column?: string;
}

/**
 * Две формы адреса живут в продукте одновременно, и обе законны:
 *   • ячейка книги — «8. УО!D34» (ядро, `cellAddress`);
 *   • строка листа — «8. УО · строка 34» (дефекты, найденные экраном:
 *     колонку они назвать не могут, строку обязаны).
 * Третья форма — чужая книга ГРБС («УО:412») — сюда не подходит и не должна:
 * строки реестра мониторинга за ней нет.
 */
const CELL_RE = /^(.+)!([A-Za-zА-Яа-я]{1,3})(\d+)$/u;
const ROW_RE = /^(.+?)\s*[·•]\s*строка\s+(\d+)$/u;

export function parseSignalAddress(address: string): SignalAddressRef | null {
  const raw = address.trim();

  const cell = CELL_RE.exec(raw);
  if (cell !== null) {
    const row = Number(cell[3]);
    if (Number.isInteger(row) && row > 0) {
      return { sheet: (cell[1] as string).trim(), row, column: cell[2] as string };
    }
  }

  const byRow = ROW_RE.exec(raw);
  if (byRow !== null) {
    const row = Number(byRow[2]);
    if (Number.isInteger(row) && row > 0) {
      return { sheet: (byRow[1] as string).trim(), row };
    }
  }

  return null;
}

/** Ключ указателя «лист + строка» — один на всю зону, чтобы не разошёлся. */
export function addressKey(sheet: string, row: number): string {
  return `${sheet.trim()}#${row}`;
}

/**
 * Указатель «лист + строка → процедура». Строится один раз на ответ сервера, а
 * не на каждый раскрытый сигнал: адресов у одного сигнала бывают десятки.
 */
export function indexByAddress(
  procedures: readonly RegistryProcedure[],
): Map<string, RegistryProcedure> {
  const map = new Map<string, RegistryProcedure>();
  for (const p of procedures) {
    const key = addressKey(p.sheet, p.row);
    if (!map.has(key)) map.set(key, p);
  }
  return map;
}

/** Почему за адресом не оказалось строки реестра — тремя разными новостями. */
export type SignalAnswerKind =
  /** Адрес разобран, строка найдена — ответ есть. */
  | 'row'
  /** Адрес не про реестр: чужая книга ГРБС, свод, справочник учреждений. */
  | 'not-registry'
  /** Адрес про лист реестра, а строки на нём нет: срез управления её отсёк
   *  либо строка ушла из книги между чтениями. */
  | 'row-missing';

export interface SignalAnswer {
  readonly kind: SignalAnswerKind;
  readonly address: string;
  readonly ref: SignalAddressRef | null;
  readonly procedure: RegistryProcedure | null;
}

/**
 * Ответ по одному адресу сигнала. Функция не решает, как это нарисовать, — она
 * решает, ЧТО известно: адрес разобран или нет, строка найдена или нет.
 */
export function answerForAddress(
  address: string,
  byAddress: ReadonlyMap<string, RegistryProcedure>,
): SignalAnswer {
  const ref = parseSignalAddress(address);
  if (ref === null) return { kind: 'not-registry', address, ref: null, procedure: null };

  const procedure = byAddress.get(addressKey(ref.sheet, ref.row)) ?? null;
  return procedure === null
    ? { kind: 'row-missing', address, ref, procedure: null }
    : { kind: 'row', address, ref, procedure };
}
