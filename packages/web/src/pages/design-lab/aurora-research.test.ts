import { describe, it, expect } from 'vitest';
import { FINISHES, ORIGINAL_FAMILIES } from './catalog';
import { auroraColors, familyMatrix, auroraMatrix, AURORA_VARIANTS, AURORA_STATES } from './aurora-research';

describe('Azure × cream: audited history, not generic color replacement', () => {
  it('reproduces the historical inaccessible white-on-blue failure instead of concealing it', () => {
    const old = auroraColors('historical', 'cosmos', 'Пульс');
    expect(old.top).toBe('#5b99f8');
    expect(old.bottom).toBe('#8f7549');
    expect(old.ink).toBe('#ffffff');
    expect(old.contrastPass).toBe(false);
    expect(old.topContrast).toBeLessThan(4.5);
  });

  it('restores contrasting ice/cream variants without forcing a universal bronze horizon', () => {
    for (const id of ['recovered', 'twilight', 'cream', 'family'] as const) {
      for (const family of ORIGINAL_FAMILIES) {
        for (const section of family.sections) {
          const pair = auroraColors(id, family.id, section.name);
          expect(pair.contrastPass, id + ':' + family.id + ':' + section.name).toBe(true);
          expect(pair.topContrast).toBeGreaterThanOrEqual(4.5);
          expect(pair.bottomContrast).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    expect(auroraColors('family', 'cosmos', 'Пульс').bottom).not.toBe(
      auroraColors('family', 'kamchatka', 'Пульс').bottom,
    );
  });

  it('keeps 39 exact family combinations and tracks all finish and visual-state pairings', () => {
    expect(AURORA_VARIANTS).toHaveLength(5);
    expect(familyMatrix()).toHaveLength(39);
    expect(FINISHES).toHaveLength(6);
    expect(AURORA_STATES).toHaveLength(7);
    const matrix = auroraMatrix();
    expect(matrix).toHaveLength(39 * 6 * 7);
    expect(new Set(matrix.map(cell => cell.key)).size).toBe(matrix.length);
    for (const cell of matrix) {
      expect(cell.activeColorContrastPass).toBe(true);
      expect(cell.surfacePixelVerified).toBe(false);
      expect(cell.contrast).toBeGreaterThanOrEqual(4.5);
    }
  });
});
