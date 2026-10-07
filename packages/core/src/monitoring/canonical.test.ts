import { describe, expect, it } from 'vitest';
import { aggregateMonitoring, monitoringWorkQueue, parseMonitoringProcedures } from './procedures.js';
import { buildMonitoringSignals } from './signals.js';
import { procedureRowsForMatch } from './cross-check.js';
import { matchMonitoring } from '../pipeline/monitoring-match.js';
import { parseMonitoringSvod } from './svod.js';

const sheet = 'Рабочий реестр процедур';
const headers = ['Код процедуры', 'Вид строки', 'Флаг протокола', 'Комментарий', 'Управление', 'Заказчик', 'Наименование объекта закупки', 'НМЦК', 'Дата поступления заявки в уполномоченный орган', 'Дата публикации', 'Дата окончания подачи заявок', 'Дата подведения итогов', 'Цена по итогам', 'ФБ', 'КБ', 'МБ', 'Экономия', 'Победитель', 'ИНН победителя', 'Результат', 'Предок', 'Наследник', 'Стадия', 'Требуемое действие', 'Замечания'];
function row(code: string, result = '', stage = 'Объявлена'): unknown[] {
  const r: unknown[] = Array(25).fill('');
  r[0] = code; r[4] = 'Управление образования'; r[5] = 'Синтетический заказчик';
  r[6] = `${code} Синтетический предмет`; r[7] = 100; r[8] = '01.09.2026';
  r[9] = '20.09.2026'; r[10] = '10.10.2026'; r[11] = '12.10.2026';
  r[19] = result; r[22] = stage; return r;
}
function parse(rows: unknown[][]) { return parseMonitoringProcedures({ [sheet]: [[], headers, ...rows] }); }

describe('канонический реестр', () => {
  it('не вычитает цену без НМЦК из экономии полного портфеля', () => {
    const a = row('ЭА100-26', 'Состоялась', 'Состоялась');
    a[7] = ''; a[11] = '01.09.2026'; a[12] = 100;
    const b = row('ЭА101-26', 'Состоялась', 'Состоялась');
    b[7] = 200; b[11] = '01.09.2026'; b[12] = 150;
    const p = aggregateMonitoring(parse([a, b]));
    expect(p.awarded.priceTotal).toBe(250);
    expect(p.awarded.savingsTotal).toBe(50);
  });
  it('канонический ответ не читает комментарий D, но сохраняет флаг протокола C', () => {
    const a = row('ЭА100-26'); a[2] = 'Флаг из источника'; a[3] = 'Свободный комментарий';
    expect(parse([a]).procedures[0]).toMatchObject({ comment: null, protocolFlag: 'Флаг из источника' });
  });
  it('один свободный комментарий не создаёт процедуру без кода', () => {
    const note = Array(25).fill(''); note[3] = 'Свободная заметка';
    expect(parse([note]).procedures).toEqual([]);
  });
  it.each([['ЭАС06-25', 'ЭАС6-25'], ['ЭАС06/02-25', 'ЭАС6/2-25']])('код %s сохраняется для отображения, доля сопоставляется', (sourceCode, key) => {
    const parent = row(sourceCode, 'Состоялась', 'Состоялась'); parent[1] = 'процедура';
    const share = row(sourceCode); share[1] = 'доля'; share[7] = 40;
    const registry = parse([parent, share]);
    expect(registry.procedures[0].code).toBe(key);
    expect(registry.procedures[0].sourceCode).toBe(sourceCode);
    expect(registry.procedures[0].defects).toEqual([]);
    expect(registry.procedures[0].participants).toHaveLength(1);
    expect(registry.sourceIssues).toEqual([]);
  });
  it('читает один мастер и не дублирует его устаревшими листами', () => {
    const p = parse([row('ЭА100-26')]);
    expect(p.procedures).toHaveLength(1);
    expect(p.procedures[0]).toMatchObject({ sheet, row: 3, code: 'ЭА100-26', dept: 'УО', subject: 'Синтетический предмет', stage: 'published' });
  });
  it('не выводит результат из цены и сохраняет пустоту несостоявшейся процедуры', () => {
    const pending = row('ЭА100-26'); pending[12] = 50;
    pending[16] = 50; pending[15] = 50;
    const cancelled = row('ЭА101-26', 'Отмена по решению заказчика', 'Не состоялась');
    const [a, b] = parse([pending, cancelled]).procedures;
    expect(a.stage).toBe('published'); expect(a.reductionRub).toBeNull();
    expect(aggregateMonitoring(parse([pending])).savingsBookTotal).toBe(0);
    expect(b.stage).toBe('no_result'); expect(b.auctionPrice).toBeNull(); expect(b.savingsTotal).toBeNull();
    expect(buildMonitoringSignals({ procedures: [b], journal: { rows: [], edges: [], chains: [], outsideFilterCount: 0 } }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'monitoring_no_successor' })]));
  });
  it('будущий итог не входит в денежный факт, но структурный результат сохраняется', () => {
    const r = row('ЭА100-26', 'Состоялась', 'Состоялась'); r[12] = 80; r[16] = 20; r[15] = 20;
    const registry = parseMonitoringProcedures({ [sheet]: [[], headers, r] }, '2026-10-06');
    expect(registry.procedures[0].stage).toBe('awarded');
    expect(registry.procedures[0].factsEligible).toBe(false);
    expect(aggregateMonitoring(registry).awarded.priceTotal).toBe(0);
    expect(aggregateMonitoring(registry).savingsBookTotal).toBe(0);
  });
  it('доли не увеличивают число процедур или районную НМЦК', () => {
    const parent = row('ЭАС100-26', 'Состоялась', 'Состоялась'); parent[1] = 'процедура'; parent[4] = 'Совместные'; parent[12] = 80; parent[16] = 20;
    const a = row('ЭАС100-26'); a[1] = 'доля'; a[7] = 40;
    const b = row('ЭАС100-26'); b[1] = 'доля'; b[4] = 'Управление экономического развития'; b[7] = 60;
    const registry = parse([parent, a, b]);
    expect(registry.procedures).toHaveLength(1);
    expect(aggregateMonitoring(registry).nmckTotal).toBe(100);
    expect(registry.procedures[0]).toHaveProperty('participants', expect.arrayContaining([expect.objectContaining({ dept: 'УО', nmck: 40 }), expect.objectContaining({ dept: 'УЭР', nmck: 60 })]));
  });
  it('доля без родителя остаётся адресным сигналом, не отдельной процедурой', () => {
    const share = row('ЭАС100-26'); share[1] = 'доля';
    const registry = parse([share]);
    expect(registry.procedures).toHaveLength(0);
    expect(registry.sourceIssues).toEqual(expect.arrayContaining([expect.objectContaining({ address: `${sheet}!A3` })]));
  });
  it('свод соблюдает допуск одной копейки нового канона', () => {
    const r: unknown[] = Array(18).fill(0); r[0] = 'УО'; r[9] = .01;
    expect(parseMonitoringSvod([[], ['Управление'], r]).rows[0].controlAgrees).toBe(true);
  });
  it('план управления сверяется с его явной долей, а не с полной ценой совместной закупки', () => {
    const parent = row('ЭАС100-26', 'Состоялась', 'Состоялась'); parent[1] = 'процедура'; parent[4] = 'Совместные'; parent[12] = 80;
    const share = row('ЭАС100-26'); share[1] = 'доля'; share[7] = 40; share[12] = 30;
    const registry = parse([parent, share]);
    const out = matchMonitoring([{ book: 'УО', rowKey: 'УО:4', ag: 'ЭАС100-26', planTotalThousands: .04, factTotalThousands: .03 }], procedureRowsForMatch(registry.procedures));
    expect(out.matched[0].nmck).toMatchObject({ monitoringRub: 40, agrees: true });
    expect(out.matched[0].fact).toMatchObject({ monitoringRub: 30, agrees: true });
  });
  it('дубль ключа в единственном мастере не разрешается выбором ближайшей суммы', () => {
    const a = row('ЭА100-26'); const b = row('ЭА100-26'); b[7] = 40;
    const out = matchMonitoring([{ book: 'УО', rowKey: 'УО:4', ag: 'ЭА100-26', planTotalThousands: .04, factTotalThousands: null }], procedureRowsForMatch(parse([a, b]).procedures));
    expect(out.matched).toHaveLength(0);
    expect(out.ambiguous).toHaveLength(1);
  });
  it('переоформление учитывает отдельной стадией и исключает переданные суммы из плана', () => {
    const r = row('ЭА100-26', 'Нет заявок', 'Переоформлена'); r[21] = 'ЭА101-26';
    const registry = parse([r]);
    expect(registry.procedures[0].stage).toBe('reissued');
    expect(aggregateMonitoring(registry).nmckTotal).toBe(0);
  });
  it('сохраняет настоящий сигнал вместе с адресом исходной колонки', () => {
    const r = row('ЭА100-26'); r[23] = 'Исправить: НМЦК'; r[24] = 'Ошибка: Текст в числовой колонке — H';
    expect(parse([r]).procedures[0].defects).toEqual(expect.arrayContaining([expect.objectContaining({ address: `${sheet}!H3`, note: r[24] })]));
  });
  it('останавливает чтение при сдвиге колонок вместо незаметно неверных чисел', () => {
    const wrong = [...headers]; [wrong[7], wrong[12]] = [wrong[12], wrong[7]];
    expect(() => parseMonitoringProcedures({ [sheet]: [[], wrong, row('ЭА100-26')] })).toThrow(/MONITORING_SCHEMA/u);
  });
  it('не принимает вычисленную закрытую стадию без первичного результата', () => {
    expect(parse([row('ЭА100-26', '', 'Состоялась')]).procedures[0].stage).toBe('unknown');
  });
  it('не теряет закрытую процедуру с незаполненными обязательными датами', () => {
    const r = row('ЭЕП29-26', 'Состоялась', 'Состоялась');
    r[24] = 'Неполно: Нет даты итогов — L';
    expect(monitoringWorkQueue(parse([r]).procedures, '2026-10-06').closed).toHaveLength(1);
  });
  it('справочная пометка не становится замечанием или постоянной задачей', () => {
    const r = row('ЭА230-26', 'Состоялась', 'Состоялась');
    r[24] = 'Справка: Протокол с отклонениями — C';
    const p = parse([r]).procedures;
    expect(p[0].defects).toHaveLength(0);
    expect(monitoringWorkQueue(p, '2026-10-06').closed).toHaveLength(0);
  });
  it('разделяет действия УО и закрытые проверки; дата заявки не становится сроком размещения', () => {
    const a = row('ЭА100-26', '', 'Заявка в уполномоченном органе'); a[23] = 'Разместить извещение';
    const b = row('ЭА101-26', 'Состоялась', 'Состоялась'); b[24] = 'Проверить: ИНН — S';
    const c = row('ЭА102-26', 'Отмена по решению заказчика', 'Не состоялась');
    const q = monitoringWorkQueue(parse([a, b, c]).procedures, '2026-10-06');
    expect(q.active).toHaveLength(1); expect(q.closed).toHaveLength(1);
    expect(q.active[0]).toMatchObject({ action: 'Разместить извещение', daysToDate: null, referenceDate: null });
    expect(q.active[0].procedure.applicationDate?.iso).toBe('2026-09-01');
    expect(q.closed[0]).toMatchObject({ referenceDate: null, daysToDate: null });
    expect(q.closed[0].action).toBe('Разобрать замечания');
  });
  it('исправление данных не получает выдуманный срок сегодня, а итог сохраняет свою дату', () => {
    const a = row('ЭА100-26'); a[23] = 'Исправить: НМЦК';
    const b = row('ЭА101-26'); b[23] = 'Подвести итоги';
    const q = monitoringWorkQueue(parse([a, b]).procedures, '2026-10-06');
    expect(q.active[0]).toMatchObject({ referenceDate: null, daysToDate: null });
    expect(q.active[1]).toMatchObject({ referenceDate: { iso: '2026-10-12' }, daysToDate: 6 });
  });
  it('пустое действие в источнике не скрывает активную процедуру', () => {
    const p = parse([row('ЭА100-26')]).procedures;
    const q = monitoringWorkQueue(p, '2026-10-06');
    expect(q.active).toHaveLength(1);
    expect(q.active[0].action).toBe('Проверить действие в реестре');
  });
});
