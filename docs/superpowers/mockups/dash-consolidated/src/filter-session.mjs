import { DEFAULT_FILTERS } from './model.mjs';

// The filter context, units, week and Reset/Undo are one transaction.
// Every new user decision invalidates the previous Reset's Undo.
export function initialFilterSession() {
  return { filters: { ...DEFAULT_FILTERS }, unit: 'тыс', week: 41, undo: null };
}
const evaluate = (current, next) => typeof next === 'function' ? next(current) : next;

export function filterSession(state, action) {
  switch (action.type) {
    case 'change':
      return { ...state, filters: evaluate(state.filters, action.next), undo: null };
    case 'unit':
      return { ...state, unit: evaluate(state.unit, action.next), undo: null };
    case 'week':
      return { ...state, week: evaluate(state.week, action.next), undo: null };
    case 'reset':
      return {
        filters: { ...DEFAULT_FILTERS }, unit: 'тыс', week: 41,
        undo: { filters: state.filters, unit: state.unit, week: state.week },
      };
    case 'restore':
      return state.undo ? { ...state, ...state.undo, undo: null } : state;
    default:
      return state;
  }
}
