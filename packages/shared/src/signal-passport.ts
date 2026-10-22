/** C06.01: one evidence-aware rule passport; a rule is not a proven source fact. */
import { CHECK_REGISTRY } from './check-registry.js';
import { SIGNAL_ANSWER_RULES } from './signal-answer.js';
import type { Issue, IssueStatus } from './types.js';

type Case = Partial<Pick<Issue, 'checkId'|'signal'|'category'|'departmentId'|'sheet'|'row'|'rowSeq'|'cell'|'status'>>;
export type SignalDisposition = 'excluded_false_positive' | 'requires_source_readback' | 'current_observation';

export function signalDisposition(status: IssueStatus | undefined): SignalDisposition {
  if (status === 'false_positive') return 'excluded_false_positive';
  if (status === 'resolved') return 'requires_source_readback';
  return 'current_observation';
}
export function isCurrentSignal(issue: { status?: unknown }): boolean {
  return issue.status !== 'false_positive';
}
const NON_PUNITIVE = new Set([
  'foreign_year_execution','fact_without_date','fact_date_before_plan',
  'future_economy_decision','plan_year_missing','finance_delay','single_participant',
]);
const OLD_NON_PUNITIVE = new Set([
  'foreignYearExecution','factWithoutDate','factDateBeforePlan','planYearMissing',
  'economyDecisionUpcoming','financeDelay','singleParticipant',
]);
export function isNonPunitiveSignal(issue: { checkId?: unknown; signal?: unknown; category?: unknown }): boolean {
  if (NON_PUNITIVE.has(String(issue.checkId ?? ''))) return true;
  const signal = String(issue.signal ?? String(issue.category ?? '').replace(/^signal:/, ''));
  return OLD_NON_PUNITIVE.has(signal);
}

export interface SignalPassport {
  checkId: string;
  name: string;
  registered: boolean;
  applicability: string;
  evidence: {
    columns: readonly string[];
    geometry: 'dept'|'svod'|'unknown';
    address: string|null;
    readableFromIssue: boolean;
  };
  addressee: string;
  action: string;
  status: IssueStatus|'unknown';
  disposition: SignalDisposition;
  closure: string;
  qualification: string;
}

const SPECIAL: Readonly<Record<string,{applicability:string; addressee:string; qualification:string}>> = {
  future_economy_decision: {
    applicability:'Будущая Q: незавершённая потребность и её остаток не являются полученной экономией.',
    addressee:'Владелец годовой потребности',
    qualification:'Не подтверждает официальную экономию, свободные средства или вину исполнителя.',
  },
  plan_year_missing: {
    applicability:'Плановая дата N и производный год P отсутствуют при положительном плане и указанном способе.',
    addressee:'ГРБС совместно с ответственным за подтверждение финансирования',
    qualification:'Вопрос финансирования, не вывод о виновности сотрудника, заполняющего книгу.',
  },
  future_fact_date: {
    applicability:'Q позже даты среза: заключение на эту дату не подтверждено.',
    addressee:'Владелец позиции и источника даты',
    qualification:'Будущая Q не подтверждает договор и не является автоматически ошибкой.',
  },
  anti_dumping: {
    applicability:'Большая разница K и Y требует проверки первичных документов конкретной процедуры.',
    addressee:'Ответственный за закупку и юридическую проверку',
    qualification:'Антидемпинг по K−Y не устанавливается: нужны НМЦК, цена и условия процедуры.',
  },
  ep_risk: {
    applicability:'Годовая потребность ЕП требует раздельной проверки основания и цены каждого договора.',
    addressee:'Ответственный за ЕП и проверку основания',
    qualification:'Годовая сумма K/Y сама по себе не устанавливает нарушение 44-ФЗ.',
  },
};

export function signalPassportForIssue(issue: Case): SignalPassport {
  const key = String(issue.checkId ?? '').trim();
  const signal = String(issue.signal ?? String(issue.category ?? '').replace(/^signal:/, ''));
  const entry = CHECK_REGISTRY.find(c =>
    c.id === key || c.legacyId === key || c.legacyId === signal || c.id === signal);
  const id = entry?.id ?? (key || signal || 'unknown');
  const rule = Object.prototype.hasOwnProperty.call(SIGNAL_ANSWER_RULES, id)
    ? SIGNAL_ANSWER_RULES[id] : undefined;
  const match = typeof issue.cell === 'string' ? /^([A-Z]{1,3})\d+$/i.exec(issue.cell) : null;
  const columns:readonly string[] = rule?.evidence ?? (match?.[1] ? [match[1].toUpperCase()] : []);
  const special = Object.prototype.hasOwnProperty.call(SPECIAL, id) ? SPECIAL[id] : undefined;
  const status = issue.status ?? 'unknown';
  const address = typeof issue.sheet === 'string' && issue.sheet.trim()
    ? (issue.cell ? issue.sheet + '!' + issue.cell
      : Number.isInteger(issue.row) && (issue.row ?? 0) > 0
        ? issue.sheet + '!строка ' + issue.row : issue.sheet)
    : null;
  const closure = status === 'false_positive'
    ? 'Ложное срабатывание исключено из текущих рисков; исходное наблюдение и основание решения остаются в истории.'
    : status === 'resolved'
      ? 'Исправление заявлено, но сохраняющийся сигнал требует повторной проверки первичного источника.'
      : status === 'wont_fix'
        ? 'Решение не исправлять сохранено: сигнал и риск не исчезли, основание доступно в истории.'
        : 'Комментарий сам по себе не закрывает дело: необходимы решение и проверка исходных данных.';
  return {
    checkId:id, name:entry?.name ?? 'Класс не зарегистрирован', registered:!!entry,
    applicability:special?.applicability ?? rule?.condition ?? entry?.description
      ?? 'Применимость неизвестной проверки не установлена, требуется исходный паспорт.',
    evidence:{
      columns,geometry:rule?.geometry ?? 'unknown',address,
      readableFromIssue:address !== null && columns.length > 0,
    },
    addressee:special?.addressee ??
      (issue.departmentId ? 'Ответственный за исходный реестр ГРБС' : 'Владелец первичного источника (не назначен автоматически)'),
    action:entry?.recommendation ?? 'Действие требует уточнения владельцем проверки.',
    status,disposition:signalDisposition(issue.status),closure,
    qualification:special?.qualification ??
      'Сигнал требует проверки первичных данных. Нарушение и финансовый результат автоматически не устанавливаются.',
  };
}
