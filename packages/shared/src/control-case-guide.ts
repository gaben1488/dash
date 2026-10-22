/**
 * Read-only, human-oriented route through one canonical control case.
 *
 * Every step is a truthful instruction or a documented source observation.
 * It is NOT an automatic fix, legal judgement, verified closure or new KPI.
 * Keep the guidance in one place for Control / Recommendations / Discipline.
 */
import type { ControlCase, ControlImpact } from './control-cases.js';

export type ControlGuideStepId = 'understand' | 'evidence' | 'action' | 'recheck';

export interface ControlGuideStep {
  id: ControlGuideStepId;
  title: string;
  description: string;
  /** Whether we can presently prove this step from the case itself. */
  proven: boolean;
}

export interface ControlCaseGuide {
  currentInstruction: string;
  whoCanHelp: string;
  confirmedFinding: string;
  potentialConsequence: string;
  sourceAddress: string;
  verificationRequired: boolean;
  steps: readonly [ControlGuideStep, ControlGuideStep, ControlGuideStep, ControlGuideStep];
}

const GUIDANCE: Record<ControlImpact, {
  finding: string;
  effect: string;
  owner: string;
  action: string;
}> = {
  source_unavailable: {
    finding: 'Часть источника или проверка не отработала.',
    effect: 'Числа из непроверенного участка нельзя считать подтверждёнными. Это техническая проблема наблюдаемости, не нарушение исполнителя.',
    owner: 'Администратор Dash или источника данных',
    action: 'Проверить доступность книги и ошибку чтения, затем заново выполнить проверку. Не исправлять содержимое закупки только из-за сбоя связи.',
  },
  observed_discrepancy: {
    finding: 'Официальные и самостоятельно рассчитанные показатели разошлись.',
    effect: 'Расхождение установлено, но пока не доказано, какая сторона неверна и какое решение затронуто.',
    owner: 'Ответственный за сверку и методику расчёта',
    action: 'Открыть оба значения, проверить год, единицы, состав строк и формулы. Зафиксировать установленную первопричину до исправления.',
  },
  calculation_possible: {
    finding: 'Обнаружен признак, который может изменить расчёт.',
    effect: 'Возможны отклонение итогов, выпадение строк или неверный период. Денежный эффект ещё не рассчитан.',
    owner: 'Владелец формулы или исходных данных',
    action: 'Сверить указанную ячейку с исходным правилом и пересчитать затронутые суммы. Не назначать финансовый ущерб из одного сигнала.',
  },
  legal_review: {
    finding: 'Есть обстоятельство для проверки правового основания.',
    effect: 'Автоматический признак не устанавливает нарушение 44-ФЗ и не подтверждает вину.',
    owner: 'Профильный закупщик или юрист',
    action: 'Установить пункт законного основания, вид заказчика, год, применимые исключения и первичные документы. Только после этого принимать решение.',
  },
  source_data: {
    finding: 'Обнаружена неоднозначность или неполнота данных источника.',
    effect: 'Неизвестно, мешает ли она конкретному расчёту или цифровому переносу, пока не определён затронутый объект.',
    owner: 'Ответственный за сведения в рабочей книге',
    action: 'Проверить первичное значение и смысл обязательного поля, исправить подтверждённую ошибку в исходной книге, сохранив историю.',
  },
  process_review: {
    finding: 'Нужно уточнить состояние закупки или исполнения.',
    effect: 'Отклонение от ожидаемого состояния не обязательно является ошибкой или просрочкой.',
    owner: 'Исполнитель процесса или руководитель по компетенции',
    action: 'Уточнить фактическую стадию, обязательный срок, принятое решение и зависимость от других участников. Законное ожидание не подменять дефектом.',
  },
  unclassified: {
    finding: 'Признак обнаружен, но его причина и значение не классифицированы.',
    effect: 'Нельзя автоматически делать вывод о влиянии, обязанности исправлять или размере ущерба.',
    owner: 'Ответственный за методику проверки',
    action: 'Уточнить исходное правило, применимость и доказательство. Не изменять данные по неподтверждённой подсказке.',
  },
};

/** One location can be a sheet-level issue without a row or cell. */
export function controlCaseSourceAddress(c: Pick<ControlCase, 'departmentId' | 'sheet' | 'row' | 'rowSeq' | 'cell'>, departmentLabel?: string): string {
  const bits = [departmentLabel || c.departmentId || 'Управление не установлено'];
  if (c.sheet) bits.push(`лист «${c.sheet}»`);
  if (c.row !== null) bits.push(`строка ${c.row}`);
  if (c.rowSeq) bits.push(`№ п/п ${c.rowSeq}`);
  if (c.cell) bits.push(`ячейка ${c.cell}`);
  if (!c.sheet && c.row === null && !c.cell) bits.push('точный адрес не установлен');
  return bits.join(' · ');
}

/** Never translate a human click on "resolved" into a proven fix. */
export function buildControlCaseGuide(c: ControlCase, departmentLabel?: string): ControlCaseGuide {
  const info = GUIDANCE[c.impact];
  const sourceAddress = controlCaseSourceAddress(c, departmentLabel);
  const evidenceProof = c.issueIds.length > 0;
  const stateNote = c.workState === 'needs_reverification'
    ? 'Исправление отмечено, но ещё не подтверждено независимым чтением и пересчётом.'
    : c.workState === 'false_positive'
      ? 'Признак признан ложным; сохраните обоснование для возможного повторного обнаружения.'
      : c.workState === 'exception_recorded'
        ? 'Есть принятое исключение; его основание и применимость должны оставаться проверяемыми.'
        : c.workState === 'mixed'
          ? 'У связанных наблюдений разные статусы. Сначала согласуйте решение по каждому, не закрывая весь вопрос автоматически.'
          : c.workState === 'in_progress'
            ? 'Работа начата; завершение не подтверждено повторной проверкой.'
            : c.workState === 'acknowledged'
              ? 'Вопрос принят к рассмотрению, но результат ещё не подтверждён.'
              : 'Начните с проверки первичных данных; не меняйте их только из-за цвета предупреждения.';
  const conflict = c.recommendationConflict
    ? 'Источники предлагают несовместимые действия. Автоматический выбор запрещён — требуется решение специалиста.'
    : '';
  const recommended = c.recommendation && c.impact !== 'legal_review'
    ? ` Предложение исходной проверки: ${c.recommendation}`
    : '';
  const instruction = [stateNote, conflict, info.action, recommended].filter(Boolean).join(' ');

  return {
    currentInstruction: instruction,
    whoCanHelp: info.owner,
    confirmedFinding: info.finding,
    potentialConsequence: info.effect,
    sourceAddress,
    verificationRequired: true,
    steps: [
      {
        id: 'understand', title: 'Причина',
        description: `${info.finding} ${info.effect}`,
        proven: c.verifiedImpact,
      },
      {
        id: 'evidence', title: 'Доказательства',
        description: `Исходных наблюдений: ${c.observationCount}. ${sourceAddress}. Постоянные идентификаторы исходных замечаний сохранены; группировка относится только к текущему снимку.`,
        proven: evidenceProof,
      },
      {
        id: 'action', title: 'Действие',
        description: `${info.owner}. ${instruction}`,
        proven: false,
      },
      {
        id: 'recheck', title: 'Перепроверка',
        description: 'После решения требуется новое чтение первоисточника, повтор этой проверки и пересчёт затронутых показателей. Нажатие «Исправлено» и исчезновение сигнала при неполном чтении не подтверждают результат.',
        proven: false,
      },
    ],
  };
}
