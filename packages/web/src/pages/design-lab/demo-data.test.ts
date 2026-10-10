import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LAB_DEMO_ROWS, LAB_DEMO_TOTAL_THOUSANDS, demoFilterRows } from './demo-data';

describe('one canonical demonstration across Dash Design Lab', () => {
  it('keeps composite sequence labels distinct and sums only the same three rows', () => {
    expect(LAB_DEMO_ROWS.map(row => row.id)).toEqual(['173/1', '173/2', '174']);
    expect(new Set(LAB_DEMO_ROWS.map(row => row.id)).size).toBe(3);
    expect(LAB_DEMO_ROWS.map(row => row.planThousands)).toEqual([4200, 7800, 1620]);
    expect(LAB_DEMO_TOTAL_THOUSANDS).toBe(13620);
    expect(LAB_DEMO_ROWS[0].sourceRow).toBe(14);
    expect(LAB_DEMO_ROWS[1].sourceRow).toBe(15);
  });

  it('filters by exact organization and untruncated label without inventing a 173 parent', () => {
    expect(demoFilterRows('', 'УО').map(row => row.id)).toEqual(['173/1', '174']);
    expect(demoFilterRows('', 'УКСиМП').map(row => row.id)).toEqual(['173/2']);
    expect(demoFilterRows('173/1', 'УКСиМП')).toEqual([]);
    expect(demoFilterRows('173', 'all').map(row => row.id)).toEqual(['173/1', '173/2']);
    expect(demoFilterRows('несуществующее', 'all')).toEqual([]);
  });

  it('has no duplicate fictitious registry arrays in the two UI renderers', () => {
    const shell = readFileSync(new URL('../DesignLab.tsx', import.meta.url), 'utf8');
    const patterns = readFileSync(new URL('./PatternGallery.tsx', import.meta.url), 'utf8');
    expect(shell).toContain("from './design-lab/demo-data'");
    expect(patterns).toContain("from './demo-data'");
    expect(shell).not.toContain('const DEMO_ROWS = [');
    expect(patterns).not.toContain("const rows = [{ seq: '173/1'");
  });
});
