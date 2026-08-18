/**
 * useRowProvenance — загрузка провенанса плановой суммы одной закупки
 * (GET /api/provenance/:deptId/:rowSeq).
 *
 * ЗАЧЕМ. Плановая сумма K в книгах ГРБС несёт три разные сущности (замер по
 * полным дампам восьми книг, канон п.102): неизменная НМЦК; НМЦК за вычетом
 * изъятого перераспределением; распределяемый лимит, который при экономии
 * снимают со строки и переносят на следующую. В двух последних случаях экономия
 * уходит правкой ПЛАНА задним числом — из разницы план−факт она исчезает.
 * Единственный след такой правки — журнал правок книги, и этот хук его достаёт.
 *
 * ЛЕНИВЫЙ ПО УМОЛЧАНИЮ. Роут читает журнал книги целиком (у одного управления
 * там 33 724 записи), поэтому запрос уходит только когда вызывающий сам скажет
 * enabled: карточку строки открывают чаще, чем читают историю плана.
 *
 * ЧЕСТНЫЕ СОСТОЯНИЯ. Наружу отдаются три различимых исхода, а не один флаг:
 * loading (ответа ещё нет), error (сервер отказал — с русской фразой и
 * возможностью повторить), data (ответ пришёл). Пустоту хук НЕ выдумывает:
 * «правок нет» и «журнал не ведётся» различает уже сам ответ (поля
 * observability и journalAvailable), и подменять их общим null нельзя —
 * ровно эта подмена и превращает дыру наблюдаемости в «всё чисто».
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchJSON, humanizeRequestError } from '../api';
import type { RowProvenanceResponse } from '../lib/provenance/contract';

export type { RowProvenanceResponse } from '../lib/provenance/contract';

/**
 * Род отказа. Различать их обязательно, потому что читателю они говорят разное
 * и требуют разного действия:
 *   missing — строки с таким «№ п/п» в книге нет. Это не сбой, а НАХОДКА:
 *     реестр называет один номер, книга его не знает (живая жалоба оператора,
 *     канон п.98б — «строка 155 по пульту в реальности 534»). Повтор запроса
 *     здесь бесполезен, кнопка «ещё раз» была бы враньём.
 *   unavailable — источник временно молчит; повтор осмыслен.
 *   failure — всё остальное.
 */
export type ProvenanceErrorKind = 'missing' | 'unavailable' | 'failure';

export interface UseRowProvenanceResult {
  /** Ответ сервера; null — ещё не запрашивали, грузим или отказ. */
  data: RowProvenanceResponse | null;
  loading: boolean;
  /** Русская фраза отказа; null — отказа не было. */
  error: string | null;
  /** Род отказа; null — отказа не было. */
  errorKind: ProvenanceErrorKind | null;
  /** true — запрос не отправляется: не задан адрес строки либо enabled=false. */
  idle: boolean;
  /** Повторить запрос (кнопка «запросить ещё раз» в плашке отказа). */
  reload: () => void;
}

/**
 * Фраза отказа для человека. Роут провенанса отвечает по-русски и по делу
 * («в книге УКСиМП нет закупки с № п/п 155… на строке листа 155 стоит закупка с
 * № п/п 534»), но это тело живёт внутри JSON-конверта, а общий обработчик
 * показывает конверт целиком и обрезает его на 120 знаках — то есть ровно на
 * том месте, где начинается польза. Здесь фраза сервера достаётся наружу
 * целиком; если её нет, работает прежний общий разбор.
 */
export function provenanceErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed: unknown = JSON.parse(err.body);
      if (parsed && typeof parsed === 'object') {
        const message = (parsed as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim() !== '') return message.trim();
      }
    } catch {
      // Тело не JSON — значит фразы сервера в нём нет, идём общим путём.
    }
  }
  return humanizeRequestError(err);
}

/** Род отказа по коду ответа: 404 — находка, 5xx и сеть — «повторите». */
export function provenanceErrorKind(err: unknown): ProvenanceErrorKind {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'missing';
    return err.status >= 500 ? 'unavailable' : 'failure';
  }
  return err instanceof Error && /fetch|network|timeout|abort/i.test(err.message)
    ? 'unavailable'
    : 'failure';
}

/**
 * № п/п закупки из значения ячейки колонки A. Приходит и числом, и строкой
 * («25», «25.0» — так Google отдаёт числовые ячейки), и пустотой. Возвращает
 * null, если номера нет: без него провенанс запрашивать не по чему, и врать
 * нулём («строка № 0») хуже, чем честно сказать, что ключа нет.
 */
export function toRowSeq(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 ? value : null;
  }
  const s = String(value ?? '').trim().replace(/ /g, '');
  const m = s.match(/^(\d+)(?:[.,]0+)?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 ? n : null;
}

export function useRowProvenance(
  deptId: string,
  rowSeq: number | null,
  enabled = true,
): UseRowProvenanceResult {
  const [data, setData] = useState<RowProvenanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ProvenanceErrorKind | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Живой номер запроса: карточку переключают между строками быстрее, чем
  // отвечает сервер, и поздний ответ прежней строки не должен подменить
  // историю новой (провенанс не той закупки — худший вид неправды здесь).
  const requestId = useRef(0);

  const canRequest = enabled && deptId !== '' && rowSeq !== null;

  useEffect(() => {
    if (!canRequest) return;
    const id = ++requestId.current;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setErrorKind(null);
    void (async () => {
      try {
        const response = await fetchJSON<RowProvenanceResponse>(
          `/provenance/${encodeURIComponent(deptId)}/${rowSeq}`,
        );
        if (cancelled || id !== requestId.current) return;
        setData(response);
      } catch (err) {
        if (cancelled || id !== requestId.current) return;
        setData(null);
        setError(provenanceErrorText(err));
        setErrorKind(provenanceErrorKind(err));
      } finally {
        if (!cancelled && id === requestId.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canRequest, deptId, rowSeq, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    data,
    loading,
    error,
    errorKind,
    idle: !canRequest && !loading && data === null && error === null,
    reload,
  };
}
