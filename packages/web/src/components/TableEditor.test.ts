import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  columnsFingerprint,
  countRowsBelow,
  defaultColumnWidth,
  describeRowsBelow,
  formatRowAddress,
  readTablePrefs,
  rowToTsv,
  tsvCell,
  writeTablePrefs,
} from './TableEditor';

/** Хранилище браузера в узле отсутствует — подменяем его простой картой. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  return store;
}

describe('буфер обмена: значение и строка в формате TSV', () => {
  it('обычное значение уходит как есть', () => {
    expect(tsvCell('Поставка бумаги')).toBe('Поставка бумаги');
    expect(tsvCell(1250.5)).toBe('1250.5');
  });

  it('пустое значение — пустая ячейка, а не слово «null»', () => {
    expect(tsvCell(null)).toBe('');
    expect(tsvCell(undefined)).toBe('');
  });

  it('табуляция, перевод строки и кавычка внутри значения не разрывают строку', () => {
    expect(tsvCell('первая\tвторая')).toBe('"первая\tвторая"');
    expect(tsvCell('строка\nещё')).toBe('"строка\nещё"');
    expect(tsvCell('ремонт «А» и "Б"')).toBe('"ремонт «А» и ""Б"""');
  });

  it('строка целиком собирается через табуляцию', () => {
    expect(rowToTsv([1, 'Бумага', null, 'ЭА'])).toBe('1\tБумага\t\tЭА');
  });
});

describe('адрес строки книги', () => {
  it('называет лист и номер строки', () => {
    expect(formatRowAddress('Управление образования', 1481)).toBe('Управление образования · строка 1481');
  });

  it('не выдумывает адрес, если листа или номера нет', () => {
    expect(formatRowAddress('', 1481)).toBeNull();
    expect(formatRowAddress('Управление образования', null)).toBeNull();
    expect(formatRowAddress('Управление образования', 0)).toBeNull();
    expect(formatRowAddress('Управление образования', 'не число')).toBeNull();
  });
});

describe('настройки вида: сброс при смене набора колонок', () => {
  beforeEach(() => { stubStorage(); });

  it('отпечаток не зависит от порядка колонок', () => {
    expect(columnsFingerprint(['id', 'subject', 'method']))
      .toBe(columnsFingerprint(['method', 'id', 'subject']));
  });

  it('отпечаток меняется, когда колонка добавлена или убрана', () => {
    expect(columnsFingerprint(['id', 'subject']))
      .not.toBe(columnsFingerprint(['id', 'subject', 'method']));
  });

  it('записанные настройки читаются обратно при том же наборе колонок', () => {
    const fingerprint = columnsFingerprint(['id', 'subject']);
    writeTablePrefs('реестр', fingerprint, { sortKey: 'subject' });
    expect(readTablePrefs('реестр', fingerprint)).toEqual({ sortKey: 'subject' });
  });

  it('при другом наборе колонок прежние настройки забываются, а не натягиваются на новый вид', () => {
    writeTablePrefs('реестр', columnsFingerprint(['id', 'subject']), { sortKey: 'subject' });
    expect(readTablePrefs('реестр', columnsFingerprint(['id', 'subject', 'economy']))).toBeNull();
  });

  it('испорченная запись не роняет экран — возвращается вид по умолчанию', () => {
    localStorage.setItem('aemr.table.реестр.v1', 'это не json');
    expect(readTablePrefs('реестр', columnsFingerprint(['id']))).toBeNull();
  });

  it('запрет на запись в хранилище не роняет экран', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    expect(() => writeTablePrefs('реестр', 'id', { sortKey: 'id' })).not.toThrow();
  });
});

describe('ширина столбца по умолчанию', () => {
  it('берётся из класса вида w-28 (шаг Tailwind — четыре пикселя)', () => {
    expect(defaultColumnWidth({ width: 'w-28' })).toBe(112);
    expect(defaultColumnWidth({ width: 'w-14' })).toBe(56);
  });

  it('без класса текстовый столбец шире числового', () => {
    expect(defaultColumnWidth({ type: 'text' })).toBe(240);
    expect(defaultColumnWidth({ type: 'currency' })).toBe(140);
  });

  it('нераспознанный класс не превращается в NaN', () => {
    expect(defaultColumnWidth({ width: 'w-1/2', type: 'text' })).toBe(240);
  });
});

describe('индикатор прокрутки', () => {
  const tops = [0, 40, 80, 120, 160, 200];
  const topAt = (i: number) => tops[i] ?? null;

  it('считает строки, чей верх ниже видимой части', () => {
    expect(countRowsBelow(tops.length, topAt, 100)).toBe(3);
  });

  it('в начале списка ниже остаются все строки, кроме первой', () => {
    expect(countRowsBelow(tops.length, topAt, 1)).toBe(5);
  });

  it('в конце списка ниже не остаётся ничего', () => {
    expect(countRowsBelow(tops.length, topAt, 1000)).toBe(0);
  });

  it('склоняет число строк по-русски', () => {
    expect(describeRowsBelow(1)).toBe('Ниже ещё 1 строка');
    expect(describeRowsBelow(3)).toBe('Ниже ещё 3 строки');
    expect(describeRowsBelow(12)).toBe('Ниже ещё 12 строк');
  });

  it('молчит, когда ниже ничего нет: «Конец списка» под каждой таблицей был бы шумом', () => {
    expect(describeRowsBelow(0)).toBeNull();
    expect(describeRowsBelow(-1)).toBeNull();
  });
});

// isTypingTarget здесь не проверяется намеренно: она опознаёт узел разметки
// через instanceof HTMLElement, а среда прогона тестов — узел без разметки
// (jsdom в зависимостях нет). Проверка требовала бы новой зависимости.
