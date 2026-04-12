import type { RawCellValue, ReportMapEntry, NormalizedMetric } from '@aemr/shared';

/**
 * Нормализует сырые значения ячеек в типизированные метрики
 */
export function normalizeMetrics(
  cells: Map<string, RawCellValue>,
  reportMap: ReportMapEntry[],
): Map<string, NormalizedMetric> {
  const result = new Map<string, NormalizedMetric>();

  for (const entry of reportMap) {
    const key = `${entry.sourceSheet}!${entry.sourceCell}`;
    const raw = cells.get(key);

    const metric = normalizeOne(entry, raw);
    result.set(entry.metricKey, metric);
  }

  return result;
}

function normalizeOne(entry: ReportMapEntry, raw: RawCellValue | undefined): NormalizedMetric {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  if (!raw) {
    return {
      metricKey: entry.metricKey,
      value: null,
      numericValue: null,
      displayValue: '—',
      origin: entry.originType,
      period: entry.period,
      unit: entry.displayUnit,
      sourceSheet: entry.sourceSheet,
      sourceCell: entry.sourceCell,
      formula: null,
      confidence: 0,
      readAt: now,
      warnings: ['Ячейка не прочитана'],
    };
  }

  let numericValue: number | null = null;
  let value: number | string | boolean | null = null;
  let confidence = 1.0;

  // Извлекаем числовое значение
  const rawVal = raw.rawValue;

  if (rawVal === null || rawVal === undefined || rawVal === '') {
    value = null;
    numericValue = null;
    confidence = 0;

    if (entry.fallbackPolicy === 'zero') {
      numericValue = 0;
      value = 0;
      warnings.push('Пустая ячейка, подставлен 0');
      confidence = 0.3;
    } else {
      warnings.push('Пустая ячейка');
    }
  } else if (typeof rawVal === 'number') {
    numericValue = rawVal;
    value = rawVal;

    // Коррекция процентов: Google Sheets возвращает 0.08 для 8%
    if (entry.valueType === 'percent' && Math.abs(rawVal) <= 2) {
      // Значение уже в долях единицы — всё ОК
    } else if (entry.valueType === 'percent' && Math.abs(rawVal) > 2) {
      // Похоже, что значение уже в процентах (8 вместо 0.08)
      numericValue = rawVal / 100;
      value = numericValue;
      warnings.push('Процент нормализован: исходное значение > 2, разделено на 100');
      confidence = 0.8;
    }

    // Проверка на подозрительные значения (дата как число)
    if (entry.valueType === 'currency' || entry.valueType === 'number') {
      if (rawVal > 40000 && rawVal < 50000 && !entry.sourceCell.includes(':')) {
        // Может быть дата (serial number ~2009-2036)
        warnings.push('Возможно, значение является датой (serial number)');
        confidence = Math.min(confidence, 0.5);
      }
    }
  } else if (typeof rawVal === 'string') {
    // Попытка распарсить число из строки
    const cleaned = rawVal.replace(/\s/g, '').replace(/,/g, '.').replace('%', '');
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed)) {
      numericValue = parsed;
      value = parsed;
      if (rawVal.includes('%') && entry.valueType === 'percent') {
        numericValue = parsed / 100;
        value = numericValue;
      }
      warnings.push('Значение извлечено из строки');
      confidence = Math.min(confidence, 0.7);
    } else {
      value = rawVal;
      warnings.push(`Не удалось извлечь число из "${rawVal}"`);
      confidence = 0.2;
    }
  } else if (typeof rawVal === 'boolean') {
    value = rawVal;
    numericValue = rawVal ? 1 : 0;
  }

  // Формируем отображаемое значение
  const displayValue = formatDisplayValue(numericValue, value, entry);

  return {
    metricKey: entry.metricKey,
    value,
    numericValue,
    displayValue,
    origin: entry.originType,
    period: entry.period,
    unit: entry.displayUnit,
    sourceSheet: entry.sourceSheet,
    sourceCell: entry.sourceCell,
    formula: raw.formula,
    confidence,
    readAt: raw.readAt,
    warnings,
  };
}

function formatDisplayValue(
  numericValue: number | null,
  value: unknown,
  entry: ReportMapEntry,
): string {
  if (numericValue === null && value === null) return '—';

  if (numericValue !== null) {
    switch (entry.displayUnit) {
      case 'percent':
        return `${(numericValue * 100).toFixed(1)}%`;
      case 'thousand_rubles':
        return formatCurrency(numericValue) + ' тыс. руб.';
      case 'million_rubles':
        return formatCurrency(numericValue) + ' млн руб.';
      case 'rubles':
        return formatCurrency(numericValue) + ' руб.';
      case 'count':
        return String(Math.round(numericValue));
      default:
        return String(numericValue);
    }
  }

  return String(value ?? '—');
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
