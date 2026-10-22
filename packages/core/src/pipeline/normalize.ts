import type { RawCellValue, ReportMapEntry, NormalizedMetric } from '@aemr/shared';
import { toNumber as sheetNumber, parsePercentage, convertMoney, isMoneyUnit } from '@aemr/shared';

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
  const numericUnit = entry.valueType === 'currency' ? 'thousand_rubles' : entry.valueType === 'percent' ? 'percent' : entry.sourceUnit;

  if (!raw) {
    return {
      metricKey: entry.metricKey,
      value: null,
      numericValue: null,
      displayValue: '—',
      origin: entry.originType,
      period: entry.period,
      unit: numericUnit,
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
  } else if (entry.valueType === 'percent') {
    const parsed = parsePercentage(rawVal, entry.percentEncoding ?? 'fraction');
    if (parsed.ok) {
      numericValue = parsed.value;
      value = parsed.value;
      if (typeof rawVal === 'string') {
        warnings.push('Значение извлечено из строки');
        confidence = 0.7;
      }
    } else {
      value = String(rawVal);
      warnings.push('Некорректный процент: требуется полное конечное число и явная единица.');
      confidence = 0;
    }
  } else if (typeof rawVal === 'number') {
    numericValue = Number.isFinite(rawVal) ? rawVal : null;
    value = numericValue ?? String(rawVal);
    if (numericValue === null) {
      warnings.push('Число не является конечным.');
      confidence = 0;
    }
  } else if (typeof rawVal === 'string') {
    // Попытка распарсить число из строки — единой коэрцией ядра sheetNumber
    // (чистка 20.08.2026, зона В): семантика совпадает («мусор → null»),
    // Процент разбирается отдельно по явной единице; здесь требуется всё число.
    const parsed = sheetNumber(rawVal) ?? NaN;
    if (!isNaN(parsed)) {
      numericValue = parsed;
      value = parsed;
      warnings.push('Значение извлечено из строки');
      confidence = Math.min(confidence, 0.7);
    } else {
      value = rawVal;
      warnings.push(`Не удалось извлечь число из "${rawVal}"`);
      confidence = 0.2;
    }
  } else if (typeof rawVal === 'boolean') {
    value = rawVal;
    numericValue = entry.valueType === 'boolean' ? (rawVal ? 1 : 0) : null;
    if (numericValue === null) { warnings.push('Логическое значение не является числом.'); confidence = 0; }
  }

  if (numericValue !== null && entry.valueType === 'integer' && !Number.isInteger(numericValue)) {
    numericValue = null;
    warnings.push('Ожидалось целое число.');
    confidence = 0;
  }
  if (numericValue !== null && entry.valueType === 'currency') {
    numericValue = isMoneyUnit(entry.sourceUnit) && isMoneyUnit(entry.displayUnit)
      ? convertMoney(numericValue, entry.sourceUnit, 'thousand_rubles') : null;
    value = numericValue ?? String(rawVal);
    if (numericValue === null) { warnings.push('Некорректная денежная единица или переполнение суммы.'); confidence = 0; }
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
    unit: numericUnit,
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
    const displayNumber = entry.valueType === 'currency' && isMoneyUnit(entry.displayUnit)
      ? convertMoney(numericValue, 'thousand_rubles', entry.displayUnit) : numericValue;
    if (displayNumber === null) return 'Сумма выходит за допустимый диапазон';
    switch (entry.displayUnit) {
      case 'percent':
        return `${(numericValue * 100).toFixed(1)}%`;
      case 'thousand_rubles':
        return formatCurrency(displayNumber) + ' тыс. руб.';
      case 'million_rubles':
        return formatCurrency(displayNumber) + ' млн руб.';
      case 'rubles':
        return formatCurrency(displayNumber) + ' руб.';
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
