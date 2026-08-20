/**
 * Режим «Сводный» — лист «СВОДНЫЙ» книги плюс три вещи, которых на нём нет
 * (спека §2.2).
 *
 * ПЕРВОЕ — КОЛОНКА КОНТРОЛЯ «ВСЕГО = МБ+КБ+ФБ». На листах управлений такая
 * проверка есть в каждой строке, на своде её нет вовсе, и разрыв в девять
 * миллионов рублей по итогу сегодня не виден никому.
 *
 * ВТОРОЕ — ДВЕ КОЛОНКИ ВМЕСТО ОДНОЙ ТАМ, ГДЕ СВОД И ЛИСТ РАСХОДЯТСЯ: «как
 * считает книга» и «как считает продукт». Это заранее данный ответ на вопрос
 * «почему у вас другие цифры»: сумма, записанная в ячейке текстом, в формулу
 * `СУММ` не попадает, и свод книги её не видит. Продукт не объявляет свою
 * цифру единственно верной — он показывает обе и называет причину разницы.
 *
 * ТРЕТЬЕ — ЧЕСТНЫЙ СЧЁТЧИК. Свод считает непустые ячейки цены, продукт
 * считает строки, и эти числа расходятся ровно на строки, у которых цены
 * нет. Разница объясняется, а не сглаживается.
 */
import type { SvodPayload, SvodRow } from '../../lib/monitoring/contract';
import { fmtCount, fmtRub } from '../../lib/monitoring/format';
import { BookPeriodBadge } from './BookPeriodBadge';

/** Пара «книга / продукт» в одной ячейке: расходятся — показываются обе. */
function Pair({ book, product, kind = 'money' }: {
  book: number | null;
  product: number | null;
  kind?: 'money' | 'count';
}) {
  const fmt = kind === 'money' ? fmtRub : fmtCount;
  // Расхождением считается разница больше рубля: копеечный след округления
  // формул книги — не новость, и поднимать из-за него две колонки незачем.
  const differs = book !== null && product !== null && Math.abs(book - product) > 1;
  if (!differs) {
    return <span className="tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(book ?? product)}</span>;
  }
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="tabular-nums text-zinc-700 dark:text-zinc-200" title="как считает книга">{fmt(book)}</span>
      <span className="tabular-nums text-[10px] text-amber-700 dark:text-amber-400" title="как считает продукт по строкам листа">
        {fmt(product)}
      </span>
    </span>
  );
}

function ControlCell({ row }: { row: SvodRow }) {
  if (row.budgetGap === null) {
    return <span className="text-zinc-300 dark:text-zinc-600" title="Разбивки по бюджетам в строке свода нет">·</span>;
  }
  const ok = Math.abs(row.budgetGap) <= 1;
  return (
    <span
      className={`tabular-nums ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
      title={ok
        ? 'ВСЕГО сходится с суммой МБ, КБ и ФБ'
        : 'ВСЕГО не собирается из долей: разрыв показан рублями'}
    >
      {ok ? 'сходится' : fmtRub(row.budgetGap)}
    </span>
  );
}

function Row({ row, total = false }: { row: SvodRow; total?: boolean }) {
  return (
    <tr className={total
      ? 'border-t-2 border-zinc-200 dark:border-zinc-600 font-medium'
      : 'border-b border-zinc-50 dark:border-zinc-700/30'}
    >
      <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-200">
        {row.bookLabel || row.sheet}
        {row.bookLabel !== '' && row.sheet !== '' && row.bookLabel !== row.sheet && (
          <span className="ml-1 text-[10px] text-zinc-400 dark:text-zinc-500" title="так этот же лист назван в книге">
            ({row.sheet})
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 text-right"><Pair book={row.book.count} product={row.product.count} kind="count" /></td>
      <td className="px-2 py-1.5 text-right"><Pair book={row.book.nmck} product={row.product.nmck} /></td>
      <td className="px-2 py-1.5 text-right"><Pair book={row.book.price} product={row.product.price} /></td>
      <td className="px-2 py-1.5 text-right border-l border-zinc-100 dark:border-zinc-700/50">
        <Pair book={row.book.savingsTotal} product={row.product.savingsTotal} />
      </td>
      <td className="px-2 py-1.5 text-right"><span className="tabular-nums text-zinc-500 dark:text-zinc-400">{fmtRub(row.book.mb)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="tabular-nums text-zinc-500 dark:text-zinc-400">{fmtRub(row.book.kb)}</span></td>
      <td className="px-2 py-1.5 text-right"><span className="tabular-nums text-zinc-500 dark:text-zinc-400">{fmtRub(row.book.fb)}</span></td>
      <td className="px-2 py-1.5 text-right border-l border-zinc-100 dark:border-zinc-700/50"><ControlCell row={row} /></td>
    </tr>
  );
}

export interface SvodTableProps {
  svod: SvodPayload;
  readAtLabel: string;
}

export function SvodTable({ svod, readAtLabel }: SvodTableProps) {
  const diverging = svod.rows.filter((r) => r.divergenceNote !== null);

  return (
    <section
      aria-label="Свод книги"
      className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-700/50 p-3 sm:p-4 space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Лист «СВОДНЫЙ»</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 max-w-2xl">
            Восемь строк управлений и итог — как в книге. Где свод книги и разбор листа расходятся,
            стоят два числа: сверху книжное, под ним — продуктовое. Причина разницы названа под таблицей.
          </p>
        </div>
        <BookPeriodBadge label={readAtLabel} note="свод книги пересчитывается формулами при каждом открытии книги" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[44rem]">
          <thead className="text-[10px] text-zinc-500 dark:text-zinc-400">
            <tr className="border-b border-zinc-100 dark:border-zinc-700/50">
              <th rowSpan={2} className="px-2 py-1.5 text-left font-medium align-bottom">Управление</th>
              <th rowSpan={2} className="px-2 py-1.5 text-right font-medium align-bottom">Кол-во</th>
              <th rowSpan={2} className="px-2 py-1.5 text-right font-medium align-bottom">НМЦК, руб.</th>
              <th rowSpan={2} className="px-2 py-1.5 text-right font-medium align-bottom">Цена аукциона, руб.</th>
              <th colSpan={4} className="px-2 py-1 text-center font-medium border-l border-zinc-100 dark:border-zinc-700/50">
                Экономия, руб.
              </th>
              <th rowSpan={2} className="px-2 py-1.5 text-right font-medium align-bottom border-l border-zinc-100 dark:border-zinc-700/50">
                Контроль
              </th>
            </tr>
            <tr className="border-b border-zinc-100 dark:border-zinc-700/50">
              <th className="px-2 py-1 text-right font-normal border-l border-zinc-100 dark:border-zinc-700/50">ВСЕГО</th>
              <th className="px-2 py-1 text-right font-normal">МБ</th>
              <th className="px-2 py-1 text-right font-normal">КБ</th>
              <th className="px-2 py-1 text-right font-normal">ФБ</th>
            </tr>
          </thead>
          <tbody>
            {svod.rows.map((r) => <Row key={r.sheet || r.dept} row={r} />)}
            <Row row={svod.total} total />
          </tbody>
        </table>
      </div>

      {diverging.length > 0 && (
        <div className="space-y-1 border-t border-zinc-100 dark:border-zinc-700/50 pt-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Почему книга и продукт считают по-разному
          </p>
          {diverging.map((r) => (
            <p key={r.sheet} className="text-[11px] text-zinc-600 dark:text-zinc-300">
              <span className="font-medium">{r.bookLabel || r.sheet}:</span> {r.divergenceNote}
            </p>
          ))}
        </div>
      )}

      {svod.notes.length > 0 && (
        <div className="space-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
          {svod.notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}
    </section>
  );
}

/**
 * Итоговая строка одного листа под таблицей реестра (спека §2.1): шесть
 * чисел, которые лист отдаёт своду, и они же — глазами свода книги. Стоят
 * рядом намеренно: расхождение здесь и есть ответ на вопрос «почему у вас
 * другие цифры», и увидеть его нужно на самом листе, а не на своде.
 */
export function SheetTotalsRow({ row }: { row: SvodRow }) {
  const cells: Array<{ label: string; book: number | null; product: number | null; kind?: 'money' | 'count' }> = [
    { label: 'процедур', book: row.book.count, product: row.product.count, kind: 'count' },
    { label: 'НМЦК, руб.', book: row.book.nmck, product: row.product.nmck },
    { label: 'цена, руб.', book: row.book.price, product: row.product.price },
    { label: 'экономия ВСЕГО, руб.', book: row.book.savingsTotal, product: row.product.savingsTotal },
    { label: 'МБ, руб.', book: row.book.mb, product: row.product.mb },
    { label: 'КБ, руб.', book: row.book.kb, product: row.product.kb },
    { label: 'ФБ, руб.', book: row.book.fb, product: row.product.fb },
  ];
  return (
    <section
      aria-label="Итог листа"
      className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-700/50 p-3 sm:p-4"
    >
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
        Итог листа «{row.sheet}» — что лист отдаёт своду
      </h3>
      <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {cells.map((c) => (
          <div key={c.label}>
            <dt className="text-[10px] text-zinc-500 dark:text-zinc-400">{c.label}</dt>
            <dd className="text-sm"><Pair book={c.book} product={c.product} kind={c.kind} /></dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">
        Верхнее число — как считает свод книги, нижнее янтарное (если есть) — как считает продукт
        по строкам листа.{row.divergenceNote !== null && ` ${row.divergenceNote}`}
      </p>
    </section>
  );
}
