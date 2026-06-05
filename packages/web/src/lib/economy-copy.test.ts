import { describe, expect, it } from 'vitest';
import { ECONOMY_EMPTY_STATE_COPY } from './economy-copy';

describe('Economy copy contract', () => {
  it('does not describe approved economy as plan minus fact', () => {
    expect(ECONOMY_EMPTY_STATE_COPY.title).toBe('Нет данных по экономии');
    expect(ECONOMY_EMPTY_STATE_COPY.body.toLowerCase()).toContain('ad');
    expect(ECONOMY_EMPTY_STATE_COPY.body).toContain('Z');
    expect(ECONOMY_EMPTY_STATE_COPY.body).toContain('AA');
    expect(ECONOMY_EMPTY_STATE_COPY.body).toContain('AB');
    expect(ECONOMY_EMPTY_STATE_COPY.body.toLowerCase()).not.toContain('лимит программы - цена контракта');
    expect(ECONOMY_EMPTY_STATE_COPY.body.toLowerCase()).not.toContain('план-факт');
    expect(ECONOMY_EMPTY_STATE_COPY.body.toLowerCase()).not.toContain('план−факт');
  });
});
