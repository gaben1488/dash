/**
 * Юниты контракта элементов страницы: чистые хелперы + tsc-контракт пропсов.
 * Рендер-тестов в харнесе нет (node env) — компоненты проверяются типами.
 */
import { describe, it, expect } from 'vitest';
import type { MetricDelta } from '@aemr/core';
import { SOURCE_META, type ElementSource, type PageElementProps } from './types';
import { kpiTileLabel, type KpiTileProps } from './KpiTile';
import { diffView, type DiffTextProps } from './DiffText';
import type { ReportTableProps } from './ReportTable';
import { EMPTY_FILTER_CONTEXT } from '../../lib/filter-context';

describe('SOURCE_META — словарь бейджа происхождения', () => {
  it('подписи совпадают с существующим бейджем AnalyticsCard', () => {
    expect(SOURCE_META.calc.label).toBe('Расчёт');
    expect(SOURCE_META.svod.label).toBe('СВОД');
    expect(SOURCE_META.mixed.label).toBe('Комби');
  });

  it('каждый источник несёт непустой стиль (light+dark)', () => {
    for (const source of Object.keys(SOURCE_META) as ElementSource[]) {
      const meta = SOURCE_META[source];
      expect(meta.className).toMatch(/bg-/);
      expect(meta.className).toMatch(/dark:/);
    }
  });
});

describe('kpiTileLabel — подпись строго из канон-словаря', () => {
  it('известный ключ метрики → русская подпись productLabel', () => {
    expect(kpiTileLabel('plan_count')).toBe('План (кол-во)');
    expect(kpiTileLabel('ep_count')).toBe('ЕП (кол-во)');
  });

  it('неизвестный ключ — фолбэк на сам ключ (сигнал дополнить словарь), не бросает', () => {
    expect(kpiTileLabel('__nonexistent__')).toBe('__nonexistent__');
  });
});

describe('diffView — направление расхождения (DiffText)', () => {
  it('совпадение — тихое, без дельты', () => {
    expect(diffView(5, 5)).toEqual({ matches: true, deltaText: '' });
  });

  it('СВОД больше расчёта → «+N», меньше → «−N» (минус типографский)', () => {
    expect(diffView(5, 4)).toEqual({ matches: false, deltaText: '+1' });
    expect(diffView(2, 5)).toEqual({ matches: false, deltaText: '−3' });
  });
});

describe('tsc-контракт PageElementProps', () => {
  it('элемент обязан принимать filterCtx и source; KpiTile — полный набор пропсов', () => {
    // Компилируемость этих объектов и есть проверка контракта.
    const base: PageElementProps = { filterCtx: EMPTY_FILTER_CONTEXT, source: 'calc' };
    const tile: KpiTileProps = {
      ...base,
      metricKey: 'plan_count',
      value: '1 234',
      unit: 'тыс ₽',
      periodBadge: '1 кв · официал',
    };
    expect(tile.filterCtx).toBe(EMPTY_FILTER_CONTEXT);

    // @ts-expect-error — source обязателен по типу
    const missingSource: PageElementProps = { filterCtx: EMPTY_FILTER_CONTEXT };
    // @ts-expect-error — filterCtx обязателен по типу
    const missingCtx: PageElementProps = { source: 'svod' };
    // @ts-expect-error — periodBadge (честный скоуп) обязателен у KPI-плитки
    const noBadge: KpiTileProps = { ...base, metricKey: 'plan_count', value: '1', unit: '' };
    expect([missingSource, missingCtx, noBadge].length).toBe(3);
  });

  it('KpiTile: дельта к прошлому снимку опциональна — плитка живёт и с ней, и без', () => {
    const base: PageElementProps = { filterCtx: EMPTY_FILTER_CONTEXT, source: 'calc' };
    const shift: MetricDelta = {
      metricKey: 'competitive.q1.percent',
      from: { value: 40, at: '2026-07-16T04:00:00.000Z' },
      to: { value: 42, at: '2026-07-23T04:00:00.000Z' },
      deltaAbs: 2,
      deltaPct: 0.05,
      direction: 'up',
      sentiment: 'good',
    };
    const withDelta: KpiTileProps = {
      ...base, metricKey: 'comp_exec_count_pct', value: '42,0%', unit: '', periodBadge: 'Q1', delta: shift,
    };
    const withoutDelta: KpiTileProps = {
      ...base, metricKey: 'exec_count_pct', value: '40,0%', unit: '', periodBadge: 'Q1',
    };
    expect(withDelta.delta?.metricKey).toBe('competitive.q1.percent');
    expect(withoutDelta.delta).toBeUndefined();
  });

  it('ReportTable и DiffText — контрактные: source и filterCtx обязательны по типу', () => {
    const table: ReportTableProps = {
      filterCtx: EMPTY_FILTER_CONTEXT,
      source: 'calc',
      columns: [{ key: 'method', label: 'Способ' }, { key: 'plan', label: 'План', align: 'right' }],
      rows: [{ method: 'КП', plan: '10' }],
    };
    const diff: DiffTextProps = {
      filterCtx: EMPTY_FILTER_CONTEXT,
      source: 'svod',
      value: 5,
      reference: 4,
    };
    expect(table.source).toBe('calc');
    expect(diff.reference).toBe(4);

    // @ts-expect-error — таблица без source не компилируется
    const tableNoSource: ReportTableProps = { filterCtx: EMPTY_FILTER_CONTEXT, columns: [], rows: [] };
    // @ts-expect-error — DiffText без опорного числа не компилируется
    const diffNoRef: DiffTextProps = { filterCtx: EMPTY_FILTER_CONTEXT, source: 'svod', value: 5 };
    expect([tableNoSource, diffNoRef].length).toBe(2);
  });
});
