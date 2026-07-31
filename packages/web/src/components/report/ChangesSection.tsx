/**
 * «Кто что менял с последнего среза» — провенанс правок книг ГРБС.
 *
 * Прямая просьба коллеги (27.07): видеть смену способа определения
 * поставщика и плановых дат по каждому управлению. Источник — журналы
 * _ChangeLog книг (GET /api/changes, 37 294 записи, найдены аудитом №15).
 *
 * Подача хуманизированная: не «ячейка L178», а полный адрес с именем
 * атрибута — «лист ВСЕ · L178 · Способ определения поставщика», старое и
 * новое значение стрелкой, автор и время. Смена способа выделена: это
 * главный сигнал для коллеги. Топ свёрнут, полная выборка с поиском —
 * на месте (контракт ExpandableRows, канон «топ-N раскрывается»).
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { ExpandableRows } from '../contract/ExpandableRows';

interface ChangeRecord {
  dept: string;
  sheet: string;
  cell: string;
  attribute: string;
  oldValue: string;
  newValue: string;
  atMs: number;
  author: string;
}

/** «06.04, 17:39» — компактное время правки; год очевиден из контекста среза. */
function fmtAt(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}.${mm}, ${hh}:${mi}`;
}

/** Значение в журнале бывает пустым — читателю честнее слово, чем дыра. */
const val = (s: string): string => (s.trim() === '' ? 'пусто' : s);

function ChangeRow({ r }: { r: ChangeRecord }) {
  // Смена способа определения поставщика — то, ради чего секция существует.
  const isMethod = r.attribute.startsWith('Способ определения');
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px] leading-relaxed">
      <span className="w-24 shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">{fmtAt(r.atMs)}</span>
      <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
        {r.sheet}!{r.cell}
      </span>
      <span className={isMethod
        ? 'font-medium text-violet-700 dark:text-violet-400'
        : 'text-zinc-700 dark:text-zinc-300'}
      >
        {r.attribute || 'колонка вне канона'}
      </span>
      <span className="text-zinc-500 dark:text-zinc-400">
        {val(r.oldValue)} <span aria-hidden="true">→</span>{' '}
        <span className="font-medium text-zinc-800 dark:text-zinc-200">{val(r.newValue)}</span>
      </span>
      {r.author && (
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{r.author}</span>
      )}
    </div>
  );
}

export function ChangesSection() {
  const [data, setData] = useState<{ since: string; records: ChangeRecord[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.getChanges()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  // Группировка по управлениям: коллега спрашивает «по каждому ГРБС».
  const byDept = useMemo(() => {
    const m = new Map<string, ChangeRecord[]>();
    for (const r of data?.records ?? []) {
      const list = m.get(r.dept) ?? [];
      list.push(r);
      m.set(r.dept, list);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [data]);

  if (error) {
    return (
      <p className="text-[12px] text-zinc-400 dark:text-zinc-500">
        Журнал правок недоступен: книги не отвечают. Раздел появится при следующей загрузке.
      </p>
    );
  }
  if (!data) {
    return <p className="text-[12px] text-zinc-400 dark:text-zinc-500">Журнал правок загружается…</p>;
  }

  const sinceRu = data.since.split('-').reverse().join('.');
  return (
    <div className="space-y-4">
      <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
        журнал правок книг с {sinceRu} · всего: {data.records.length}
      </div>

      {data.records.length === 0 ? (
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
          С даты среза правок в книгах не зафиксировано.
        </p>
      ) : (
        byDept.map(([dept, records]) => (
          <div key={dept}>
            <div className="mb-1 text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
              {dept} <span className="font-normal text-zinc-400">· {records.length}</span>
            </div>
            <ExpandableRows
              rows={records}
              top={5}
              noun="правок"
              searchText={(r) => `${r.cell} ${r.attribute} ${r.oldValue} ${r.newValue} ${r.author}`}
            >
              {(r) => <ChangeRow key={`${r.cell}-${r.atMs}`} r={r} />}
            </ExpandableRows>
          </div>
        ))
      )}
    </div>
  );
}
