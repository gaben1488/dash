import { describe, expect, it } from 'vitest';
import {
  ECONOMY_EMPTY_STATE_COPY,
  buildEconomyInsight,
  economyBannerStatus,
} from './economy-copy';

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

describe('economy-copy (T7)', () => {
  // ── Bug 2: banner status must respect economyConflicts ──
  it('статус НЕ «в норме» при конфликтах > 0', () => {
    const status = economyBannerStatus({ conflicts: 120 });
    expect(status.ok).toBe(false);
    expect(status.tone).toBe('warn');
    expect(status.label).not.toBe('Все показатели в норме');
  });

  it('статус НЕ «в норме» при отклонениях >25% > 0', () => {
    expect(economyBannerStatus({ conflicts: 0, over25: 2 }).ok).toBe(false);
  });

  it('статус «в норме» только при нуле конфликтов и отклонений', () => {
    const status = economyBannerStatus({ conflicts: 0, over25: 0 });
    expect(status.ok).toBe(true);
    expect(status.tone).toBe('ok');
    expect(status.label).toBe('Все показатели в норме');
  });

  // ── Bug 1: insight must be built ONLY from the filtered (selected) set ──
  it('инсайт не называет ГРБС вне выбранного набора и не хардкодит УФБП', () => {
    const s = buildEconomyInsight({
      depts: [{ dept: 'УО', economy: 5_000_000 }],
      totalEconomy: 5_000_000,
      totalPlan: 20_000_000,
      mbEconomy: 1_000_000,
      highEconomyCount: 0,
      conflicts: 120,
      formatMoney: (v) => String(v),
    });
    // Лидер берётся строго из отфильтрованного набора
    expect(s).toContain('УО');
    // Ни имя чужого ГРБС, ни хардкод-ярлык «УФБП/ГРБС» попасть не могут
    expect(s).not.toContain('УФБП');
    // Расхождения формулируются нейтрально (флаг экономии), без чужого ГРБС
    expect(s).toMatch(/конфликт|флага экономии/i);
  });

  it('инсайт называет лидером ГРБС с максимальной экономией внутри набора', () => {
    const s = buildEconomyInsight({
      depts: [
        { dept: 'УО', economy: 3_000_000 },
        { dept: 'УКС', economy: 8_000_000 },
      ],
      totalEconomy: 11_000_000,
      totalPlan: 40_000_000,
      mbEconomy: 0,
      highEconomyCount: 0,
      conflicts: 0,
      formatMoney: (v) => String(v),
    });
    expect(s).toContain('Лидер — УКС');
  });
});
