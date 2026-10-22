import { useCallback, useEffect, useRef, useState } from 'react';
import { humanizeRequestError } from '../api';
import { createLatestRead } from '../lib/latest-read';

/** Key includes the complete request context. Old-scope data is hidden before the next effect runs. */
export function useScopedQuery<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [slot] = useState(createLatestRead);
  const loader = useRef(load);
  loader.current = load;
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; loading: boolean; error: string | null }>({ key, loading: Boolean(key), error: null });
  useEffect(() => {
    if (!key) return;
    const read = slot.begin();
    setState(previous => ({ key, data: previous.key === key ? previous.data : undefined, loading: true, error: null }));
    const timeout = setTimeout(() => {
      if (read.isCurrent()) {
        setState(previous => ({ ...previous, loading: false, error: 'Сервер не ответил вовремя — повторите запрос.' }));
        read.abort();
      }
    }, 35_000);
    const currentLoader = loader.current;
    Promise.resolve().then(() => currentLoader(read.signal)).then(data => {
      if (read.isCurrent()) setState({ key, data, loading: false, error: null });
    }).catch(error => {
      if (read.isCurrent()) setState(previous => ({ ...previous, loading: false, error: humanizeRequestError(error) }));
    }).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); read.abort(); };
  }, [key, reload, slot]);
  const retry = useCallback(() => setReload(value => value + 1), []);
  return { ...(state.key === key ? state : { key, data: undefined, loading: Boolean(key), error: null }), retry };
}
