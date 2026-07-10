/**
 * Characterization-тест публичной поверхности god-файлов ПЕРЕД разрезанием (чанк G).
 *
 * Задача: разрез `dataset-signals.ts` (1380) и `unified-class-system.ts` (1265) — move-only.
 * Ни один экспорт не должен исчезнуть или переехать за пределы досягаемости потребителей.
 *
 * Ловушка, подтверждённая аудитом: `detectSeasonalAnomalies` и `detectSuspiciousSplitting`
 * экспортируются из dataset-signals.ts, но НЕ переэкспортируются из core/index.ts — их
 * достаёт только глубокий импорт из теста. Файл-шим после разреза обязан `export *`,
 * иначе они исчезнут молча.
 *
 * Этот тест зелёный ДО разреза и обязан остаться зелёным ПОСЛЕ каждого шага.
 */
import { describe, it, expect } from 'vitest';
import * as datasetSignals from './dataset-signals.js';
import * as coreIndex from '../index.js';
import * as unifiedClassSystem from '@aemr/shared';

/** Рантайм-экспорты dataset-signals (типы проверяются компилятором ниже). */
const DATASET_SIGNALS_RUNTIME = [
  'analyzeDataset',
  'benfordTest',
  'buildNoiseMap',
  'classifyEpRisk',
  'classifyExecution',
  'computeCompositeScore',
  'detectBehavioralAnomalies',
  'detectDataAnomalies',
  'detectSeasonalAnomalies',
  'detectSuspiciousSplitting',
  'detectSystemicAnomalies',
  'detectOutliers',
].sort();

/** Что core/index обязан отдавать наружу из dataset-signals. */
const CORE_INDEX_FROM_DATASET_SIGNALS = [
  'analyzeDataset',
  'benfordTest',
  'buildNoiseMap',
  'classifyEpRisk',
  'classifyExecution',
  'computeCompositeScore',
  'detectBehavioralAnomalies',
  'detectDataAnomalies',
  'detectSystemicAnomalies',
  'detectOutliers',
].sort();

function runtimeFns(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).filter(k => typeof mod[k] === 'function').sort();
}

describe('чанк G — поверхность dataset-signals не меняется при разрезании', () => {
  it('модуль отдаёт ровно 12 функций, включая глубоко-импортируемые', () => {
    expect(runtimeFns(datasetSignals as Record<string, unknown>)).toEqual(DATASET_SIGNALS_RUNTIME);
  });

  it('detectSeasonalAnomalies и detectSuspiciousSplitting достижимы напрямую (barrel-ловушка)', () => {
    expect(typeof datasetSignals.detectSeasonalAnomalies).toBe('function');
    expect(typeof datasetSignals.detectSuspiciousSplitting).toBe('function');
  });

  it('core/index переэкспортирует ожидаемый набор', () => {
    for (const name of CORE_INDEX_FROM_DATASET_SIGNALS) {
      expect(typeof (coreIndex as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('типы остаются экспортируемыми (проверяет компилятор)', () => {
    const _benford: datasetSignals.BenfordResult | undefined = undefined;
    const _outlier: datasetSignals.OutlierResult | undefined = undefined;
    const _analysis: datasetSignals.DatasetAnalysis | undefined = undefined;
    const _input: datasetSignals.DatasetAnalysisInput | undefined = undefined;
    const _seasonal: datasetSignals.SeasonalAnomaly | undefined = undefined;
    const _splitting: datasetSignals.SplittingGroup | undefined = undefined;
    expect([_benford, _outlier, _analysis, _input, _seasonal, _splitting]).toHaveLength(6);
  });
});

describe('чанк G — поверхность unified-class-system не меняется при разрезании', () => {
  it('реестр проверок и метаданные групп достижимы', () => {
    expect(Array.isArray(unifiedClassSystem.CHECK_REGISTRY)).toBe(true);
    expect(unifiedClassSystem.CHECK_REGISTRY.length).toBeGreaterThan(0);
    expect(typeof unifiedClassSystem.ISSUE_GROUP_META).toBe('object');
    expect(typeof unifiedClassSystem.SEVERITY_WEIGHT).toBe('object');
    expect(typeof unifiedClassSystem.TRUST_COMPONENT_CONFIG).toBe('object');
  });

  it('вес серьёзности покрывает все пять уровней', () => {
    expect(Object.keys(unifiedClassSystem.SEVERITY_WEIGHT).sort()).toEqual(
      ['critical', 'error', 'info', 'significant', 'warning'],
    );
  });

  it('типы контракта фильтров и проверок остаются экспортируемыми (компилятор)', () => {
    const _dims: unifiedClassSystem.FilterDimensions | undefined = undefined;
    const _ctx: unifiedClassSystem.UnifiedCheckContext | undefined = undefined;
    const _issue: unifiedClassSystem.UnifiedIssue | undefined = undefined;
    expect([_dims, _ctx, _issue]).toHaveLength(3);
  });
});
