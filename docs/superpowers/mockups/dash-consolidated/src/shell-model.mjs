// Prototype state only; production adapters are specified in CONSOLIDATION-CONTRACT.md.
export function selectionAxes(f, unit = 'тыс', week = 41) {
  const definitions = [
    ['year', 'Год', 'когда', f.periods == null && f.year !== 2026, f.year || 'Все годы'],
    ['period', 'Месяцы и кварталы', 'когда', f.periods != null || !!f.month, f.periods ? `${f.periods.length} месяцев` : f.month || 'Весь год'],
    ['week', 'Версия недели', 'когда', week !== 41, week === 41 ? 'Текущая' : weekWindow(week).label],
    ['department', 'Управления', 'кто', !!f.dept || f.depts != null, f.dept || f.depts?.join(', ') || 'Все'],
    ['organization', 'Организации', 'кто', !!f.org || f.orgs != null, f.org || f.orgs?.join(', ') || 'Все'],
    ['category', 'Категории', 'кто', !!f.category, f.category || 'В действующей левой линейке'],
    ['method', 'Способ закупки', 'что', !!f.method, f.method || 'Все'],
    ['activity', 'Вид деятельности', 'что', !!f.activity, f.activity || 'В действующем приложении'],
    ['budget', 'Бюджет', 'что', !!f.budget || f.budgets != null, f.budget || f.budgets?.join(', ') || 'Все'],
    ['rate', 'Ставка снижения', 'как', false, 'Существующий режим расчёта'],
    ['unit', 'Единицы', 'как', unit !== 'тыс', `${unit}. ₽`],
    ['search', 'Поиск', 'как', !!f.search, f.search || 'Без поиска'],
  ];
  return definitions.map(([key, name, family, active, value]) => ({key, name, family, active: !!active, value, kind: ['rate', 'unit'].includes(key) ? 'mode' : 'filter'}));
}
export function weekWindow(week) {
  const start = new Date(Date.UTC(2026, 9, 9 + (week - 41) * 7));
  const end = new Date(start.getTime() + 7 * 86400000);
  const format = (d, options) => new Intl.DateTimeFormat('ru-RU', {timeZone:'UTC', ...options}).format(d).replace(/ г\.$/, '');
  const same = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  return {
    start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10),
    days: `${start.getUTCDate()}–${end.getUTCDate()}`,
    month: format(start, {day:'numeric', month:'long'}).split(' ').slice(1).join(' '),
    label: same ? `${start.getUTCDate()}–${format(end, {day:'numeric',month:'long',year:'numeric'})}` : `${format(start, {day:'numeric',month:'long',year:'numeric'})} — ${format(end, {day:'numeric',month:'long',year:'numeric'})}`,
  };
}
export const initialUpdate = { phase: 'ready', version: 1, hidden: false };
export function updateState(state, event) {
  if (event.type === 'reset') return initialUpdate;
  if (event.type === 'dismiss') return {...state, hidden:true};
  if (event.type === 'seen') return {...state, phase:'seen', hidden:false};
  if (event.type === 'read') return {...state, phase:'reading', hidden:false};
  if (event.type === 'fail') return {...state, phase:'failed', hidden:false};
  if (event.type === 'complete' && event.blocked) return {...state, phase:'waiting', hidden:false};
  if (event.type === 'apply' || event.type === 'complete') return {phase:'ready', version:state.version + 1, hidden:false};
  return state;
}
export const needsNotice = state => ['waiting','failed'].includes(state.phase) && !state.hidden;
