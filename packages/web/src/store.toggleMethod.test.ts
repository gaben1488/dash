import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';

/**
 * P0-9 (BUG_BLOCKER_REGISTER 2026-07-09): «toggleMethod clears при size>=2 —
 * несимметрия КП/ЕП». Характеризация фактического поведения store.ts:340–348.
 *
 * Вердикт: НЕ баг. Инвариант «двойной toggle того же способа = исходное»
 * выполняется. Сброс при size>=2 — каноникализация: {КП, ЕП} ≡ «все» ≡ пустой
 * Set, что согласовано с потребителем (useFilteredData: пустой selectedMethods
 * = показывать оба, wantKP/wantEP). Состояние {оба выбраны} непредставимо
 * намеренно — теряется только нерелевантная история кликов, не семантика.
 */
describe('toggleMethod — симметрия и маппинг (P0-9)', () => {
  const state = () => useStore.getState();
  const methods = () => [...state().selectedMethods].sort();

  beforeEach(() => {
    state().clearMethods();
  });

  it('двойной toggle того же способа из пустого = пустое (identity)', () => {
    state().toggleMethod('competitive');
    state().toggleMethod('competitive');
    expect(methods()).toEqual([]);
    expect(state().procurementFilter).toBe('all');
  });

  it('двойной toggle того же способа из выбранного = исходное (инволюция)', () => {
    state().toggleMethod('competitive'); // {КП}
    state().toggleMethod('competitive'); // {}
    state().toggleMethod('competitive'); // {КП} — вернулись
    expect(methods()).toEqual(['competitive']);
    expect(state().procurementFilter).toBe('competitive');
  });

  it('маппинг legacy procurementFilter: КП → competitive, ЕП → single', () => {
    state().toggleMethod('competitive');
    expect(state().procurementFilter).toBe('competitive');
    state().clearMethods();
    state().toggleMethod('single');
    expect(state().procurementFilter).toBe('single');
  });

  it('выбор обоих способов каноникализируется в пустой Set («все»), pf=all', () => {
    state().toggleMethod('competitive');
    state().toggleMethod('single'); // {КП,ЕП} → clear
    expect(methods()).toEqual([]);
    expect(state().procurementFilter).toBe('all');
  });

  it('характеризация каноникализации: toggle другого способа дважды из {КП} даёт {ЕП}', () => {
    // Это и есть «несимметрия» из P0-9: через сброс {оба}≡«все» история клика
    // теряется. Каждый шаг корректен относительно ВИДИМОГО состояния чипов:
    // {КП} + клик ЕП → «все» (оба чипа сняты); клик ЕП из «все» → {ЕП}.
    state().toggleMethod('competitive');
    state().toggleMethod('single'); // → «все»
    state().toggleMethod('single'); // → {ЕП}
    expect(methods()).toEqual(['single']);
    expect(state().procurementFilter).toBe('single');
  });
});
