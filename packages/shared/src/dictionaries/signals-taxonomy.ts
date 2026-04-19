/**
 * signals-taxonomy.ts — Таксономия сигналов контрольной системы АЕМР.
 *
 * Источник: unified-class-system.ts (IssueGroup), types.ts (RowSignal),
 *           AEMR_SOURCE_AUDIT.md §3 (новые сигналы D2).
 *
 * Восемь направлений (Control Center taxonomy):
 *   44FZ      — Нарушения 44-ФЗ (процедурные несоответствия)
 *   DATA      — Целостность данных (суммы, формулы)
 *   SCHEDULE  — Временные аномалии (сроки, просрочки)
 *   ECONOMY   — Контроль экономии (AD-флаги, УФБП)
 *   METHOD    — Способы закупки (L-колонка, мисматчи)
 *   PROGRAM   — Программные мероприятия (ПМ/ТД несоответствия)
 *   RECON     — Сверка (расхождения СВОД vs dept-файлы)
 *   CHANGE    — Изменения реестра (ChangeLog события)
 *
 * Полный список сигналов строки: см. types.ts RowSignal (26 полей).
 * Этот файл добавляет 4 новых сигнала из D2 и таксономическую карту.
 */

import type { IssueGroup } from '../unified-class-system.js';

// ────────────────────────────────────────────────────────────
// 1. Направления Control Center (8 доменов)
// ────────────────────────────────────────────────────────────

export const SIGNAL_DIRECTIONS = [
  '44FZ',
  'DATA',
  'SCHEDULE',
  'ECONOMY',
  'METHOD',
  'PROGRAM',
  'RECON',
  'CHANGE',
] as const;

export type SignalDirection = typeof SIGNAL_DIRECTIONS[number];

export interface SignalDirectionMeta {
  id: SignalDirection;
  /** Русское название направления */
  label: string;
  /** Краткое описание для KB */
  description: string;
  /** Иконка (Lucide) */
  icon: string;
  /** Tailwind цвет акцента */
  color: string;
  /** KB-папка: packages/shared/src/kb/<dir>/ */
  kbDir: string;
}

export const SIGNAL_DIRECTION_META: Record<SignalDirection, SignalDirectionMeta> = {
  '44FZ': {
    id: '44FZ',
    label: 'Соответствие 44-ФЗ',
    description: 'Процедурные несоответствия нормам контрактной системы',
    icon: 'scale',
    color: 'red',
    kbDir: '44fz',
  },
  'DATA': {
    id: 'DATA',
    label: 'Целостность данных',
    description: 'Арифметические ошибки, формульные нарушения, пустые обязательные поля',
    icon: 'database',
    color: 'orange',
    kbDir: 'data',
  },
  'SCHEDULE': {
    id: 'SCHEDULE',
    label: 'Сроки и исполнение',
    description: 'Просрочки, нарушения плановых дат, зависшие контракты',
    icon: 'clock',
    color: 'yellow',
    kbDir: 'schedule',
  },
  'ECONOMY': {
    id: 'ECONOMY',
    label: 'Контроль экономии',
    description: 'Конфликты флага AD, аномальная экономия, решения УФБП',
    icon: 'trending-down',
    color: 'amber',
    kbDir: 'economy',
  },
  'METHOD': {
    id: 'METHOD',
    label: 'Способы закупки',
    description: 'Мисматчи метода и обоснования, незарегистрированные методы',
    icon: 'list-filter',
    color: 'blue',
    kbDir: 'method',
  },
  'PROGRAM': {
    id: 'PROGRAM',
    label: 'Программные мероприятия',
    description: 'Несоответствия ПМ/ТД классификации, программный бюджет',
    icon: 'layers',
    color: 'indigo',
    kbDir: 'program',
  },
  'RECON': {
    id: 'RECON',
    label: 'Сверка данных',
    description: 'Расхождения между СВОД и dept-файлами, дельта-аномалии',
    icon: 'git-compare',
    color: 'violet',
    kbDir: 'recon',
  },
  'CHANGE': {
    id: 'CHANGE',
    label: 'Журнал изменений',
    description: 'Горячие строки, осцилляции статуса, поздние заполнения',
    icon: 'history',
    color: 'slate',
    kbDir: 'change',
  },
};

// ────────────────────────────────────────────────────────────
// 2. Сигналы: ключи из RowSignal + новые из D2
// ────────────────────────────────────────────────────────────

/**
 * Все сигналы строки (существующие из types.ts RowSignal +
 * новые из AEMR_SOURCE_AUDIT.md D2-производные).
 *
 * Новые сигналы (добавлены в D2, ещё не в RowSignal):
 *   methodReasonMismatch  — L=ЕП + M=EP_SMALL_EL_PURCH (27 строк)
 *   unmappedReasonEP      — M не распознан в 15 кластерах (~230 строк)
 *   recentHotRow          — >10 правок в ChangeLog за неделю
 *   statusOscillation     — L переключался ≥ 2 раз в ChangeLog
 *   lateFill              — значение заполнено после контрольной даты
 *   bridgingContract      — межгодовой контракт (УФБП-паттерн)
 *   rollingPlan           — rolling-планирование (УФБП-паттерн)
 */
export type SignalKey =
  // Существующие (из types.ts RowSignal)
  | 'signed'
  | 'planning'
  | 'notDue'
  | 'financeDelay'
  | 'canceled'
  | 'overdue'
  | 'hasFact'
  | 'planPast'
  | 'planSoon'
  | 'inconsistentSigned'
  | 'economyFlag'
  | 'economyConflict'
  | 'epRisk'
  | 'dataQuality'
  | 'formulaBroken'
  | 'singleParticipant'
  | 'highEconomy'
  | 'lowCompetition'
  | 'earlyClosure'
  | 'factExceedsPlan'
  | 'stalledContract'
  | 'budgetMismatch'
  | 'factWithoutDate'
  | 'dateWithoutFact'
  | 'factDateBeforePlan'
  | 'planWithoutExecution'
  | 'epJustificationMissing'
  | 'budgetUnderallocation'
  | 'budgetSourceMissing'
  // Новые (D2)
  | 'methodReasonMismatch'
  | 'unmappedReasonEP'
  | 'recentHotRow'
  | 'statusOscillation'
  | 'lateFill'
  | 'bridgingContract'
  | 'rollingPlan';

// ────────────────────────────────────────────────────────────
// 3. Таксономическая карта: сигнал → направление + IssueGroup
// ────────────────────────────────────────────────────────────

export interface SignalTaxonomy {
  key: SignalKey;
  /** Русское название для UI */
  label: string;
  /** Направление Control Center */
  direction: SignalDirection;
  /** Группа issue (из unified-class-system.ts) */
  group: IssueGroup;
  /** Базовая серьёзность */
  severity: 'error' | 'warning' | 'info';
  /** Является ли сигнал новым (из D2, ещё не внедрён) */
  isNew?: true;
}

export const SIGNAL_TAXONOMY: Record<SignalKey, SignalTaxonomy> = {
  signed:              { key: 'signed', label: 'Подписано/заключено', direction: 'SCHEDULE', group: 'temporal', severity: 'info' },
  planning:            { key: 'planning', label: 'В стадии планирования', direction: 'SCHEDULE', group: 'temporal', severity: 'info' },
  notDue:              { key: 'notDue', label: 'Срок не наступил', direction: 'SCHEDULE', group: 'temporal', severity: 'info' },
  financeDelay:        { key: 'financeDelay', label: 'Задержка финансирования', direction: 'ECONOMY', group: 'economy_control', severity: 'warning' },
  canceled:            { key: 'canceled', label: 'Отменено / снято', direction: 'SCHEDULE', group: 'temporal', severity: 'info' },
  overdue:             { key: 'overdue', label: 'Просрочено', direction: 'SCHEDULE', group: 'temporal', severity: 'error' },
  hasFact:             { key: 'hasFact', label: 'Есть фактические данные', direction: 'DATA', group: 'data_integrity', severity: 'info' },
  planPast:            { key: 'planPast', label: 'Плановая дата в прошлом', direction: 'SCHEDULE', group: 'temporal', severity: 'warning' },
  planSoon:            { key: 'planSoon', label: 'Срок наступит в ближайшие 14 дней', direction: 'SCHEDULE', group: 'temporal', severity: 'warning' },
  inconsistentSigned:  { key: 'inconsistentSigned', label: 'Подписано без факта', direction: 'DATA', group: 'data_integrity', severity: 'warning' },
  economyFlag:         { key: 'economyFlag', label: 'Флаг экономии (AD)', direction: 'ECONOMY', group: 'economy_control', severity: 'info' },
  economyConflict:     { key: 'economyConflict', label: 'Конфликт флага экономии', direction: 'ECONOMY', group: 'economy_control', severity: 'error' },
  epRisk:              { key: 'epRisk', label: 'ЕП > 500 тыс. (антикоррупционный)', direction: '44FZ', group: 'field_validation', severity: 'warning' },
  dataQuality:         { key: 'dataQuality', label: 'Пустые обязательные поля', direction: 'DATA', group: 'completeness', severity: 'warning' },
  formulaBroken:       { key: 'formulaBroken', label: 'Формула вернула ошибку (#REF и т.д.)', direction: 'DATA', group: 'formula_consistency', severity: 'error' },
  singleParticipant:   { key: 'singleParticipant', label: '1 участник (формальная конкуренция)', direction: '44FZ', group: 'field_validation', severity: 'warning' },
  highEconomy:         { key: 'highEconomy', label: 'Высокая экономия > 25 %', direction: 'ECONOMY', group: 'economy_control', severity: 'warning' },
  lowCompetition:      { key: 'lowCompetition', label: 'Экономия < 2 % (предопределённый победитель)', direction: '44FZ', group: 'field_validation', severity: 'warning' },
  earlyClosure:        { key: 'earlyClosure', label: 'Раннее закрытие (факт опередил план > 30 дн.)', direction: 'SCHEDULE', group: 'temporal', severity: 'info' },
  factExceedsPlan:     { key: 'factExceedsPlan', label: 'Факт > план на > 10 %', direction: 'DATA', group: 'financial', severity: 'error' },
  stalledContract:     { key: 'stalledContract', label: 'Подвисший контракт (> 60 дн. просрочки)', direction: 'SCHEDULE', group: 'temporal', severity: 'error' },
  budgetMismatch:      { key: 'budgetMismatch', label: 'Несоответствие бюджетных сумм', direction: 'DATA', group: 'data_integrity', severity: 'error' },
  factWithoutDate:     { key: 'factWithoutDate', label: 'Есть факт-сумма, нет факт-даты', direction: 'DATA', group: 'completeness', severity: 'warning' },
  dateWithoutFact:     { key: 'dateWithoutFact', label: 'Есть факт-дата, нет факт-суммы', direction: 'DATA', group: 'completeness', severity: 'warning' },
  factDateBeforePlan:  { key: 'factDateBeforePlan', label: 'Факт-дата раньше план-даты', direction: 'DATA', group: 'data_integrity', severity: 'error' },
  planWithoutExecution:{ key: 'planWithoutExecution', label: 'Невыполненный план (год идёт)', direction: 'SCHEDULE', group: 'temporal', severity: 'warning' },
  epJustificationMissing:{ key: 'epJustificationMissing', label: 'ЕП без обоснования (M пуст)', direction: '44FZ', group: 'field_validation', severity: 'error' },
  budgetUnderallocation:{ key: 'budgetUnderallocation', label: 'Факт без планового бюджета (K=0)', direction: 'DATA', group: 'financial', severity: 'error' },
  budgetSourceMissing:  { key: 'budgetSourceMissing', label: 'Источник бюджета не указан (H/I/J пусты)', direction: 'DATA', group: 'completeness', severity: 'warning' },

  // Новые сигналы D2
  methodReasonMismatch: { key: 'methodReasonMismatch', label: 'Метод и обоснование несовместимы (ЕП + малая электронная)', direction: 'METHOD', group: 'field_validation', severity: 'warning', isNew: true },
  unmappedReasonEP:     { key: 'unmappedReasonEP', label: 'Обоснование ЕП не распознано', direction: '44FZ', group: 'field_validation', severity: 'warning', isNew: true },
  recentHotRow:         { key: 'recentHotRow', label: 'Горячая строка (> 10 правок за неделю)', direction: 'CHANGE', group: 'data_integrity', severity: 'info', isNew: true },
  statusOscillation:    { key: 'statusOscillation', label: 'Осцилляция статуса (L менялся ≥ 2 раз)', direction: 'CHANGE', group: 'data_integrity', severity: 'warning', isNew: true },
  lateFill:             { key: 'lateFill', label: 'Позднее заполнение (после контрольной даты)', direction: 'CHANGE', group: 'temporal', severity: 'info', isNew: true },
  bridgingContract:     { key: 'bridgingContract', label: 'Межгодовой контракт (2025 → 2026)', direction: 'SCHEDULE', group: 'temporal', severity: 'info', isNew: true },
  rollingPlan:          { key: 'rollingPlan', label: 'Rolling-планирование (по мере потребности)', direction: 'SCHEDULE', group: 'temporal', severity: 'info', isNew: true },
};

// ────────────────────────────────────────────────────────────
// 4. Helpers
// ────────────────────────────────────────────────────────────

/** Сигналы по направлению */
export function getSignalsByDirection(direction: SignalDirection): SignalKey[] {
  return (Object.keys(SIGNAL_TAXONOMY) as SignalKey[]).filter(
    k => SIGNAL_TAXONOMY[k].direction === direction,
  );
}

/** Новые сигналы D2 (ещё не интегрированы в signals.ts) */
export const NEW_D2_SIGNALS: readonly SignalKey[] = (Object.keys(SIGNAL_TAXONOMY) as SignalKey[])
  .filter(k => SIGNAL_TAXONOMY[k].isNew);
