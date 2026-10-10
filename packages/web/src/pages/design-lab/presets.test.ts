import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FINISHES, ORIGINAL_FAMILIES, EXPERIMENTAL_SURFACES, LAYOUTS } from './catalog';
import {
  DEFAULT_PRESET, LAB_STORAGE_KEY, buildScopedCSS, contrastRatio,
  evaluateContrast, exportPresetPack, parsePresetJSON, parsePresetPackJSON,
  readStoredPresets, upsertPreset, writeStoredPresets,
} from './presets';

describe('Dash design lab — no silent source drift', () => {
  it('keeps all 39 original color pairs, section names and motifs byte-for-byte', () => {
    const source = readFileSync(
      new URL('../../../../../docs/superpowers/mockups/zarya-vystavka.html', import.meta.url), 'utf8',
    );
    const start = source.indexOf('var СЕМЕЙСТВА = [');
    const end = source.indexOf("var дом = document.getElementById('семейства-дом')", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const pairs = [...source.slice(start, end).matchAll(
      /\['([^']+)','([^']+)','(#[0-9a-f]{6})','(#[0-9a-f]{6})','(#[0-9a-f]{6})','([^']+)','([^']+)'\]/g,
    )].map((match) => ({
      name: match[1], motif: match[2], top: match[3], bottom: match[4], ink: match[5],
    }));
    expect(pairs).toHaveLength(39);
    expect(ORIGINAL_FAMILIES.map((family) => family.sections.length)).toEqual([13, 13, 13]);
    expect([...ORIGINAL_FAMILIES[0].sections, ...ORIGINAL_FAMILIES[1].sections, ...ORIGINAL_FAMILIES[2].sections]).toEqual(pairs);
  });

  it('has 7 expressly experimental surfaces, 6 source finishes and 3 layouts', () => {
    expect(EXPERIMENTAL_SURFACES).toHaveLength(7);
    expect(FINISHES).toHaveLength(6);
    expect(LAYOUTS).toHaveLength(3);
  });

  it('all original gradient endpoints clear 4.5:1 for their specified text colors', () => {
    for (const family of ORIGINAL_FAMILIES) {
      for (const section of family.sections) {
        expect(contrastRatio(section.ink, section.top)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(section.ink, section.bottom)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(evaluateContrast(DEFAULT_PRESET).passes).toBe(true);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 8);
  });
});

describe('Dash design lab — safe preset round trip', () => {
  it('imports a single valid preset and a multi-preset pack', () => {
    expect(parsePresetJSON(JSON.stringify(DEFAULT_PRESET))).toEqual(DEFAULT_PRESET);
    const other = { ...DEFAULT_PRESET, name: 'Океан', surface: 'ocean' as const };
    expect(parsePresetPackJSON(exportPresetPack([DEFAULT_PRESET, other]))).toEqual([DEFAULT_PRESET, other]);
  });

  it('rejects arrays instead of strings, unknown keys and unsupported versions', () => {
    for (const mutation of [
      { density: [] }, { density: 1 }, { version: 2 }, { layout: 'invalid' },
      { family: 'generic-space' }, { surface: 'evil' }, { section: '<script>' },
      { motion: 'false' }, { name: '\u0000bad' }, { constructor: 'injected' },
    ]) {
      expect(() => parsePresetJSON(JSON.stringify({ ...DEFAULT_PRESET, ...mutation }))).toThrow();
    }
    expect(() => parsePresetPackJSON(JSON.stringify({ format: 'dash-design-lab', version: 1, presets: Array(25).fill(DEFAULT_PRESET) }))).toThrow();
    expect(() => parsePresetPackJSON('[' + JSON.stringify(DEFAULT_PRESET) + ']')).toThrow();
  });

  it('stores only recipes; recovers from forbidden or corrupted storage', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    };
    writeStoredPresets(storage, [DEFAULT_PRESET]);
    expect(readStoredPresets(storage)).toEqual([DEFAULT_PRESET]);
    memory.set(LAB_STORAGE_KEY, '{bad json');
    expect(readStoredPresets(storage)).toEqual([]);
    expect(readStoredPresets({ getItem: () => { throw Error('disabled'); } })).toEqual([]);
  });

  it('updates a named recipe and refuses silent eviction of the 25th', () => {
    const updated = { ...DEFAULT_PRESET, layout: 'inspection' as const };
    expect(upsertPreset([DEFAULT_PRESET], updated)).toEqual([updated]);
    const full = Array.from({ length: 24 }, (_, i) => ({ ...DEFAULT_PRESET, name: 'Preset ' + i }));
    expect(() => upsertPreset(full, { ...DEFAULT_PRESET, name: 'Next' })).toThrow(/24/);
  });

  it('exports CSS only under the demo scope and without interpolating input as code', () => {
    const css = buildScopedCSS(DEFAULT_PRESET);
    expect(css).toContain('.dash-design-preview {');
    expect(css).toContain('--dl-top: #4a6da6');
    expect(css).not.toContain(':root {');
    expect(css).not.toContain('body {');
    expect(() => buildScopedCSS({ ...DEFAULT_PRESET, name: 'x', section: 'fake' as never })).toThrow();
  });
});
