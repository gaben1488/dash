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
import { formatDateCell } from '../../lib/sheet-date';
import { api } from '../../api';
import { toCanonicalDeptId } from '../../lib/dept-key';
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

/** «06.04, 17:39» — компактное время правки; год очевиден из контекста среза.
 *  Экспорт: тем же словом время называет журнал эфира в углу шапки. */
export function fmtAt(ms: number): string {
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

/** Обратная карта «индекс колонки → ключ канона» — один раз на модуль. */
const KEY_BY_INDEX = new Map<number, keyof typeof DEPT_COLUMNS>(
  (Object.keys(DEPT_COLUMNS) as Array<keyof typeof DEPT_COLUMNS>)
    .map((k) => [DEPT_COLUMNS[k], k]),
);

/** Ячейка «W59» → ключ колонки канона (undefined — вне канона). */
function attrKeyOf(cell: string): keyof typeof DEPT_COLUMNS | undefined {
  const letter = cell.match(/^([A-Z]{1,2})\d+$/)?.[1];
  const idx = letter !== undefined ? COL_LETTER_INDEX[letter] : undefined;
  return idx === undefined ? undefined : KEY_BY_INDEX.get(idx);
}

/** Ячейка «W59» → человеческое имя атрибута («факт по краевому бюджету»).
 *  Экспорт: журнал эфира в углу шапки обязан говорить тем же языком продукта,
 *  а не шапкой оператора («КБ 2») — карта HUMAN_ATTR живёт в одном месте. */
export function humanAttribute(cell: string, rawAttr: string): string {
  const key = attrKeyOf(cell);
  if (key && HUMAN_ATTR[key]) return HUMAN_ATTR[key]!;
  return rawAttr ? `«${rawAttr}»` : 'колонку вне канона';
}

function ChangeRow({ r }: { r: ChangeRecord }) {
  const attr = humanAttribute(r.cell, r.attribute);
  // Смена способа определения поставщика — то, ради чего секция существует.
  const isMethod = attrKeyOf(r.cell) === 'METHOD';
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

export function ChangesSection({ since, depts = [] }: {
  since?: string;
  /**
   * Изоляция управлений (канон п.127, работа P0-2 карты вкладки): выбрано
   * управление — лента показывает правки ТОЛЬКО его книг. До 21.08 она
   * оставалась районной, и под фильтром одного ГРБС читатель видел чужие
   * правки как свои. Отчёт целиком фильтр не сужает по решению 03.08, но
   * лента правок — не документ, а провенанс, и на неё исключение не
   * распространяется. Пусто — все книги.
   */
  depts?: readonly string[];
}) {
  const [data, setData] = useState<{ since: string; records: ChangeRecord[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Архивный срез задаёт момент и ленте правок: без этого верхний ярус
    // секции показывал дельты той недели, а нижний — правки текущей.
    api.getChanges(since)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [since]);

  // Срез по выбранным книгам — до всякой группировки и счёта: иначе шапка
  // ленты («всего: N») продолжала бы называть районное число под срезом
  // одного управления. Обе стороны сводятся к канону ключа: журнал приходит
  // с именем книги, шапка держит канонический DepartmentId.
  const deptSet = useMemo(
    () => new Set(depts.map(toCanonicalDeptId)),
    [depts],
  );
  const records = useMemo(
    () => (deptSet.size === 0
      ? data?.records ?? []
      : (data?.records ?? []).filter((r) => deptSet.has(toCanonicalDeptId(r.dept)))),
    [data, deptSet],
  );

  // Группировка по управлениям: коллега спрашивает «по каждому ГРБС».
  const byDept = useMemo(() => {
    const m = new Map<string, ChangeRecord[]>();
    for (const r of records) {
      const list = m.get(r.dept) ?? [];
      list.push(r);
      m.set(r.dept, list);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [records]);

  // Смена способа — в самый верх ленты (прямой запрос коллеги). Фильтр
  // 37 тыс. записей — по ключу колонки и не на каждый рендер.
  const methodChanges = useMemo(
    () => records.filter((r) => attrKeyOf(r.cell) === 'METHOD'),
    [records],
  );

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

  const sinceRu = formatDateCell(data.since);
  // Паспорт периметра ленты: чьи книги, с какого момента и сколько правок в
  // этом периметре (канон п.58а — подпись строится из ДАННЫХ, по которым
  // посчитано число, а не из бейджа шапки).
  const scopeLabel = deptSet.size === 0
    ? 'все книги управлений'
    : `книги: ${depts.join(', ')}`;
  return (
    <div className="space-y-4">
      <div className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        Правки в книгах · {scopeLabel} · журнал с {sinceRu} · всего: {records.length}
        {deptSet.size > 0 && records.length !== data.records.length && (
          <span className="normal-case tracking-normal">
            {' '}(в районе за тот же срок — {data.records.length})
          </span>
        )}
      </div>

      {methodChanges.length > 0 && (
        <div>
          <div className="mb-1 text-[12px] font-medium text-violet-700 dark:text-violet-400">
            Смена способа определения поставщика{' '}
            <span className="font-normal text-zinc-400">· {methodChanges.length}</span>
          </div>
          <ExpandableRows
            rows={methodChanges}
            top={5}
            noun="правок"
            searchText={(r) => `${r.dept} ${r.cell} ${r.oldValue} ${r.newValue} ${r.author}`}
          >
            {(r, i) => <ChangeRow key={`m-${r.dept}-${r.sheet}-${r.cell}-${r.atMs}-${i}`} r={r} />}
          </ExpandableRows>
        </div>
      )}

      {/* Честная пустота двух родов (канон п.104): пусто, потому что правок
          не было вовсе, — и пусто, потому что срез по выбранным книгам их
          отсеял. Одна фраза на оба случая скрывала бы от читателя, что
          рядом, в чужих книгах, правки есть. */}
      {records.length === 0 ? (
        deptSet.size > 0 && data.records.length > 0 ? (
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
            В выбранных книгах ({depts.join(', ')}) правок с даты среза нет.
            В остальных книгах района за тот же срок — {data.records.length}:
            снимите фильтр управления в шапке, чтобы увидеть их.
          </p>
        ) : (
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
            С даты среза правок в книгах не зафиксировано.
          </p>
        )
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
              {(r, i) => <ChangeRow key={`${r.sheet}-${r.cell}-${r.atMs}-${i}`} r={r} />}
            </ExpandableRows>
          </div>
        ))
      )}
    </div>
  );
}
