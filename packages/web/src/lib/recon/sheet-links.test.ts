// Юниты lib/recon/sheet-links — deep-link ячейки СВОД производны от канона
// @aemr/shared (DEPARTMENT_ROWS), дрейф от ядра невозможен по построению.
import { DEPARTMENT_IDS, DEPARTMENT_ROWS, LATIN_TO_CYRILLIC } from '@aemr/shared';
import { describe, expect, it } from 'vitest';
import { buildSheetUrl, DEPT_SVOD_CELLS } from './sheet-links';

describe('DEPT_SVOD_CELLS', () => {
  it('покрывает все ГРБС канона под кириллическими именами', () => {
    expect(Object.keys(DEPT_SVOD_CELLS).sort()).toEqual(
      DEPARTMENT_IDS.map((id) => LATIN_TO_CYRILLIC[id]).sort(),
    );
  });

  it('ячейки выведены из строки «КП Итого год» канона (УЭР: строка 47)', () => {
    expect(DEPT_SVOD_CELLS['УЭР']).toEqual({
      planCount: 'D47',
      factCount: 'E47',
      planTotal: 'K47',
      factTotal: 'O47',
      economy: 'U47', // канонический economyKpCell, не U46 из старой хардкод-карты
      percent: 'G47',
    });
  });

  it('economy берёт канонический economyKpCell, при отсутствии — U{kpYear}', () => {
    for (const id of DEPARTMENT_IDS) {
      const cfg = DEPARTMENT_ROWS[id];
      expect(DEPT_SVOD_CELLS[LATIN_TO_CYRILLIC[id]].economy).toBe(cfg.economyKpCell ?? `U${cfg.kpYear}`);
    }
  });
});

describe('buildSheetUrl', () => {
  it('без ячейки — просто URL книги', () => {
    expect(buildSheetUrl('SHEET123')).toBe('https://docs.google.com/spreadsheets/d/SHEET123/edit');
  });

  it('с ячейкой — якорь #gid=0&range=', () => {
    expect(buildSheetUrl('SHEET123', 'U47')).toBe('https://docs.google.com/spreadsheets/d/SHEET123/edit#gid=0&range=U47');
  });
});
