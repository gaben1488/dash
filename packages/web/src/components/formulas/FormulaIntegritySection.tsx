/**
 * FormulaIntegritySection — раздел «Целостность формул» вкладки «Контроль».
 *
 * ЧТО ПОКАЗЫВАЕТ. Перечень ячеек формульных граф книг, у которых формула
 * затёрта вбитым числом, разошлась с эталоном графы либо не протянута вовсе.
 * Каждая строка перечня несёт всё, что нужно, чтобы открыть книгу и починить,
 * не переспрашивая: книгу, адрес ячейки (K34), номер закупки, класс дефекта,
 * что стоит в ячейке сейчас, каков эталон графы и из какой строки тянуть
 * целую формулу. Отбор — по книге и по классу.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ РАЗДЕЛОМ, А НЕ КАРТОЧКАМИ ДИАГНОСТА. Карточка диагноста
 * группирует замечания по механизму и говорит о СТРОКАХ книги. Здесь предмет
 * другой — ЯЧЕЙКА формульной графы: адрес, содержимое и эталон. Втиснуть их
 * в карточку строки значит потерять ровно то, ради чего класс заводился, —
 * возможность прочитать перечень адресов и пройти его подряд.
 *
 * ЧЕСТНОЕ МОЛЧАНИЕ. Пустой перечень тут НЕ значит «дефектов нет»: формулы
 * читаются не при каждом обновлении, а по уведомлению об изменении книги и в
 * ночном обходе (решение владельца §22 п.7). Поэтому над перечнем всегда
 * стоит строка состояния чтения — она берётся из `/api/sources/integrity` и
 * говорит, по каким книгам формулы читались, разобраны ли они и каких книг
 * чтение не касалось вовсе.
 */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Filter, Info, Loader2, X } from 'lucide-react';
import { api, humanizeRequestError } from '../../api';
import { productLabel } from '@aemr/shared';
import {
  FORMULA_DEFECT_CHECK_IDS,
  FORMULA_INTEGRITY_TITLE,
  collectFormulaDefects,
  countFormulaDefects,
  formulaDefectDescription,
  formulaDefectName,
  formulaDefectRecommendation,
  formulaIntegritySpot,
  type FormulaDefectCheckId,
  type FormulaIssueLike,
  type FormulaReadState,
} from '../../lib/formulas/formula-defects';

/** Книга названа так же, как везде в продукте: через словарь ключей ГРБС. */
function bookLabel(book: string): string {
  const label = productLabel(book);
  return label === book ? book : `${book} — ${label}`;
}

export function FormulaIntegritySection({ issues }: { issues: readonly FormulaIssueLike[] }) {
  const [readState, setReadState] = useState<FormulaReadState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bookFilter, setBookFilter] = useState<Set<string>>(new Set());
  const [classFilter, setClassFilter] = useState<Set<FormulaDefectCheckId>>(new Set());

  useEffect(() => {
    let alive = true;
    api.getSourceIntegrity()
      .then((res) => { if (alive) { setReadState(res.formulas); setLoadError(null); } })
      // Ошибка запроса — это НЕ «формулы чисты» и не «формулы не читались»:
      // мы просто не знаем. Так и сказано, состояние остаётся пустым.
      .catch((err) => { if (alive) setLoadError(humanizeRequestError(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const defects = useMemo(() => collectFormulaDefects(issues), [issues]);
  const counts = useMemo(() => countFormulaDefects(defects), [defects]);
  const spot = useMemo(() => formulaIntegritySpot(readState, counts), [readState, counts]);

  const books = useMemo(
    () => Object.keys(counts.byBook).sort((a, b) => a.localeCompare(b, 'ru')),
    [counts.byBook],
  );

  const shown = useMemo(() => defects.filter((d) => {
    if (bookFilter.size > 0 && !bookFilter.has(d.book)) return false;
    if (classFilter.size > 0 && !classFilter.has(d.checkId)) return false;
    return true;
  }), [defects, bookFilter, classFilter]);

  const toggleBook = (book: string) => {
    setBookFilter((prev) => {
      const next = new Set(prev);
      if (next.has(book)) next.delete(book);
      else next.add(book);
      return next;
    });
  };

  const toggleClass = (id: FormulaDefectCheckId) => {
    setClassFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasFilter = bookFilter.size > 0 || classFilter.size > 0;

  return (
    <section className="space-y-4">
      {/* Состояние чтения формул: что именно смотрели. Стоит ПЕРЕД перечнем,
          потому что без него пустой перечень читается как «всё хорошо». */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
          {FORMULA_INTEGRITY_TITLE}
        </h2>
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            Спрашиваем, читались ли формулы книг
          </p>
        ) : loadError !== null ? (
          <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden="true" />
            <span>
              Состояние чтения формул узнать не удалось: {loadError}. Перечень ниже показан
              как есть — но пустота в нём сейчас не значит «дефектов нет».
            </span>
          </p>
        ) : spot === null ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Служба о чтении формул не ответила. Пустой перечень ниже не значит «дефектов нет».
          </p>
        ) : (
          <p className={clsx(
            'text-xs leading-relaxed',
            spot.cells === null
              ? 'text-amber-600 dark:text-amber-400'
              : spot.cells > 0
                ? 'text-zinc-700 dark:text-zinc-200'
                : 'text-emerald-600 dark:text-emerald-400',
          )}>
            {spot.text}
          </p>
        )}
      </div>

      {/* Отбор: по книге и по классу. Рядом с каждым — счёт, чтобы отбирать
          осмысленно, а не наугад. */}
      {defects.length > 0 && (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              <Filter size={12} aria-hidden="true" /> Книга
            </span>
            {books.map((book) => {
              const active = bookFilter.has(book);
              return (
                <button
                  key={book}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleBook(book)}
                  title={`Показать только дефекты формул книги «${bookLabel(book)}»`}
                  className={clsx(
                    'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition',
                    active
                      ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-transparent'
                      : 'bg-white dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/50 hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                  )}
                >
                  {book}
                  <span className="ml-1.5 tabular-nums text-zinc-400 dark:text-zinc-500">
                    {counts.byBook[book] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              <Filter size={12} aria-hidden="true" /> Класс
            </span>
            {FORMULA_DEFECT_CHECK_IDS.map((id) => {
              const count = counts.byClass[id] ?? 0;
              const active = classFilter.has(id);
              const unavailable = count === 0 && !active;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  aria-disabled={unavailable}
                  onClick={() => { if (!unavailable) toggleClass(id); }}
                  title={unavailable
                    ? `«${formulaDefectName(id)}»: среди показанных замечаний такого класса нет`
                    : `${formulaDefectDescription(id)}\n\nЧто сделать: ${formulaDefectRecommendation(id)}`}
                  className={clsx(
                    'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition text-left',
                    active
                      ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-transparent'
                      : 'bg-white dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/50 hover:bg-zinc-50 dark:hover:bg-zinc-700/30',
                    unavailable && 'opacity-45 cursor-default',
                  )}
                >
                  {formulaDefectName(id)}
                  <span className="ml-1.5 tabular-nums text-zinc-400 dark:text-zinc-500">{count}</span>
                </button>
              );
            })}
          </div>
          {hasFilter && (
            <button
              type="button"
              onClick={() => { setBookFilter(new Set()); setClassFilter(new Set()); }}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 transition"
            >
              <X size={11} aria-hidden="true" /> Снять отбор — показать все {defects.length}
            </button>
          )}
        </div>
      )}

      {/* Перечень ячеек. Таблица прокручивается вбок внутри себя: страница в
          горизонтальную прокрутку не уходит. */}
      {defects.length === 0 ? (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent px-5 py-8 text-center">
          <Info size={22} className="mx-auto mb-2 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Дефектов формул в этом перечне нет
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-lg mx-auto">
            Что это значит — сказано строкой состояния выше: пустой перечень бывает и когда
            формулы книг просто не читались.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-transparent overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 border-b border-zinc-100 dark:border-zinc-700/50">
                  <th scope="col" className="px-4 py-2 font-medium">Книга</th>
                  <th scope="col" className="px-4 py-2 font-medium">Ячейка</th>
                  <th scope="col" className="px-4 py-2 font-medium">№ закупки</th>
                  <th scope="col" className="px-4 py-2 font-medium">Класс</th>
                  <th scope="col" className="px-4 py-2 font-medium">Что стоит</th>
                  <th scope="col" className="px-4 py-2 font-medium">Эталон графы</th>
                  <th scope="col" className="px-4 py-2 font-medium">Откуда тянуть</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-zinc-50 dark:border-zinc-700/30 last:border-0 align-top"
                  >
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300" title={bookLabel(d.book)}>
                      {d.book || 'книга не названа'}
                    </td>
                    <td className="px-4 py-2 font-medium tabular-nums text-zinc-800 dark:text-zinc-100">
                      {d.cell || '—'}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-zinc-500 dark:text-zinc-400">
                      {d.rowSeq || 'нет номера'}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        title={`${formulaDefectDescription(d.checkId)}\n\nЧто сделать: ${d.recommendation}`}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"
                      >
                        {d.className}
                      </span>
                    </td>
                    <td className="px-4 py-2 max-w-xs break-words font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                      {d.actual === null
                        ? <span className="font-sans text-zinc-400 dark:text-zinc-500">пусто</span>
                        : d.actual}
                    </td>
                    <td className="px-4 py-2 max-w-xs break-words font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                      {d.etalon ?? <span className="font-sans text-zinc-400 dark:text-zinc-500">не назван</span>}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-zinc-500 dark:text-zinc-400">
                      {d.donorRow === null
                        ? <span title="Целой формулы этой графы рядом не нашлось — сверять с листом «GOOGLE_ФОРМУЛЫ» книги">донора нет</span>
                        : `строка ${d.donorRow}`}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">
                      Отбор ничего не оставил: из {defects.length} дефектов под книгу и класс не
                      подошёл ни один. Снимите отбор, чтобы увидеть все.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-zinc-400 dark:text-zinc-500 border-t border-zinc-100 dark:border-zinc-700/50">
            Показано {shown.length} из {defects.length}. Рецепт починки у всех трёх классов один:
            протянуть формулу из соседней строки той же графы; вбитое значение не сохранять.
          </p>
        </div>
      )}
    </section>
  );
}
