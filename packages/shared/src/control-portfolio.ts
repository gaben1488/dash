/**
 * Control source catalog: the sole vocabulary for the *origins* of findings.
 *
 * A source is not another problem, and a raw observation is not a unique
 * actionable case. These channels are not summed into a pseudo-KPI.
 * The catalog deliberately preserves official recommendations and _ChangeLog
 * events as different kinds of evidence/decisions.
 */
export type ControlChannelId =
  | 'plan_checks'
  | 'reconciliation'
  | 'formula_integrity'
  | 'book_integrity'
  | 'text_hygiene'
  | 'procedure_monitoring'
  | 'workload_events'
  | 'uer_recommendations';

export type ControlChannelKind = 'finding' | 'verification' | 'activity' | 'official_decision';
export type ControlSourceCoverage = 'checked' | 'partial' | 'not_checked' | 'failed' | 'separate_authority';

export interface ControlChannelDefinition {
  id: ControlChannelId;
  title: string;
  kind: ControlChannelKind;
  /** Existing section where raw evidence and its specific actions are managed. */
  existingHome: string;
  /** No new arbitrary navigator: this is one existing top-level route. */
  page: 'quality' | 'discipline' | 'monitoring' | 'report';
  /** Which component remains authoritative for the raw data. */
  producer: string;
  purpose: string;
  nextStep: string;
}

export const CONTROL_CHANNELS: readonly ControlChannelDefinition[] = [
  {
    id: 'plan_checks', title: 'Замечания план-реестров', kind: 'finding',
    existingHome: 'Контроль → Замечания', page: 'quality',
    producer: 'Core pipeline, CHECK_REGISTRY, Issue + SQLite review',
    purpose: 'Построчные проверки и зафиксированные решения по ним.',
    nextStep: 'Разобрать исходную проверку и привязанный к ней вопрос; для устранения перечитать источник.',
  },
  {
    id: 'reconciliation', title: 'Сверка с официальными числами', kind: 'verification',
    existingHome: 'Контроль → Сверка', page: 'quality',
    producer: 'snapshot.deltas / reconciliation engine',
    purpose: 'Достоверность сопоставимых значений, а не штраф исполнителя.',
    nextStep: 'Сравнить обе стороны, год и периметр; определить первопричину расхождения.',
  },
  {
    id: 'formula_integrity', title: 'Целостность формул', kind: 'verification',
    existingHome: 'Контроль → Замечания → Целостность формул', page: 'quality',
    producer: 'formula sink + formula verdicts',
    purpose: 'Состояние чтения и проверок формул; непроверенное не считается правильным.',
    nextStep: 'Открыть точную ячейку и эталон, затем проверить перерасчёт зависимых показателей.',
  },
  {
    id: 'book_integrity', title: 'Целостность плановых книг', kind: 'finding',
    existingHome: 'Контроль → Замечания → Целостность книг', page: 'quality',
    producer: '/api/integrity: sequence, date formats, vanished/moved rows',
    purpose: 'Нумерация, повреждённые типы дат, пропавшие между снимками строки.',
    nextStep: 'Проверить исходный лист, историю и идентичность строки; не восстанавливать удалённое по догадке.',
  },
  {
    id: 'text_hygiene', title: 'Гигиена исходного текста', kind: 'finding',
    existingHome: 'Контроль → Замечания → Гигиена текста', page: 'quality',
    producer: '/api/text-hygiene',
    purpose: 'Ограниченные проверки текстовых ячеек и варианты исправления.',
    nextStep: 'Проверить значение и предложенную замену, исправить только подтверждённое.',
  },
  {
    id: 'procedure_monitoring', title: 'Контроль процедур', kind: 'finding',
    existingHome: 'Мониторинг → Сигналы и процедуры в работе', page: 'monitoring',
    producer: 'monitoring signals / procedure registry',
    purpose: 'Стадии процедур, очередь и независимые источниковые расхождения.',
    nextStep: 'Открыть процедуру и её источник; не переносить автоматически стадии в план.',
  },
  {
    id: 'workload_events', title: 'Работа и события', kind: 'activity',
    existingHome: 'Дисциплина → Нагрузка', page: 'discipline',
    producer: '/api/workload / _ChangeLog / action history',
    purpose: 'Наблюдаемые изменения, а не доказанная продуктивность конкретного сотрудника.',
    nextStep: 'Сопоставить событие с ответственным заданием, результатом и доказательством.',
  },
  {
    id: 'uer_recommendations', title: 'Официальные рекомендации УЭР', kind: 'official_decision',
    existingHome: 'Отчёт → Реестр рекомендаций УЭР', page: 'report',
    producer: 'RecommendationLedger and report-recommendations',
    purpose: 'Официальная, версионированная позиция уполномоченного лица; не равна автоматическому совету.',
    nextStep: 'Проверить источник, редакцию, подтверждённое решение и связь с процедурами.',
  },
] as const;

export interface ControlChannelObservation {
  id: ControlChannelId;
  coverage: ControlSourceCoverage;
  /** Raw observations are not unique cases and cannot be added across channels. */
  observations: number | null;
  /** Only the plan_checks source has a verified case grouping in the current release. */
  cases: number | null;
  /** Number of comparable rows/cells/metric pairs; units are source-specific. */
  checkedUnits: number | null;
  expectedUnits: number | null;
  sourceAsOf: string | null;
  note: string;
}

export interface ControlChannelView extends ControlChannelDefinition, ControlChannelObservation {}

export interface ControlPortfolioView {
  assembledAt: string;
  /** These snapshots come from different moments; never label this atomic. */
  atomicAcrossSources: false;
  channels: ControlChannelView[];
  /** Counters are NOT summed; the same row can produce findings in multiple channels. */
  uniqueCrossSourceCasesVerified: false;
}

/** Consistent failure and unknown reporting for all submodules. */
export function buildControlPortfolio(
  assembledAt: string,
  observations: Partial<Record<ControlChannelId, Omit<ControlChannelObservation, 'id'>>>,
): ControlPortfolioView {
  return {
    assembledAt,
    atomicAcrossSources: false,
    uniqueCrossSourceCasesVerified: false,
    channels: CONTROL_CHANNELS.map((source) => {
      const observed = observations[source.id];
      return {
        ...source,
        id: source.id,
        coverage: observed?.coverage ?? 'not_checked',
        observations: observed?.observations ?? null,
        cases: observed?.cases ?? null,
        checkedUnits: observed?.checkedUnits ?? null,
        expectedUnits: observed?.expectedUnits ?? null,
        sourceAsOf: observed?.sourceAsOf ?? null,
        note: observed?.note ?? 'Источник ещё не опрошен: отсутствие сведений не означает отсутствия дефектов.',
      };
    }),
  };
}
