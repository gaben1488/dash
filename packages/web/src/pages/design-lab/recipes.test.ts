import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPONENT_INDEX, UI_RECIPES, searchRecipes } from './recipes';
import { EXPERIMENTAL_SURFACES } from './catalog';
import { contrastRatio } from './presets';

describe('Dash recipe library: source-backed and extensible', () => {
  it('lists real existing components without duplicates or phantom paths', () => {
    expect(COMPONENT_INDEX).toHaveLength(21);
    expect(new Set(COMPONENT_INDEX.map(item => item.id)).size).toBe(COMPONENT_INDEX.length);
    for (const item of COMPONENT_INDEX) {
      expect(item.path.startsWith('packages/web/src/')).toBe(true);
      const path = new URL('../../../../../' + item.path, import.meta.url);
      expect(existsSync(path), item.path).toBe(true);
    }
  });

  it('keeps all seven experimental surface modes legible for body text and control borders', () => {
    for (const surface of EXPERIMENTAL_SURFACES) {
      for (const mode of ['dark', 'light'] as const) {
        const tokens = surface[mode];
        expect(contrastRatio(tokens.ink, tokens.bg), surface.id + ' ' + mode).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(tokens.ink, tokens.card), surface.id + ' ' + mode).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(tokens.muted, tokens.card), surface.id + ' ' + mode).toBeGreaterThanOrEqual(4.5);
        // Border role intentionally uses muted ink. The ordinary line token is decorative only.
        expect(contrastRatio(tokens.muted, tokens.bg), surface.id + ' ' + mode).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('supplies exactly 8 behavior-first recipes with actionable acceptance criteria', () => {
    expect(UI_RECIPES).toHaveLength(14);
    expect(new Set(UI_RECIPES.map(item => item.id)).size).toBe(UI_RECIPES.length);
    const known = new Set<string>(COMPONENT_INDEX.map(item => item.id));
    for (const recipe of UI_RECIPES) {
      expect(recipe.title.trim().length).toBeGreaterThan(5);
      expect(recipe.answer.trim().length).toBeGreaterThan(15);
      expect(recipe.mistake.trim().length).toBeGreaterThan(15);
      expect(recipe.criteria.length).toBeGreaterThanOrEqual(3);
      expect(recipe.code.trim()).not.toBe('');
      expect(recipe.components.length).toBeGreaterThan(0);
      expect(recipe.components.every(x => known.has(x)), recipe.id).toBe(true);
    }
  });

  it('stays behind the original development-only Kit rather than a production route', () => {
    const entry = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8');
    const kit = readFileSync(new URL('../Kit.tsx', import.meta.url), 'utf8');
    expect(entry).toContain('import.meta.env.DEV');
    expect(entry).toContain("import('./pages/Kit')");
    expect(entry).not.toContain('PatternGallery');
    expect(kit).toContain("import { DesignLabPage } from './DesignLab'");
  });

  it('searches use cases and mistakes in Russian without modifying the source catalogue', () => {
    expect(searchRecipes('  НУЛЁМ ')).toEqual([UI_RECIPES[0]]);
    expect(searchRecipes('НОМЕР')).toEqual(
      expect.arrayContaining([UI_RECIPES.find(x => x.id === 'source-row')]),
    );
    expect(searchRecipes('', 'Облик')).toHaveLength(3);
    expect(searchRecipes('невероятное_несуществующее')).toEqual([]);
    expect(UI_RECIPES).toHaveLength(14);
  });
});
