import type { FastifyInstance } from 'fastify';
import {
  DEPARTMENTS, departmentCoverage, SourceCoverageSchema, findDept,
  DEPT_COLUMNS, DEPT_HEADER_ROWS, dayNumberOf, productCalendarDay,
  PRODUCT_UTC_OFFSET_HOURS, isMetaRow, isOrgItself, toNumber as sheetNumber,
  normalizeMethod, GRBS_BOOK_METHODS, classifyActivity, parseActivityScope,
  matchesActivityScope, isoOfDayNumber,
} from '@aemr/shared';
import { approvedEconomy } from '@aemr/core';
import { getStoredSnapshotById } from '../services/snapshot.js';
import { readDeptRows } from '../services/rows-read.js';
import { parseYearFilter, applySubordinateFilter } from '../services/rows-filters.js';

function sourceUnavailableMessage(dept: string, reason: 'read-error' | 'no-source'): string {
  return reason === 'read-error'
    ? `Книга управления «${dept}» не прочитана — проверьте доступ к таблице и обновите данные`
    : `Для управления «${dept}» не указана книга — задайте адрес таблицы в разделе «Источники» и обновите данные`;
}

/** Read-only scatter projection, isolated from write and editor routes. */
export async function scatterRoutes(app: FastifyInstance): Promise<void> {
  /** Recorded K/Y comparison. Financial meaning is source-defined, not inferred from columns. */
  app.get('/api/rows/scatter', async (request, reply) => {
    const query = request.query as Record<string, string>;
    if (query.snapshot_id !== undefined && (typeof query.snapshot_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(query.snapshot_id))) {
      return reply.status(400).send({ code: 'INVALID_SCOPE', message: 'Некорректный идентификатор снимка.' });
    }
    const frozen = query.snapshot_id ? getStoredSnapshotById(query.snapshot_id) : null;
    if (query.snapshot_id && !frozen) return reply.status(404).send({ code: 'SNAPSHOT_NOT_FOUND', message: 'Выбранный снимок больше недоступен. Текущее состояние вместо него не использовано.' });
    const frozenCoverage = SourceCoverageSchema.safeParse(frozen?.metadata.sourceCoverage);
    const filterDepts = query.dept?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
    const departments = filterDepts.length > 0
      ? DEPARTMENTS.filter(d => filterDepts.includes(d.id) || filterDepts.includes(d.nameShort)) : DEPARTMENTS;
    const year = parseYearFilter(query.year);
    const months = query.months?.split(',').map(Number) ?? [];
    const activities = query.activity ? query.activity.split(',').map(parseActivityScope) : ['all' as const];
    if ((query.year && query.year !== 'all' && (year === undefined || Number(query.year) !== year)) ||
        months.some(m => !Number.isInteger(m) || m < 1 || m > 12) ||
        (query.period && !/^(year|q[1-4])$/.test(query.period)) || activities.some(scope => scope === null) ||
        (query.type && !['competitive', 'single'].includes(query.type)) ||
        filterDepts.some(key => !departments.some(d => key === d.id || key === d.nameShort))) {
      return reply.status(400).send({ code: 'INVALID_SCOPE', message: 'Проверьте период, способ и управления в отборе.' });
    }
    const asOfInstant = frozen ? new Date(frozen.createdAt) : new Date();
    if (!Number.isFinite(asOfInstant.getTime())) return reply.status(500).send({
      code: 'INVALID_SNAPSHOT_TIME', message: 'Момент выбранного снимка не установлен. Исторические показатели не рассчитаны.',
    });
    const asOfDay = productCalendarDay(asOfInstant, PRODUCT_UTC_OFFSET_HOURS);
    const asOf = isoOfDayNumber(asOfDay);
    const points = [];
    const unreadDepartments: Array<{ department: string; reason: string }> = [];
    const excluded = { invalidAmount: 0, invalidDate: 0, futureFact: 0, unknownMethod: 0 };
    const POINT_LIMIT = 2500;
    let count = 0, limitTotal = 0, contractTotal = 0, economyTotal = 0;
    for (const dept of departments) {
      let values: unknown[][];
      if (frozen) {
        const entry = Object.entries(frozen.rowsByDept ?? {}).find(([name]) => findDept(name)?.latinId === dept.id);
        if (!entry || !frozenCoverage.success || !frozenCoverage.data.readDepartments.includes(dept.nameShort)) {
          unreadDepartments.push({ department: dept.nameShort, reason: 'Полнота книги в выбранном снимке не подтверждена.' });
          continue;
        }
        values = [[], [], [], ...entry[1]];
      } else {
        const read = await readDeptRows(dept);
        if (!read.ok) {
          unreadDepartments.push({ department: dept.nameShort, reason: sourceUnavailableMessage(dept.nameShort, read.reason) });
          continue;
        }
        values = read.values;
      }
      for (let i = DEPT_HEADER_ROWS; i < values.length; i++) {
        const row = values[i];
        if (!row) continue;
        const subject = String(row[DEPT_COLUMNS.SUBJECT] ?? '').trim();
        if (!subject || isMetaRow(subject)) continue;
        if (!activities.some(scope => scope !== null && matchesActivityScope(scope, row[DEPT_COLUMNS.TYPE]))) continue;
        if (query.search && !subject.toLowerCase().includes(query.search.toLowerCase())) continue;
        if (query.deptOnly?.split(',').some(id => id === dept.id || id === dept.nameShort) && !isOrgItself(row[DEPT_COLUMNS.SUBORDINATE])) continue;
        if (query.subordinate && applySubordinateFilter([{ subordinate: row[DEPT_COLUMNS.SUBORDINATE] }], query.subordinate).length === 0) continue;
        const planDay = dayNumberOf(row[DEPT_COLUMNS.PLAN_DATE]);
        const factDay = dayNumberOf(row[DEPT_COLUMNS.FACT_DATE]);
        if (planDay === null || factDay === null) { excluded.invalidDate++; continue; }
        const planDate = isoOfDayNumber(planDay);
        const month = Number(planDate.slice(5, 7)), planYear = Number(planDate.slice(0, 4));
        const quarter = Math.ceil(month / 3);
        if (year !== undefined && planYear !== year) continue;
        if (months.length > 0 ? !months.includes(month) : query.period && query.period !== 'year' && query.period !== `q${quarter}`) continue;
        if (factDay > asOfDay) { excluded.futureFact++; continue; }
        // GRBS master books accept only ЕП/ЭА. Other codes may be valid in
        // the separate procedures register, but they do not establish a
        // confirmed competitive method in this source's column L.
        const normalized = normalizeMethod(row[DEPT_COLUMNS.METHOD]);
        const method = normalized && GRBS_BOOK_METHODS.some(code => code === normalized)
          ? normalized : undefined;
        if (!method) { excluded.unknownMethod++; if (query.type) continue; }
        if ((query.type === 'competitive' && method === 'ЕП') || (query.type === 'single' && method !== 'ЕП')) continue;
        const planTotal = sheetNumber(row[DEPT_COLUMNS.TOTAL_PLAN]);
        const factTotal = sheetNumber(row[DEPT_COLUMNS.TOTAL_FACT]);
        if (planTotal === null || factTotal === null || planTotal <= 0 || factTotal <= 0) { excluded.invalidAmount++; continue; }
        const economy = approvedEconomy(row, asOfDay);
        count++; limitTotal += planTotal; contractTotal += factTotal; economyTotal += economy;
        if (points.length < POINT_LIMIT) points.push({
          id: row[0], rowIndex: i + 1, department: dept.nameShort,
          subject: String(row[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
          subordinate: String(row[DEPT_COLUMNS.SUBORDINATE] ?? '').trim(),
          planTotal, factTotal, limitReductionPercent: +((1 - factTotal / planTotal) * 100).toFixed(2),
          approvedEconomy: economy, activityType: classifyActivity(row[DEPT_COLUMNS.TYPE], row[DEPT_COLUMNS.PROGRAM_NAME]),
          procurementType: method ?? 'unknown', planDate, factDate: isoOfDayNumber(factDay), planYear, month, quarter,
        });
      }
    }
    const coverage = departmentCoverage(departments.map(d => d.nameShort),
      departments.map(d => d.nameShort).filter(name => !unreadDepartments.some(d => d.department === name)));
    if (coverage.readDepartments.length === 0 && departments.length > 0) return reply.status(503).send({
      code: 'SERVICE_UNAVAILABLE', message: 'Книги выбранных управлений не прочитаны. Облако закупок не построено.', coverage,
    });
    return reply.send({ points, total: count, sourceSnapshotId: frozen?.id ?? null, departments: departments.map(d => d.id), unreadDepartments, coverage,
      truncated: count > POINT_LIMIT, pointLimit: POINT_LIMIT, excluded, asOf,
      basis: 'plan_K_vs_recorded_fact_Y', unit: 'thousand_rubles',
      summary: { count, limitTotal, contractTotal, approvedEconomy: economyTotal,
        limitReductionPercent: limitTotal > 0 ? (1 - contractTotal / limitTotal) * 100 : null },
    });
  });
}
