/**
 * Страж координатного режима (директива п.73а): проверка «это тач-устройство?»
 * обязана уметь работать с любым matchMedia — и честно падать в hover-режим,
 * когда matchMedia нет или он сломан.
 */
import { describe, expect, it } from 'vitest';
import { COARSE_POINTER_QUERY, evaluateCoarsePointer } from './coarse-pointer';

describe('COARSE_POINTER_QUERY — что именно считается координатным устройством', () => {
  it('спрашивает и про отсутствие наведения, и про грубый указатель', () => {
    expect(COARSE_POINTER_QUERY).toContain('hover: none');
    expect(COARSE_POINTER_QUERY).toContain('pointer: coarse');
  });
});

describe('evaluateCoarsePointer', () => {
  it('телефон (matchMedia отвечает «совпало») — координатный режим', () => {
    const touchMatchMedia = (query: string) => ({ matches: query === COARSE_POINTER_QUERY });
    expect(evaluateCoarsePointer(touchMatchMedia)).toBe(true);
  });

  it('настольный браузер (не совпало) — hover-режим', () => {
    expect(evaluateCoarsePointer(() => ({ matches: false }))).toBe(false);
  });

  it('matchMedia отсутствует (SSR, старый WebView) — hover-режим, не падение', () => {
    expect(evaluateCoarsePointer(undefined)).toBe(false);
    expect(evaluateCoarsePointer(null)).toBe(false);
  });

  it('matchMedia бросает исключение — hover-режим, не падение', () => {
    expect(evaluateCoarsePointer(() => { throw new Error('broken'); })).toBe(false);
  });
});
