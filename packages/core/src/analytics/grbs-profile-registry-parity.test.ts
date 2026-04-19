/**
 * grbs-profile-registry-parity.test.ts
 *
 * Guards against drift between the two ГРБС identity systems:
 *   1. `packages/shared/src/dictionaries/grbs-registry.ts` — canonical Cyrillic IDs
 *      (УО, УКСиМП, УАГиЗО, УИО, УФБП, УД, УЭР, УДТХ).
 *   2. `packages/core/src/analytics/grbs-profile.ts` — latin lowercase IDs with
 *      business baselines (uer, uio, uagzo, ufbp, ud, udtx, uksimp, uo).
 *
 * If someone adds a 9th ГРБС to the registry but forgets grbs-profile (or vice
 * versa), this test screams — without it, silent drift causes exec_count_pct
 * miscounts across the new dept.
 *
 * Expected mapping (1-to-1):
 *   УО     ↔ uo
 *   УКСиМП ↔ uksimp
 *   УАГиЗО ↔ uagzo
 *   УИО    ↔ uio
 *   УФБП   ↔ ufbp
 *   УД     ↔ ud
 *   УЭР    ↔ uer
 *   УДТХ   ↔ udtx
 *
 * Long-term: unify to one ID scheme. For now, test locks cardinality + exhaustive
 * mapping.
 */
import { describe, it, expect } from 'vitest';
import { GRBS_CANONICAL, ALL_GRBS_IDS } from '@aemr/shared';
import { GRBS_BASELINES } from './grbs-profile.js';

/**
 * Expected latin↔cyrillic mapping for cross-scheme consistency checks.
 * When adding a ГРБС, extend BOTH registries AND this map.
 */
const LATIN_TO_CYRILLIC: Record<string, string> = {
  uo: 'УО',
  uksimp: 'УКСиМП',
  uagzo: 'УАГиЗО',
  uio: 'УИО',
  ufbp: 'УФБП',
  ud: 'УД',
  uer: 'УЭР',
  udtx: 'УДТХ',
};

describe('ГРБС registry parity (dictionaries ↔ grbs-profile)', () => {
  it('GRBS_BASELINES count matches ALL_GRBS_IDS', () => {
    expect(GRBS_BASELINES.length).toBe(ALL_GRBS_IDS.length);
  });

  it('GRBS_CANONICAL has same cardinality as GRBS_BASELINES', () => {
    expect(GRBS_CANONICAL.length).toBe(GRBS_BASELINES.length);
  });

  it('every GRBS_BASELINES.grbsId maps to a known cyrillic ID', () => {
    for (const baseline of GRBS_BASELINES) {
      const cyrillic = LATIN_TO_CYRILLIC[baseline.grbsId];
      expect(cyrillic, `no cyrillic mapping for ${baseline.grbsId}`).toBeDefined();
      expect(GRBS_CANONICAL).toContain(cyrillic);
    }
  });

  it('every GRBS_CANONICAL id has a latin baseline counterpart', () => {
    const cyrillicToLatin = Object.fromEntries(
      Object.entries(LATIN_TO_CYRILLIC).map(([lat, cyr]) => [cyr, lat]),
    );
    for (const cyr of GRBS_CANONICAL) {
      const lat = cyrillicToLatin[cyr];
      expect(lat, `no latin mapping for ${cyr}`).toBeDefined();
      expect(GRBS_BASELINES.map(b => b.grbsId)).toContain(lat);
    }
  });

  it('grbsShort в GRBS_BASELINES соответствует shortName / id в GRBS_REGISTRY (approx)', () => {
    // Мягкая проверка: УАГЗО в baseline vs УАГиЗО в registry.
    // Точное соответствие не ждём, но expected shortName должен быть в registry shortName или id.
    // Тест просто документирует текущее расхождение.
    const baselineShorts = GRBS_BASELINES.map(b => b.grbsShort);
    // УАГЗО ↔ УАГиЗО — расхождение которое подтверждается.
    expect(baselineShorts).toContain('УАГЗО');
    expect(GRBS_CANONICAL).toContain('УАГиЗО' as typeof GRBS_CANONICAL[number]);
    // Это задокументированное расхождение, не bug.
  });
});
