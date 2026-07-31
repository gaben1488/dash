/**
 * «Кто что менял с последнего среза» — провенанс правок книг ГРБС.
 *
 * Прямая просьба коллеги (27.07): видеть смену способа определения
 * поставщика и плановых дат по каждому управлению. Источник — журналы
 * _ChangeLog книг (GET /api/changes, 37 294 записи, найдены аудитом №15).
 *
 * Подача — повествовательное предложение, а не колонки тех-лога:
 * «Сотрудник … изменил(а) <атрибут> в книге …, лист …, ячейка …: было → стало».
 * Атрибут называется на языке продукта (HUMAN_ATTR), не шапкой оператора
 * («КБ 2»). Смена способа выделена: это главный сигнал для коллеги.
 * Топ свёрнут, полная выборка с поиском — на месте (контракт
 * ExpandableRows, канон «топ-N раскрывается»).
 */
import { useEffect, useMemo, useState } from 'react';
import { COL_LETTER_INDEX, DEPT_COLUMNS } from '@aemr/shared';
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

/**
 * Человеческие имена атрибутов. Дословная шапка книги («КБ 2») — тех-жаргон
 * оператора; читателю отчёта нужно название на языке продукта. Ключи — канон
 * DEPT_COLUMNS; чего нет в карте — показываем шапку в кавычках, не выдумываем.
 */
const HUMAN_ATTR: Partial<Record<keyof typeof DEPT_COLUMNS, string>> = {
  SUBJECT: 'предмет закупки',
  METHOD: 'способ определения поставщика',
  EP_REASON: 'основание выбора ЕП',
  PLAN_DATE: 'плановую дату заключения',
  PLAN_QUARTER: 'плановый квартал',
  PLAN_YEAR: 'плановый год',
  FACT_DATE: 'дату заключения (факт)',
  FACT_QUARTER: 'квартал факта',
  FACT_YEAR: 'год факта',
  DEVIATION_DAYS: 'отклонение в днях',
  FB_PLAN: 'план по федеральному бюджету',
  KB_PLAN: 'план по краевому бюджету',
  MB_PLAN: 'план по местному бюджету',
  TOTAL_PLAN: 'плановую сумму (итого)',
  FB_FACT: 'факт по федеральному бюджету',
  KB_FACT: 'факт по краевому бюджету',
  MB_FACT: 'факт по местному бюджету',
  TOTAL_FACT: 'сумму контракта (итого)',
  ECONOMY_FB: 'экономию по федеральному бюджету',
  ECONOMY_KB: 'экономию по краевому бюджету',
  ECONOMY_MB: 'экономию по местному бюджету',
  ECONOMY_TOTAL: 'экономию (итого)',
  FLAG: 'признак учёта экономии',
  JUSTIFICATION: 'обоснование необходимости',
  COMMENT_GRBS: 'комментарий ГРБСа',
  COMMENT_UER: 'комментарий УЭР',
  COMMENT_UFBP: 'комментарий УФБП',
  DEVIATION_REASON: 'причину отклонения',
};

/** Ячейка «W59» → человеческое имя атрибута («факт по краевому бюджету»). */
function humanAttribute(cell: string, rawAttr: string): string {
  const letter = cell.match(/^([A-Z]{1,2})\d+$/)?.[1];
  const idx = letter !== undefined ? COL_LETTER_INDEX[letter] : undefined;
  const key = idx === undefined
    ? undefined
    : (Object.keys(DEPT_COLUMNS) as Array<keyof typeof DEPT_COLUMNS>)
        .find((k) => DEPT_COLUMNS[k] === idx);
  if (key && HUMAN_ATTR[key]) return HUMAN_ATTR[key]!;
  return rawAttr ? `«${rawAttr}»` : 'колонку вне канона';
}

function ChangeRow({ r }: { r: ChangeRecord }) {
  const attr = humanAttribute(r.cell, r.attribute);
  // Смена способа определения поставщика — то, ради чего секция существует.
  const isMethod = attr === HUMAN_ATTR.METHOD;
  return (
    // Предложение, а не колонки тех-лога: «Сотрудник … изменил(а) …: было → стало».
    <p className="text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300">
      Сотрудник{' '}
      <span className="font-medium text-zinc-800 dark:text-zinc-200">
        {r.author || 'без подписи'}
      </span>{' '}
      изменил(а){' '}
      <span className={isMethod ? 'font-medium text-violet-700 dark:text-violet-400' : undefined}>
        {attr}
      </span>{' '}
      в книге {r.dept}, лист «{r.sheet}», ячейка{' '}
      <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{r.cell}</span>:{' '}
      <span className="text-zinc-500 dark:text-zinc-400">{val(r.oldValue)}</span>{' '}
      <span aria-hidden="true">→</span>{' '}
      <span className="font-medium text-zinc-800 dark:text-zinc-200">{val(r.newValue)}</span>
      <span className="text-zinc-400 dark:text-zinc-500"> — {fmtAt(r.atMs)}</span>
    </p>
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
              searchText={(r) =>
                `${r.cell} ${r.attribute} ${humanAttribute(r.cell, r.attribute)} ${r.oldValue} ${r.newValue} ${r.author}`}
            >
              {(r) => <ChangeRow key={`${r.cell}-${r.atMs}`} r={r} />}
            </ExpandableRows>
          </div>
        ))
      )}
    </div>
  );
}
