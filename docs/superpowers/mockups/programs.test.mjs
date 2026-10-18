// Проверяет смысл учебного макета. Не заменяет браузерную и визуальную приёмку.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('./programs.html', import.meta.url), 'utf8');
function setup() {
  const elements = new Map();
  const handlers = new Map();
  let exported;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'year' ? '2026' : id === 'period' ? 'all' : '',
      options: [], innerHTML: '', textContent: '', isConnected: true,
      get selectedOptions() { return [{ textContent: this.value }]; },
      addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; },
      focus() {},
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    document: { getElementById: element, documentElement: { dataset: {} }, createElement: () => ({ click() {} }),
      addEventListener(type, handler) { handlers.set(type, handler); } },
    window: { scrollY: 120, scrollTo() {} }, Intl, Set, Map, Date, Number, String,
    Blob, URL: { createObjectURL(blob) { exported = blob; return 'blob:учебный'; }, revokeObjectURL() {} },
    setTimeout() {},
  });
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(script[1], context);
  return {
    run: code => vm.runInContext(code, context),
    set: (id, value) => { element(id).value = value; },
    exported: () => exported,
    click(dataset = {}, attributes = [], id = '') {
      const button = { dataset, id, hasAttribute: name => attributes.includes(name) };
      handlers.get('click')({ target: { closest: () => button } });
    },
  };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('Годовой состав, неизвестный год и неизвестная принадлежность не теряются', () => {
  const m = setup();
  assert.equal(m.run('rows.length'), 18);
  assert.equal(m.run('cohort().length'), 14);
  near(m.run("sum(cohort(),'plan')"), 75.1);
  assert.equal(m.run("cohort().filter(r=>r.program==='unassigned').length"), 1);
  assert.equal(m.run("cohort().filter(r=>r.program==='outside').length"), 1);
  m.set('year', 'unknown');
  assert.equal(m.run('cohort().length'), 1);
  assert.equal(m.run('questions(cohort()).length'), 0);
  m.set('year', '2027');
  assert.equal(m.run('cohort().length'), 3);
  near(m.run("sum(cohort(),'plan')"), 15);
});

test('ТД с программой остаётся в ней; подведомственные и управление изолируются', () => {
  const m = setup();
  m.set('activity', 'td'); m.set('org', 'УО');
  assert.equal(m.run('cohort().length'), 2);
  assert.equal(m.run("cohort().every(r=>r.program==='education'&&r.activity==='td')"), true);
  m.set('sub', 'Школа № 2');
  near(m.run("sum(cohort(),'plan')"), 3);
  m.set('sub', 'own');
  assert.equal(m.run('cohort().length'), 0);
  m.set('org', 'УДТХ');
  assert.equal(m.run('cohort().length'), 2);
});

test('Общий договор считается один раз, распределённые деньги не удваиваются', () => {
  const m = setup();
  assert.equal(m.run('linkedContracts(cohort()).length'), 5);
  near(m.run("sum(linkedContracts(cohort()),'allocated')"), 40.5);
  assert.equal(m.run("['education','culture','roads'].reduce((n,p)=>n+linkedContracts(cohort().filter(r=>r.program===p)).length,0)"), 6);
  near(m.run("linkedContracts(cohort().filter(r=>r.program==='education')).find(c=>c.id==='Д-1').allocated"), 11);
  near(m.run("linkedContracts(cohort().filter(r=>r.program==='culture')).find(c=>c.id==='Д-1').allocated"), 5.7);
});

test('Все оси сужают один состав для денег, процедур и договоров', () => {
  const m = setup();
  m.set('org', 'УО'); m.set('period', 'q4'); m.set('budget', 'mb');
  m.set('activity', 'td'); m.set('method', 'ЕП'); m.set('sub', 'Детский сад № 4');
  assert.equal(m.run('cohort().map(r=>r.id).join()'), 'e5');
  near(m.run("sum(cohort(),'plan')"), 1.5);
  assert.equal(m.run('linkedContracts(cohort()).length'), 0);
  assert.equal(m.run('linkedProcedures(cohort()).length'), 0);
  m.set('method', 'ЭА');
  assert.equal(m.run('cohort().length'), 0);
});

test('Раскрытие не открывает программу и не изменяет отбор', () => {
  const m = setup();
  m.click({ expand: 'education' });
  assert.equal(m.run("state.expanded.has('education')"), true);
  assert.equal(m.run('state.program'), null);
  assert.equal(m.run('cohort().length'), 14);
  m.click({ open: 'education' });
  assert.equal(m.run('cohort().length'), 5);
});

test('Переклассификация видна в общем изменении без новой позиции и без прироста денег', () => {
  const m = setup();
  near(m.run("sum(cohort(before),'plan')"), 70.8);
  const result = m.run('changes(cohort())');
  assert.match(result, /Изменена программная принадлежность/);
  assert.match(result, /Проектирование спортивного объекта/);
  m.run("state.program='education'");
  near(m.run("sum(cohort(),'plan')-sum(cohort(before),'plan')"), -3.5);
});

test('Следующий год меняется явно, возврат восстанавливает год и период', () => {
  const m = setup();
  m.set('period', 'q4');
  m.click({ open: 'education' });
  m.click({ programView: 'next' });
  assert.equal(m.run("byId('year').value"), '2027');
  assert.equal(m.run('cohort().length'), 1);
  m.click({}, ['data-return-year']);
  assert.equal(m.run("byId('year').value"), '2026');
  assert.equal(m.run("byId('period').value"), 'q4');
  assert.equal(m.run('cohort().length'), 1);
});

test('Счётчики раскрывают точный отбор, включая бюджет и управление', () => {
  const m = setup();
  m.set('org', 'УО'); m.set('budget', 'kb');
  m.click({ scope: 'education', kind: 'money' });
  assert.match(m.run("byId('dossier-body').innerHTML"), /Оборудование учебных кабинетов/);
  assert.doesNotMatch(m.run("byId('dossier-body').innerHTML"), /Проектирование детского сада|Оснащение сцены/);
});

test('Выгрузка содержит весь активный состав и настоящие переводы строк', async () => {
  const m = setup();
  m.set('org', 'УО'); m.set('activity', 'td');
  m.click({}, [], 'export');
  const csv = await m.exported().text();
  assert.equal(csv.trim().split('\r\n').length, 3);
  assert.match(csv, /Школа № 2/);
  assert.match(csv, /Детский сад № 4/);
  assert.doesNotMatch(csv, /УКСиМП|Школа № 1/);
});

test('Одинаковые названия подпрограмм не объединяют разные программы', () => {
  const m = setup();
  m.click({ sub: 'Обеспечение деятельности', program: 'education' });
  assert.match(m.run("byId('dossier-body').innerHTML"), /Услуги связи/);
  assert.doesNotMatch(m.run("byId('dossier-body').innerHTML"), /Пополнение фонда|Содержание территории/);
});

test('Окно событий и плановый год различны, недатированный N+1 не становится просрочкой', () => {
  const m = setup();
  m.set('year', '2027');
  m.run("state.calendar='year';state.calendarYear='2026'");
  assert.doesNotMatch(m.run('calendar(cohort())'), /class="event /);
  m.run("state.calendarYear='2027'");
  assert.match(m.run('calendar(cohort())'), /2027-03-01/);
  assert.equal(m.run('questions(cohort()).length'), 0);
});
