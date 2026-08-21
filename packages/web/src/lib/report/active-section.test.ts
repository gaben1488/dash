import { describe, expect, it } from 'vitest';
import { activeSectionOf } from './active-section';

const LINE = 120;

describe('активная секция навигации «Отчёта»', () => {
  it('активна та, в тело которой читатель уже вошёл, а не следующая за ней', () => {
    // УО начата (верх выше линии), УКСиМП только показался снизу.
    const active = activeSectionOf(
      [{ dept: 'УО', top: -300 }, { dept: 'УКСиМП', top: 480 }],
      LINE,
    );
    expect(active).toBe('УО');
  });

  it('из двух начатых берётся ближняя к линии — подсветка не откатывается назад', () => {
    const active = activeSectionOf(
      [{ dept: 'УО', top: -900 }, { dept: 'УКСиМП', top: -40 }, { dept: 'УЖКХ', top: 700 }],
      LINE,
    );
    expect(active).toBe('УКСиМП');
  });

  it('страница в самом верху: активна первая секция, а не пустота', () => {
    const active = activeSectionOf(
      [{ dept: 'УКСиМП', top: 900 }, { dept: 'УО', top: 300 }],
      LINE,
    );
    expect(active).toBe('УО');
  });

  it('секция ровно на линии считается начатой', () => {
    expect(activeSectionOf([{ dept: 'УО', top: LINE }, { dept: 'УЖКХ', top: 800 }], LINE)).toBe('УО');
  });

  it('секций нет — ответа нет, подсветку рисовать нечем', () => {
    expect(activeSectionOf([], LINE)).toBeNull();
  });
});
