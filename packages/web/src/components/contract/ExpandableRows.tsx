/**
 * ExpandableRows — контракт «топ-N раскрывается в полную выборку на месте».
 *
 * Канон Отчёта++ (бриф 01.08): где отчёт показывает срез выборки (топ-3
 * сигналов, крупные ЭА, «в работе»), читатель обязан уметь развернуть ПОЛНЫЙ
 * список с фильтрацией — инлайн, без ухода со страницы. Свёрнутый вид всегда
 * несёт честную подпись «показать все M»: размер скрытого не прячется.
 *
 * Компонент дженериковый и не знает, что за строки: рендер строки и предикат
 * поиска приходят снаружи. Фильтр — единственное поле поиска; колоночные
 * фильтры добавит потребитель через собственный предикат, когда понадобятся,
 * — заранее их не строим (ponytail).
 */
import { useMemo, useState, type ReactNode } from 'react';

export function ExpandableRows<T>(props: {
  rows: readonly T[];
  /** Сколько строк видно в свёрнутом виде (обычно 3–5, как в бумаге). */
  top: number;
  /** Рендер одной строки. */
  children: (row: T, index: number) => ReactNode;
  /** Текст строки для поиска в развёрнутом виде. */
  searchText: (row: T) => string;
  /** Подпись сущности для кнопки: «сигналы», «процедуры». */
  noun: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');

  // Поиск считается прямо в фильтре, БЕЗ индексного кэша поисковых строк.
  // Прежний кэш был мемоизирован по ссылке rows (Д18): инплейс-sort() у
  // потребителя ссылку не меняет, кэш оставался от старого порядка, и
  // фильтр по индексам прикладывал чужие строки. Пересчёт честен и дёшев:
  // работает только в развёрнутом виде при вводе запроса, строк сотни.
  // searchText в зависимостях нет намеренно — потребители передают его
  // инлайн-стрелкой (новая на каждый рендер), а актуальная версия и так
  // читается из props в момент пересчёта.
  const visible = useMemo(() => {
    if (!expanded) return props.rows.slice(0, props.top);
    const q = query.trim().toLowerCase();
    if (!q) return props.rows;
    return props.rows.filter((r) => props.searchText(r).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, query, props.rows, props.top]);

  const hidden = props.rows.length - props.top;

  return (
    <div>
      {expanded && props.rows.length > 8 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Поиск по ${props.noun} (${props.rows.length})`}
          className="mb-2 w-full max-w-xs rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] text-zinc-700 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        />
      )}
      <div className="space-y-1">
        {visible.map((row, i) => props.children(row, i))}
        {expanded && query && visible.length === 0 && (
          <p className="text-[12px] text-zinc-400">Ничего не найдено по запросу.</p>
        )}
      </div>
      {hidden > 0 && (
        <button
          onClick={() => { setExpanded(!expanded); setQuery(''); }}
          className="mt-1.5 text-[12px] font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {expanded
            ? 'Свернуть'
            : `Показать все ${props.rows.length} ${props.noun}`}
        </button>
      )}
    </div>
  );
}
