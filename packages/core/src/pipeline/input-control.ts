/**
 * Система контроля ввода данных.
 *
 * Проверяет и ограничивает ввод пользователей:
 * - Блокировка формульных колонок
 * - Блокировка итоговых строк
 * - Валидация типов (число, дата, статус)
 * - Валидация диапазонов
 * - Логирование ошибок ввода для контроля качества
 */

import { normalizeCell, type NormalizationResult } from './normalizer-rules.js';

export interface InputValidationResult {
  valid: boolean;
  /** Нормализованное значение (если валидно) */
  normalizedValue: unknown;
  /** Причина отклонения */
  reason?: string;
  /** Подсказка для пользователя */
  hint?: string;
  /** Результат нормализации */
  normalization?: NormalizationResult;
  /** Требуется подтверждение пользователя (значение было изменено) */
  requiresConfirmation?: boolean;
  /** Описание изменения для подтверждения */
  confirmationMessage?: string;
}

/**
 * Формульные колонки — запись заблокирована.
 * Значения рассчитываются автоматически формулами в Google Sheets.
 */
const FORMULA_COLUMNS = new Set(['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC']);

/**
 * Защищённые колонки — только чтение.
 */
const PROTECTED_COLUMNS = new Set(['A']); // номер строки

/**
 * Колонки с допустимой ручной записью.
 */
const EDITABLE_COLUMNS = new Set([
  'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'L', 'M', 'N', 'Q', 'U', 'V', 'W', 'X',
  // AH = «Комментарий УФБП АЕМР» — последняя заполненная колонка живой шапки;
  // без неё правое крыло комментариев обрывалось на УЭР.
  'AD', 'AE', 'AF', 'AG', 'AH',
]);

/**
 * Ограничения по диапазонам значений.
 */
const VALUE_CONSTRAINTS: Record<string, { min?: number; max?: number; description: string }> = {
  money: { min: 0, max: 10_000_000_000, description: 'Сумма должна быть от 0 до 10 млрд руб.' },
  number: { min: 0, max: 100_000, description: 'Количество должно быть от 0 до 100 000' },
  percent: { min: 0, max: 1, description: 'Процент должен быть от 0 до 100%' },
};

/**
 * Валидировать попытку записи значения в ячейку.
 *
 * @param column Буква колонки (A, B, ..., AG)
 * @param value Значение которое пользователь пытается записать
 * @param rowIndex Номер строки
 * @returns Результат валидации
 */
export function validateInput(
  column: string,
  value: unknown,
  rowIndex: number,
): InputValidationResult {
  const col = column.toUpperCase();

  // 1. Проверка формульных колонок
  if (FORMULA_COLUMNS.has(col)) {
    return {
      valid: false,
      normalizedValue: null,
      reason: `Колонка ${col} содержит формулу и не может быть изменена вручную`,
      hint: 'Данное поле рассчитывается автоматически. Для изменения обратитесь к администратору.',
    };
  }

  // 2. Проверка защищённых колонок
  if (PROTECTED_COLUMNS.has(col)) {
    return {
      valid: false,
      normalizedValue: null,
      reason: `Колонка ${col} защищена от изменений`,
      hint: 'Это системное поле, которое нельзя изменить.',
    };
  }

  // 3. Проверка что колонка допускает запись
  if (!EDITABLE_COLUMNS.has(col)) {
    return {
      valid: false,
      normalizedValue: null,
      reason: `Колонка ${col} не предусмотрена для ручного ввода`,
      hint: 'Обратитесь к администратору для настройки разрешений.',
    };
  }

  // 4. Проверка итоговых строк (строки 1-3 обычно заголовки)
  if (rowIndex <= 3) {
    return {
      valid: false,
      normalizedValue: null,
      reason: 'Строки заголовков защищены от изменений',
      hint: 'Данные можно вводить начиная со строки 4.',
    };
  }

  // 5. Нормализация значения
  const normResult = normalizeCell(col, value);

  // 6. Проверка что нормализация не дала null для обязательного поля
  if (normResult.normalized === null && value !== null && value !== undefined && String(value).trim() !== '') {
    return {
      valid: false,
      normalizedValue: null,
      reason: `Значение "${value}" не удалось распознать для колонки ${col}`,
      hint: getHintForColumn(col),
      normalization: normResult,
    };
  }

  // 7. Проверка диапазонов
  if (normResult.normalized !== null && typeof normResult.normalized === 'number') {
    const constraint = VALUE_CONSTRAINTS[normResult.fieldType];
    if (constraint) {
      if (constraint.min !== undefined && normResult.normalized < constraint.min) {
        return {
          valid: false,
          normalizedValue: null,
          reason: constraint.description,
          hint: `Введённое значение ${normResult.normalized} меньше минимума ${constraint.min}`,
          normalization: normResult,
        };
      }
      if (constraint.max !== undefined && normResult.normalized > constraint.max) {
        return {
          valid: false,
          normalizedValue: null,
          reason: constraint.description,
          hint: `Введённое значение ${normResult.normalized} превышает максимум ${constraint.max}`,
          normalization: normResult,
        };
      }
    }
  }

  // 8. Если значение было нормализовано — запросить подтверждение
  if (normResult.changed && normResult.rule) {
    return {
      valid: true,
      normalizedValue: normResult.normalized,
      normalization: normResult,
      requiresConfirmation: true,
      confirmationMessage: `Значение будет нормализовано: "${value}" → "${normResult.normalized}"`,
    };
  }

  // 9. Всё OK
  return {
    valid: true,
    normalizedValue: normResult.normalized ?? value,
    normalization: normResult,
  };
}

/**
 * Подсказка для пользователя по формату ввода.
 */
function getHintForColumn(column: string): string {
  const col = column.toUpperCase();

  // Денежные колонки — только H/I/J (план) и V/W/X (факт). G сюда попадала
  // ошибочно: по шапке это «Наименование мероприятия…», текст, а не сумма.
  if (['H', 'I', 'J', 'V', 'W', 'X'].includes(col)) {
    return 'Введите сумму в тысячах рублей (например: 1250.5 или 1 250,5)';
  }
  if (['N', 'Q'].includes(col)) {
    return 'Введите дату в формате ДД.ММ.ГГГГ (например: 15.03.2026)';
  }
  // U по шапке — «Причина отклонения», свободный текст, а не список статусов.
  if (col === 'U') {
    return 'Опишите причину отклонения от планового срока (свободный текст)';
  }
  if (col === 'AD') {
    return 'Введите: да / нет (учитывать сумму в расчёте экономии)';
  }

  return 'Введите корректное значение';
}

/**
 * Проверить, является ли колонка формульной (нередактируемой).
 */
export function isFormulaColumn(column: string): boolean {
  return FORMULA_COLUMNS.has(column.toUpperCase());
}

/**
 * Проверить, допускает ли колонка ручной ввод.
 */
export function isEditableColumn(column: string): boolean {
  return EDITABLE_COLUMNS.has(column.toUpperCase());
}

/**
 * Получить описание колонки на русском языке.
 */
export function getColumnDescription(column: string): string {
  // Канон столбцов dept-листа (column-map.ts DEPT_COLUMNS/DEPT_HEADER_LABELS,
  // сверено с шапкой живых книг 2026-07-29). Подпись обязана называть то, что
  // в колонке лежит на самом деле: раньше B звалась «Реестровым номером»
  // (там имя ГРБС), а комментарии были сдвинуты на колонку влево.
  const descriptions: Record<string, string> = {
    'A': '№ п/п',
    'B': 'Наименование управления (ГРБС)',
    'C': 'Наименование подведомственного',
    'D': 'Наименование программы',
    'E': 'Пункт и наименование подпрограммы',
    'F': 'Вид деятельности (ТД / ПМ)',
    'G': 'Предмет закупки',
    'H': 'Федеральный бюджет (план)',
    'I': 'Краевой бюджет (план)',
    'J': 'Муниципальный бюджет (план)',
    'K': 'Итого (план) — формула',
    'L': 'Способ закупки (ЭА / ЕП / ЭК / ЭЗК)',
    'M': 'Причина выбора способа определения поставщика (ЕП)',
    'N': 'Дата размещения плана',
    'O': 'Квартал плана',
    'P': 'Год плана',
    'Q': 'Дата заключения контракта',
    'R': 'Квартал факта — формула',
    'S': 'Год факта — формула',
    'T': 'Отклонение, дни — формула',
    'U': 'Причина отклонения',
    'V': 'Федеральный бюджет (факт)',
    'W': 'Краевой бюджет (факт)',
    'X': 'Муниципальный бюджет (факт)',
    'Y': 'Итого (факт) — формула',
    'Z': 'Экономия ФБ',
    'AA': 'Экономия КБ',
    'AB': 'Экономия МБ',
    'AC': 'Итого экономия — формула',
    'AD': 'Учитывать в расчёте экономии (да / нет)',
    'AE': 'Обоснование необходимости',
    'AF': 'Комментарий ГРБСа',
    'AG': 'Комментарий УЭР АЕМР',
    'AH': 'Комментарий УФБП АЕМР',
  };

  return descriptions[column.toUpperCase()] || `Колонка ${column}`;
}
