/**
 * Режим «Листы-предки» — три скрытых листа книги (спека §2.5).
 *
 * ЭТО ПАМЯТЬ О ФОРМЕ, А НЕ ДАННЫЕ. Данных на этих листах ноль, и показывать
 * их нечего. Показывается их шапка — семнадцать колонок, — потому что в ней
 * есть шесть полей, которых нынешней рабочей форме не хватает: статус,
 * дата окончания рассмотрения заявок, количество заявок от поставщиков,
 * муниципальная программа, объём ассигнований и остаток непринятых
 * обязательств.
 *
 * ЗАЧЕМ ЭТО НА ЭКРАНЕ. Разговор с владельцем о том, что вернуть в книгу,
 * ведётся по списку, а не по памяти. Каждое поле здесь названо вместе с тем,
 * что оно дало бы продукту, — чтобы решение принималось по выгоде, а не по
 * ощущению «было бы неплохо».
 */
import { FileQuestion } from 'lucide-react';
import {
  ANCESTOR_MISSING_FIELDS, ANCESTOR_SHEET_COLUMNS, ANCESTOR_SHEET_NAMES,
} from '../../lib/monitoring/contract';
import { pluralCount } from '../../lib/monitoring/format';

export function AncestorSheets() {
  return (
    <div className="space-y-3">
      <section
        aria-label="Скрытые листы-предки"
        className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-700/50 p-3 sm:p-4"
      >
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5">
          <FileQuestion size={14} aria-hidden="true" />
          Скрытые листы книги: {ANCESTOR_SHEET_NAMES.map((n) => `«${n}»`).join(', ')}
        </h2>
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 max-w-3xl">
          Строк с данными на них нет — эти листы остались от прежней формы отчёта. Их шапка
          сохранена целиком: {pluralCount(ANCESTOR_SHEET_COLUMNS.length, 'колонка', 'колонки', 'колонок')},
          из которых часть в нынешнюю рабочую форму не перешла.
        </p>
        <ol className="mt-2 grid gap-x-4 gap-y-0.5 sm:grid-cols-2 xl:grid-cols-3 text-[11px] text-zinc-600 dark:text-zinc-300">
          {ANCESTOR_SHEET_COLUMNS.map((c, i) => {
            const missing = ANCESTOR_MISSING_FIELDS.some((f) => c.startsWith(f.field));
            return (
              <li key={c} className="tabular-nums">
                <span className="text-zinc-400 dark:text-zinc-500">{i + 1}.</span>{' '}
                <span className={missing ? 'text-amber-700 dark:text-amber-400' : ''}>{c}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section
        aria-label="Поля, которых не хватает рабочей форме"
        className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-700/50 p-3 sm:p-4"
      >
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
          Чего рабочей форме не хватает и что каждое поле дало бы
        </h3>
        <dl className="mt-2 space-y-2.5">
          {ANCESTOR_MISSING_FIELDS.map((f) => (
            <div key={f.field}>
              <dt className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">{f.field}</dt>
              <dd className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400 max-w-3xl">
                {f.whatItGives}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
