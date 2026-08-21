/* ВРЕМЕННЫЙ замерочный файл — удаляется после снятия чисел. */
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SCRATCH = 'C:/Users/filat/AppData/Local/Temp/claude/C--Users-filat-dash/25733ef5-3a3b-462d-ae7a-02f5c41032ee/scratchpad';
const FIXTURE = `${SCRATCH}/mon-fresh.json`;

const lines: string[] = [];
const note = (t: string): void => void lines.push(t);

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

describe('замеры разбора книги мониторинга', () => {
  it('разбор + счёт на живых данных 21.08', async () => {
    if (!existsSync(FIXTURE)) {
      note('фикстуры нет — замер пропущен');
      return;
    }
    const sheets = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown[][]>;
    const core = await import('@aemr/core');
    const shared = await import('@aemr/shared');

    const rows = Object.values(sheets).reduce((s, v) => s + v.length, 0);
    note(`книга мониторинга 21.08: листов ${Object.keys(sheets).length}, строк ${rows}`);

    const N = 20;
    let t = process.hrtime.bigint();
    let registry!: ReturnType<typeof core.parseMonitoringProcedures>;
    for (let i = 0; i < N; i++) registry = core.parseMonitoringProcedures(sheets);
    const parseMs = ms(t) / N;

    t = process.hrtime.bigint();
    let journal!: ReturnType<typeof core.parseMonitoringJournal>;
    for (let i = 0; i < N; i++) journal = core.parseMonitoringJournal(sheets[core.MONITORING_JOURNAL_SHEET]);
    const journalMs = ms(t) / N;

    t = process.hrtime.bigint();
    let svod!: ReturnType<typeof core.parseMonitoringSvod>;
    for (let i = 0; i < N; i++) svod = core.parseMonitoringSvod(sheets[core.MONITORING_SVOD_SHEET]);
    const svodMs = ms(t) / N;

    const custs = registry.procedures.map((p) => ({
      customer: p.customer, customerNormalized: p.customerNormalized, dept: p.dept,
    }));
    t = process.hrtime.bigint();
    let directory!: ReturnType<typeof core.parseMonitoringDirectory>;
    for (let i = 0; i < N; i++) directory = core.parseMonitoringDirectory(sheets[core.MONITORING_DIRECTORY_SHEET], custs);
    const dirMs = ms(t) / N;

    t = process.hrtime.bigint();
    for (let i = 0; i < N; i++) core.aggregateMonitoring(registry);
    const aggMs = ms(t) / N;

    t = process.hrtime.bigint();
    for (let i = 0; i < N; i++) core.buildMonitoringSignals({ procedures: registry.procedures, journal, directory, svod });
    const sigMs = ms(t) / N;

    t = process.hrtime.bigint();
    for (let i = 0; i < N; i++) core.monitoringAnalytics(registry.procedures, { seasonBasis: 'publication' });
    const anaMs = ms(t) / N;

    t = process.hrtime.bigint();
    for (let i = 0; i < N; i++) core.compareSvodWithProduct(svod, core.productTotalsByDept(registry.procedures));
    const cmpMs = ms(t) / N;

    const payload = {
      procedures: registry.procedures,
      aggregates: core.aggregateMonitoring(registry),
      svod: { book: svod },
      journal,
      directory,
    };
    t = process.hrtime.bigint();
    let json = '';
    for (let i = 0; i < N; i++) json = JSON.stringify(payload);
    const jsonMs = ms(t) / N;

    const { sheetFingerprint } = await import('./sheet-fingerprint.js');
    t = process.hrtime.bigint();
    for (let i = 0; i < N; i++) for (const v of Object.values(sheets)) sheetFingerprint(v);
    const printMs = ms(t) / N;

    const parseTotal = parseMs + journalMs + svodMs + dirMs;
    note(`  разбор реестра ${parseMs.toFixed(1)} мс, переходящего реестра ${journalMs.toFixed(1)} мс, свода ${svodMs.toFixed(1)} мс, справочника ${dirMs.toFixed(1)} мс — итого разбор ${parseTotal.toFixed(1)} мс`);
    note(`  счёт: агрегаты ${aggMs.toFixed(1)} мс, сигналы ${sigMs.toFixed(1)} мс, аналитика ${anaMs.toFixed(1)} мс, сверка свода ${cmpMs.toFixed(1)} мс`);
    note(`  отдача: JSON.stringify ${jsonMs.toFixed(1)} мс, размер ответа ${(json.length / 1024).toFixed(0)} КБ`);
    note(`  отпечатки всех листов ${printMs.toFixed(2)} мс (ступень «изменилось ли»)`);
    note(`  ОДИН запрос /api/monitoring сегодня = разбор ${parseTotal.toFixed(1)} + агрегаты ${aggMs.toFixed(1)} + сверка ${cmpMs.toFixed(1)} + сигналы ${sigMs.toFixed(1)} = ${(parseTotal + aggMs + cmpMs + sigMs).toFixed(1)} мс процессорного времени`);
    note(`  четыре роута вкладки подряд = ${(4 * parseTotal + aggMs + cmpMs + sigMs + anaMs).toFixed(1)} мс (разбор повторяется на каждом)`);
    void shared;
  }, 300_000);

  it('запись итога', () => {
    writeFileSync(`${SCRATCH}/bench2.txt`, lines.join('\n'), 'utf8');
  });
});
