/**
 * Read-only portfolio for the existing control origins.
 *
 * This endpoint coordinates independent readers, never creates a second issue
 * database and never promotes events, monitor hints or the UER ledger into a
 * shared punitive score. Sources have separate timestamps: no atomic snapshot
 * is asserted. A failed reader stays visible instead of making "0 errors".
 */
import type { FastifyInstance } from 'fastify';
import {
  buildControlCases, buildControlPortfolio,
  type ControlChannelId, type ControlChannelObservation,
} from '@aemr/shared';
import { getSnapshot } from '../services/snapshot.js';
import { overlayPersistedIssueStatus } from '../services/issue-status-overlay.js';
import { buildIntegrityResponse } from './integrity.js';
import { buildTextHygieneResponse } from './text-hygiene.js';
import { buildWorkloadResponse } from './workload.js';
import { formulaDeliveryState } from '../services/source-refresh.js';
import { formulaVerdicts } from '../services/formula-sink.js';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { getMonitoringBook } from '../services/monitoring.js';
import { parsedMonitoringBook } from '../services/monitoring-parsed.js';
import { monitoringFormulaDiagnostics, queueDriftSignals } from '../services/monitoring-diagnostics.js';
import { MONITORING_MASTER_SHEET, buildMonitoringSignals, type MonitoringSignal } from '@aemr/core';

type Reading = Omit<ControlChannelObservation, 'id'>;

function observation(
  coverage: Reading['coverage'],
  findings: number | null,
  cases: number | null,
  checkedUnits: number | null,
  expectedUnits: number | null,
  sourceAsOf: string | null,
  note: string,
): Reading {
  return { coverage, observations: findings, cases, checkedUnits, expectedUnits, sourceAsOf, note };
}

async function planAndSvodRead(): Promise<{
  plan_checks: Reading;
  reconciliation: Reading;
}> {
  const snapshot = await getSnapshot(false);
  const cases = buildControlCases(overlayPersistedIssueStatus(snapshot.issues ?? []));
  const allIssues = cases.reduce((s, c) => s + c.observationCount, 0);
  const compared = snapshot.deltas?.filter(d => d.officialValue !== null && d.calculatedValue !== null
    && Number.isFinite(d.officialValue) && Number.isFinite(d.calculatedValue)) ?? [];
  const missing = (snapshot.deltas?.length ?? 0) - compared.length;
  const different = compared.filter(d => !d.withinTolerance).length;
  const isDemo = snapshot.id?.startsWith('demo') ?? false;
  const sourceAt = snapshot.createdAt ?? null;
  return {
    plan_checks: observation(
      'partial', allIssues, cases.length, null, null, sourceAt,
      isDemo
        ? 'Демо-снимок. Обнаруженные случаи нельзя считать результатом проверки рабочих книг.'
        : 'По последнему доступному снимку; полнота чтения всех источников проверяется отдельно. Наличие снимка не подтверждает свежесть данных.',
    ),
    reconciliation: observation(
      compared.length === 0 ? 'not_checked' : missing > 0 ? 'partial' : 'checked',
      compared.length ? different : null, null,
      compared.length, snapshot.deltas?.length ?? 0, sourceAt,
      compared.length
        ? `Сопоставимых показателей: ${compared.length}; расхождений: ${different}; без сравнения: ${missing}. Не означает проверку всех ячеек.`
        : 'Сопоставимых пар нет. Отсутствие найденных расхождений не означает корректности расчётов.',
    ),
  };
}

function formulaRead(): Reading {
  const delivery = formulaDeliveryState();
  const verdicts = formulaVerdicts();
  const expected = Object.keys(DEPARTMENT_SPREADSHEETS).length;
  const seen = new Set(verdicts.map(v => v.book));
  const findings = verdicts.reduce((sum, v) => sum + v.defects.length, 0);
  const checked = verdicts.reduce((sum, v) => sum + v.rowsJudged, 0);
  const asOf = verdicts.map(v => v.at).filter(Boolean).sort().at(-1) ?? null;
  const missing = expected - seen.size;
  return observation(
    !delivery.sinkConnected || seen.size === 0 ? 'not_checked' : missing > 0 ? 'partial' : 'checked',
    seen.size === 0 ? null : findings, null,
    seen.size === 0 ? null : checked, null,
    asOf,
    seen.size
      ? `Судились формулы в ${seen.size} из ${expected} книг, ${missing} ещё не охвачено. Ноль дефектов применим только к проверенным формулам.`
      : 'Нет полученных вердиктов формул. Не считать формулы исправными без чтения.',
  );
}

function integrityRead(): Reading {
  const data = buildIntegrityResponse();
  const checkedBooks = data.books.filter(b => b.rowsAvailable).length;
  const needed = data.books.length;
  const findings = data.totals.duplicates + data.totals.gapCount
    + data.totals.countableWithoutSeq + data.totals.dateFormat
    + (data.comparison?.vanishedTotal ?? 0);
  return observation(
    checkedBooks === 0 ? 'not_checked'
      : checkedBooks < needed || data.comparison === null ? 'partial' : 'checked',
    checkedBooks ? findings : null, null, checkedBooks, needed, data.asOf,
    checkedBooks
      ? `Проверены строки ${checkedBooks}/${needed} книг. Счётчик — признаки разных проверок, не уникальные ошибки; пропавшие строки учитываются только при наличии двух сопоставимых снимков.`
      : 'Строки рабочих книг недоступны; нумерация и ячейки дат не проверены.',
  );
}

async function textRead(): Promise<Reading> {
  const data = await buildTextHygieneResponse();
  const counted = data.totals.hygieneFindings + data.totals.languageFindings;
  return observation(
    data.rowsSource === 'none' || data.booksChecked.length === 0 ? 'not_checked'
      : data.booksSilent.length ? 'partial' : 'checked',
    data.booksChecked.length ? counted : null, null,
    data.booksChecked.length ? data.totals.cellsChecked : null, null,
    data.asOf,
    data.booksChecked.length
      ? `Гигиена и язык: ${data.booksChecked.length} книг проверены, ${data.booksSilent.length} не прочитано. Это находки текста, не дисциплинарные взыскания.`
      : 'Не удалось проверить ни одной текстовой ячейки.',
  );
}

async function monitoringRead(): Promise<Reading> {
  const book = await getMonitoringBook(false);
  if (!book.sheets[MONITORING_MASTER_SHEET]) {
    return observation('not_checked', null, null, null, null, book.readAt,
      'Мастер-реестр процедур не прочитан. По нему отсутствует подтверждённый результат проверки.');
  }
  const { registry, journal, directory, svod } = parsedMonitoringBook(book);
  const source = buildMonitoringSignals({
    procedures: registry.procedures, sourceIssues: registry.sourceIssues,
    journal, directory, svod,
  });
  const additional = queueDriftSignals(book, registry.procedures);
  let formula: MonitoringSignal[] = [];
  let formulaCheckFailed = false;
  try { formula = (await monitoringFormulaDiagnostics(book)).signals; }
  catch { formulaCheckFailed = true; }
  const total = [...source, ...additional, ...formula].reduce((sum, s) => sum + s.count, 0);
  const missingSheets = Object.keys(book.failed).length;
  return observation(
    missingSheets > 0 || formulaCheckFailed ? 'partial' : 'checked',
    total, null, registry.procedures.length, null, book.readAt,
    `Процедуры: ${registry.procedures.length}. Отдельные сигналы могут относиться к одному объекту. Не учтена независимая сверка с книгами ГРБС (/monitoring/match), её результаты нельзя выдумывать. ${missingSheets || formulaCheckFailed ? 'Часть источника или проверок недоступна.' : ''}`,
  );
}

async function workloadRead(): Promise<Reading> {
  const data = await buildWorkloadResponse();
  return observation(
    data.booksMeasured === 0 ? 'not_checked' : data.booksSilent.length ? 'partial' : 'checked',
    data.events.added + data.events.cleared + data.events.edits, null,
    data.booksMeasured, data.booksTotal, data.asOf,
    'Наблюдаемые изменения из _ChangeLog, не подтверждённые полезные действия исполнителей. Авторство и эффект проверяются отдельно; удаления журнал не фиксирует.',
  );
}

/** Each source fails independently: no one-off Google outage turns all zeros green. */
export function controlPortfolioRoutes(app: FastifyInstance): void {
  app.get('/api/control/portfolio', async (_request, reply) => {
    const at = new Date().toISOString();
    const reads = await Promise.allSettled([
      planAndSvodRead(),
      Promise.resolve().then(formulaRead),
      Promise.resolve().then(integrityRead),
      textRead(),
      monitoringRead(),
      workloadRead(),
    ] as const);

    const data: Partial<Record<ControlChannelId, Reading>> = {};
    const groups: ControlChannelId[][] = [
      ['plan_checks', 'reconciliation'], ['formula_integrity'],
      ['book_integrity'], ['text_hygiene'], ['procedure_monitoring'], ['workload_events'],
    ];
    reads.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        if (i === 0) Object.assign(data, result.value);
        else data[groups[i][0]] = result.value as Reading;
      } else {
        for (const id of groups[i]) {
          data[id] = observation('failed', null, null, null, null, null,
            'Не удалось выполнить чтение этого контура: нет оснований считать его проверенным.');
        }
        app.log.warn({ origin: groups[i], err: result.reason }, 'control/portfolio: source unavailable');
      }
    });

    // Official UER recommendation ledger is independently authoritative and
    // may be updated only through authenticated report workflows. We expose
    // provenance and location without reading or modifying the ledger here.
    data.uer_recommendations = observation(
      'separate_authority', null, null, null, null, null,
      'Официальные решения УЭР сохраняются в RecommendationLedger. Их нельзя считать автоматическими замечаниями, погашать пропаданием сигнала или изменять из этой сводки.',
    );

    return reply.send(buildControlPortfolio(at, data));
  });
}
