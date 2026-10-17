import { useEffect, useRef, useState } from 'react';
import { fetchJSON } from '../../api';

type Note = {
  id: string;
  book: string;
  readAt: string;
  evidence: { sheet?: string; sheetId?: number; cell?: string; content?: string };
};
type Metadata = {
  status: 'read' | 'unavailable';
  reason?: string;
  warning?: string;
  notes: Note[];
  total: number | null;
  shown: number;
  truncated: boolean;
  identity: 'physical-address-only';
  readAt?: string | null;
};

/** Original physical-address evidence, independent of purchase identity and decisions. */
export function CellNotesMetadata({
  deptId,
  physicalRow,
  column,
  rowRevision,
}: {
  deptId: string;
  physicalRow: number;
  column?: string;
  rowRevision?: string;
}) {
  const [data, setData] = useState<Metadata | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    sequence.current++;
    setData(null);
    setError(false);
    setLoading(false);
    return () => {
      sequence.current++;
    };
  }, [deptId, physicalRow, column, rowRevision]);
  async function load() {
    const token = ++sequence.current;
    setLoading(true);
    setError(false);
    try {
      const query = new URLSearchParams({ view: 'cell-notes', book: deptId, row: String(physicalRow) });
      if (column) query.set('column', column);
      if (rowRevision) query.set('rowRevision', rowRevision);
      const next = await fetchJSON<Metadata>(`/comments?${query}`);
      if (
        !next ||
        !['read', 'unavailable'].includes(next.status) ||
        !Array.isArray(next.notes) ||
        !next.notes.every(
          (note) =>
            note &&
            typeof note.id === 'string' &&
            typeof note.book === 'string' &&
            typeof note.readAt === 'string' &&
            note.evidence &&
            typeof note.evidence === 'object' &&
            typeof note.evidence.sheet === 'string' &&
            typeof note.evidence.cell === 'string' &&
            Number.isInteger(note.evidence.sheetId),
        )
      )
        throw new Error('NOTE_METADATA_UNAVAILABLE');
      const countKnown = Number.isSafeInteger(next.total) && Number(next.total) >= 0;
      const validCounts =
        Number.isSafeInteger(next.shown) &&
        next.shown === next.notes.length &&
        typeof next.truncated === 'boolean' &&
        next.identity === 'physical-address-only' &&
        (countKnown
          ? Number(next.total) >= next.shown && next.truncated === Number(next.total) > next.shown
          : next.status === 'unavailable' && next.total === null && next.shown === 0 && !next.truncated);
      const validRead =
        next.status !== 'read' ||
        (countKnown &&
          typeof next.readAt === 'string' &&
          Number.isFinite(Date.parse(next.readAt)) &&
          (next.total === 0 || next.shown > 0));
      if (
        !validCounts ||
        !validRead ||
        (next.reason != null && typeof next.reason !== 'string') ||
        (next.warning != null && typeof next.warning !== 'string') ||
        next.notes.some((note) => note.evidence.content != null && typeof note.evidence.content !== 'string')
      )
        throw new Error('NOTE_METADATA_UNAVAILABLE');
      if (sequence.current === token) setData(next);
    } catch {
      if (sequence.current === token) setError(true);
    } finally {
      if (sequence.current === token) setLoading(false);
    }
  }
  if (!deptId || !Number.isSafeInteger(physicalRow) || physicalRow <= 3)
    return <p>Заметки недоступны: физический адрес рабочего листа не установлен.</p>;
  return (
    <section aria-label="Метаданные заметок источника" className="space-y-2 text-xs">
      <button type="button" onClick={() => void load()} disabled={loading} className="underline">
        {loading ? 'Читаем заметки…' : column ? `Заметки ячейки ${column}${physicalRow}` : 'Заметки ячеек строки'}
      </button>
      {error && <p role="alert">Заметки не прочитаны. Это не отсутствие истории.</p>}
      {data && (
        <>
          <p>Последнее сохранённое чтение канала: {data.readAt ?? 'не подтверждено'}</p>
          <p>
            {data.warning ??
              'Заметки относятся к физическому адресу. Их связь с закупкой после перемещения строки не подтверждена.'}
          </p>
          {data.status === 'unavailable' && (
            <p role="status">{data.reason ?? 'Чтение заметок этого листа не подтверждено.'}</p>
          )}
          {data.status === 'read' && data.total === 0 && data.shown === 0 && !data.truncated && (
            <p>В сохранённых чтениях этого адреса заметок нет.</p>
          )}
          {data.notes.map((note) => (
            <article key={note.id} className="space-y-1">
              <p>
                Заметка {note.book} · {note.evidence.sheet}!{note.evidence.cell} · sheetId {note.evidence.sheetId} ·
                прочитано {note.readAt}
              </p>
              <p className="whitespace-pre-wrap">{note.evidence.content ?? 'Текст заметки не передан'}</p>
              <p>
                Автор заметки Google не установлен. Имена и даты внутри текста — заявления заметки, не подтверждённые
                метаданные правки.
              </p>
            </article>
          ))}
          {data.truncated && (
            <p>
              Показано {data.shown} сохранённых версий из {data.total}; исходная история сохранена.
            </p>
          )}
        </>
      )}
    </section>
  );
}
