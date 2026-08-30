/**
 * Стражи класса «вне периметра 44-ФЗ» (решение владельца §22 п.5 от 30.08.2026).
 *
 * Под охраной четыре обещания:
 *   1. дом признака один — словарь причин ЕП (@aemr/shared, запись
 *      `EP_LAW_223`); своих выражений и своей подписи экран не заводит;
 *   2. признак читается ОБЕИМИ графами — обоснованием (M) и примечанием
 *      ГРБС (AF): правило книги красит обе, и продукт обязан видеть обе;
 *   3. по умолчанию строки показаны ВМЕСТЕ и помечены, режим «отдельно»
 *      оставляет только их — спрятать их нельзя вовсе;
 *   4. подпись честна: пока счёты исполнения включают такие строки, она об
 *      этом говорит, а не обещает исключения, которого нет.
 */
import { describe, it, expect } from 'vitest';
import { EP_REASON_DICT } from '@aemr/shared';
import {
  OUTSIDE_44FZ_BADGE,
  OUTSIDE_44FZ_DEFAULT_MODE,
  OUTSIDE_44FZ_HINT,
  OUTSIDE_44FZ_LABEL,
  applyOutside44fzMode,
  countOutside44fz,
  isOutside44fz,
  mentionsLaw223,
  outside44fzCaption,
} from './outside-44fz';

describe('дом признака — словарь причин ЕП, а не экран', () => {
  it('подпись класса взята дословно из словаря', () => {
    expect(OUTSIDE_44FZ_LABEL).toBe(EP_REASON_DICT.EP_LAW_223.label_ru);
  });

  it('короткая подпись жетона — часть словарной, а не отдельная выдумка', () => {
    expect(OUTSIDE_44FZ_LABEL.toLowerCase()).toContain(OUTSIDE_44FZ_BADGE.toLowerCase());
  });

  it('выражения признака живут в словаре: без них класс не опознаётся', () => {
    expect(EP_REASON_DICT.EP_LAW_223.regex.length).toBeGreaterThan(0);
  });
});

describe('признак читается обеими графами книги', () => {
  it('обоснование единственного поставщика (M) с прямым указанием закона', () => {
    expect(isOutside44fz({ epReason: 'Закупка с ЕП по положению -223ФЗ' })).toBe(true);
    expect(isOutside44fz({ epReason: 'Закупка по 223-ФЗ' })).toBe(true);
  });

  it('примечание ГРБС (AF) — вторая графа правила книги', () => {
    expect(isOutside44fz({ commentGRBS: 'Проводится по положению о закупках' })).toBe(true);
  });

  it('обычная причина ЕП признака не даёт', () => {
    expect(isOutside44fz({ epReason: 'Естественная монополия, теплоснабжение' })).toBe(false);
    expect(isOutside44fz({ commentGRBS: 'хотелки' })).toBe(false);
    expect(isOutside44fz({})).toBe(false);
  });

  it('пустая и нетекстовая ячейка признака не дают', () => {
    expect(mentionsLaw223('')).toBe(false);
    expect(mentionsLaw223(null)).toBe(false);
    expect(mentionsLaw223(undefined)).toBe(false);
    expect(mentionsLaw223(223)).toBe(false);
  });

  it('признак не зависит от того, чем ещё объяснена строка', () => {
    // Причина, где раньше побеждал бы кластер несостоявшегося аукциона:
    // канонизация вернула бы его и метку периметра потеряла.
    expect(isOutside44fz({
      epReason: 'Аукцион не состоялся, закупаем по положению о закупках',
    })).toBe(true);
  });
});

const ROWS = [
  { id: 1, epReason: 'Естественная монополия' },
  { id: 2, epReason: 'Закупка по 223-ФЗ' },
  { id: 3, commentGRBS: 'по положению о закупках' },
  { id: 4, epReason: '' },
];

describe('режим показа: вместе по умолчанию, отдельно по просьбе, спрятать нельзя', () => {
  it('по умолчанию — вместе', () => {
    expect(OUTSIDE_44FZ_DEFAULT_MODE).toBe('together');
  });

  it('«вместе» не сужает перечень ни на строку', () => {
    expect(applyOutside44fzMode(ROWS, 'together')).toHaveLength(4);
  });

  it('«отдельно» оставляет только строки вне периметра', () => {
    expect(applyOutside44fzMode(ROWS, 'apart').map((r) => r.id)).toEqual([2, 3]);
  });

  it('счёт строк класса считается из самих строк', () => {
    expect(countOutside44fz(ROWS)).toBe(2);
    expect(countOutside44fz([])).toBe(0);
  });
});

describe('подпись под таблицей честна по обеим половинам', () => {
  it('говорит и число, и то, что счёты исполнения строки пока включают', () => {
    const caption = outside44fzCaption(2, 'together');
    expect(caption).toContain('2 строки');
    expect(caption).toContain('помечены');
    expect(caption).toContain('Счёты исполнения эти строки пока включают');
  });

  it('в режиме «отдельно» сказано, что в таблице только они', () => {
    expect(outside44fzCaption(7, 'apart')).toContain('только они');
    expect(outside44fzCaption(7, 'apart')).toContain('7 строк');
  });

  it('строк нет — так и сказано, без обещания исключения', () => {
    const caption = outside44fzCaption(0, 'together');
    expect(caption).toContain('нет');
    expect(caption).not.toContain('Счёты исполнения');
  });
});
