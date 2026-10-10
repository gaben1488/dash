import { DEFAULT_FILTERS } from './model.mjs';

// A filter change is a new decision: the undo of an earlier reset must
// never overwrite it. Keep both pieces of state in one reducer so the
// reset/restore transition cannot be split by React batching.
export function initialFilterSession() {
  return { filters: { ...DEFAULT_FILTERS }, undo: null };
}

export function filterSession(state, action) {
  switch (action.type) {
    case 'change':
      return {
        filters: typeof action.next === 'function' ? action.next(state.filters) : action.next,
        undo: null,
      };
    case 'reset':
      return {
        filters: { ...DEFAULT_FILTERS },
        undo: { filters: state.filters, unit: action.unit, week: action.week },
      };
    case 'restore':
      return state.undo
        ? { filters: state.undo.filters, undo: null }
        : state;
    default:
      return state;
  }
}
