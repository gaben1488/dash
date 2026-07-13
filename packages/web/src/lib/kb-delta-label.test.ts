import { describe, expect, it } from 'vitest';
import { METRIC_KB } from '@aemr/core';

// T6 (QA D9): колонка рейтинга управлений была подписана «Δ нед.» с KB-ключом
// dept_delta_week, но значение = дельта исполнения к предыдущему КВАРТАЛУ
// (useMultiDimMetrics: current-quarter-vs-previous-quarter). Подпись лгала.
// Ключ переименован в dept_delta_quarter с честным текстом; вычисление не менялось.
// METRIC_KB (packages/core/src/metrics/registry.ts) — единый источник правды,
// объект Record<key, KBEntryData>; ключи получаем через Object.keys.

describe('KB-registry: честная подпись дельты (T6)', () => {
  it('содержит dept_delta_quarter и НЕ содержит dept_delta_week', () => {
    const keys = Object.keys(METRIC_KB);
    expect(keys).toContain('dept_delta_quarter');
    expect(keys).not.toContain('dept_delta_week');
  });

  it('запись dept_delta_quarter честно говорит о квартале, не о неделе', () => {
    const entry = METRIC_KB['dept_delta_quarter'];
    expect(entry).toBeDefined();
    // Заголовок/описание не должны обещать недельную семантику.
    expect(entry?.label ?? '').not.toMatch(/недел/i);
    expect(entry?.whatIs ?? '').toMatch(/квартал/i);
  });
});
