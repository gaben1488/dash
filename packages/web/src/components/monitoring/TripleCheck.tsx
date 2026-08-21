/**
 * «Сверка трёх источников» — раздел вкладки «Мониторинг»
 * (требование владельца 21.08.2026: «движок, данные из ежедневного мониторинга
 * и данные из листов ГРБС»).
 *
 * ЧТО ЭТОТ РАЗДЕЛ ОБЕЩАЕТ. До сегодняшнего дня продукт сверял две стороны:
 * свой расчёт против официального листа СВОД. Такая сверка умеет сказать «не
 * сходится» и не умеет сказать, КТО отстал. Одна и та же закупка живёт
 * трижды — строкой в книге своего управления, строкой на листе управления в
 * книге «Ежедневный мониторинг» и строкой в переходящем реестре «25-26», — и
 * когда две записи держат одно число, а третья другое, ответ становится
 * виден. Правой стороны продукт не назначает: он показывает большинство и
 * адреса всех трёх строк, а решает человек.
 *
 * ОДНА КАРТОЧКА НА КЛАСС, АДРЕСА ВНУТРИ (п.53). Сто двадцать расхождений
 * россыпью карточек не прочитает никто. Класс же читается одной новостью —
 * «в книгах ГРБС нет строки у восьмидесяти пяти закупок» — и раскрывается
 * списком закупок с адресами обеих книг по требованию читателя.
 *
 * У КАЖДОГО РАСХОЖДЕНИЯ ВИДЕН ОТВЕТ (п.119): какая закупка, где она в каждой
 * книге (лист, строка), какие числа с каждой стороны, в чём разница и что
 * делать. Ответ стоит прямо в карточке — уходить с вкладки за ним не надо.
 *
 * РОДОСЛОВНАЯ НАЗЫВАЕТСЯ ПЕРВОЙ (п.104): какие книги прочитаны, на какой
 * момент и сколько строк каждая дала в сверку. Число без родословной здесь
 * бесполезно — читателю нужно знать, из чего оно посчитано, чтобы спорить.
 *
 * У КАЖДОЙ МЕТРИКИ КАРТОЧКА БАЗЫ ЗНАНИЙ (п.135): у класса раскрывается
 * механизм («отчего так бывает») и поступок («что делать»), а у сводных чисел
 * — что именно сложено. Оговорка о допуске сравнения стоит рядом с числами,
 * а не в конце страницы: без неё разрыв в десять рублей читался бы как ошибка.
 *
 * ТЁМНАЯ ТЕМА РАЗДЕЛЯЕТ ПОВЕРХНОСТИ СВЕТЛОТОЙ (п.129): обводок внутри
 * карточек нет, словарь поверхностей — общий для зоны (`surfaces.ts`).
 *
 * ЧЕСТНАЯ ПУСТОТА ТРЁХ РОДОВ (п.36) — и это три разных поступка читателя:
 * «расхождений нет» (сверка чиста, делать нечего), «книга не прочитана»
 * (перечитать сервером) и «сопоставлять нечего: у строк нет номеров процедур»
 * (проставить номера в книге). Различает их тип ответа, а не оттенок слов.
 */
import { ChevronDown, Info, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  TripleOrphan, TriplePayload, TripleRow, TripleSide, TripleState,
} from '../../lib/monitoring/triple-contract';
import { SIDE_LABELS, SIDE_SHORT, moneyOf } from '../../lib/monitoring/triple-contract';
import {
  groupFindings, orgPhrase, overviewOf, scopeTripleRows, sideAddresses, subjectOf,
  type TripleFindingGroup, type TripleFindingItem,
} from '../../lib/monitoring/triple-view';
import type { DeptScope } from '../../lib/selectors/dept-isolation';
import { fmtCount, fmtReadAt, fmtRub, fmtRubExact, pluralCount } from '../../lib/monitoring/format';
import { CARD, RULE_SECTION, TILE } from './surfaces';

const SIDE_ORDER: readonly TripleSide[] = ['book', 'sheet', 'journal'];

/** Сколько закупок класса показывать до нажатия «показать все». */
const PREVIEW = 5;

export interface TripleCheckProps {
  state: TripleState;
  /** Периметр управлений из шапки — изоляция организаций (п.127). */
  deptScope: DeptScope;
  /** Названия выбранных управлений — для честной пустоты «срез всё срезал». */
  scopeLabel: string;
  onReload: () => void;
  /** Показать закупку в реестре вкладки — дверь к строкам-основаниям (п.135). */
  onOpenCode?: (code: string) => void;
}

export function TripleCheck({
  state, deptScope, scopeLabel, onReload, onOpenCode,
}: TripleCheckProps) {
  if (state.kind === 'book-unread') {
    return (
      <Frame>
        <Empty
          title="Книга «Ежедневный мониторинг» не прочитана"
          body="Сверять нечего: двух сторон из трёх нет вовсе. Это состояние источника, а не вывод о закупках — «расхождений не найдено» здесь сказать нельзя."
          action={{ label: 'Прочитать книги заново', onClick: onReload }}
        />
      </Frame>
    );
  }
  if (state.kind === 'not-wired') {
    return (
      <Frame>
        <Empty
          title="Сверка трёх источников сервером ещё не отдаётся"
          body={`${state.message} Реестр и остальные разделы вкладки это не затрагивает: у сверки свой запрос и своя судьба.`}
          action={{ label: 'Повторить запрос', onClick: onReload }}
        />
      </Frame>
    );
  }
  if (state.kind === 'failed') {
    return (
      <Frame>
        <Empty
          title="Сверка трёх источников не ответила"
          body={state.message}
          action={{ label: 'Повторить запрос', onClick: onReload }}
        />
      </Frame>
    );
  }
  return (
    <TripleBody
      payload={state.payload}
      noCodes={state.kind === 'no-codes'}
      deptScope={deptScope}
      scopeLabel={scopeLabel}
      onReload={onReload}
      onOpenCode={onOpenCode}
    />
  );
}

function TripleBody({
  payload, noCodes, deptScope, scopeLabel, onReload, onOpenCode,
}: {
  payload: TriplePayload;
  noCodes: boolean;
  deptScope: DeptScope;
  scopeLabel: string;
  onReload: () => void;
  onOpenCode?: (code: string) => void;
}) {
  const rows = useMemo(() => scopeTripleRows(payload.rows, deptScope), [payload.rows, deptScope]);
  const groups = useMemo(() => groupFindings(rows), [rows]);
  const overview = useMemo(() => overviewOf(payload, rows), [payload, rows]);

  const realGroups = groups.filter((g) => !g.expected);
  const formGroups = groups.filter((g) => g.expected);

  return (
    <Frame>
      <Lineage payload={payload} rows={rows} />

      {noCodes ? (
        <Empty
          title="Сопоставлять нечего: у строк нет номеров процедур"
          body="Книги прочитаны, строки в них есть — но номер процедуры, по которому закупка узнаётся во всех трёх книгах, не проставлен ни в одной строке. Это не «расхождений нет»: сверка не состоялась вовсе."
          action={{ label: 'Прочитать книги заново', onClick: onReload }}
        />
      ) : rows.length === 0 ? (
        <Empty
          title="В выбранном срезе закупок нет"
          body={`Сверка идёт по всему району, а показан срез: ${scopeLabel}. Закупки, которых нет ни в книге выбранного управления, ни на его листе мониторинга, в этот срез не попадают — снимите фильтр управления в шапке, чтобы увидеть весь район.`}
        />
      ) : (
        <>
          <Overview overview={overview} />

          {realGroups.length === 0 ? (
            <Empty
              title="Расхождений нет: три книги говорят одно и то же"
              body={`Сверено ${pluralCount(overview.codesTotal, 'закупка', 'закупки', 'закупок')}, и по каждой начальная цена, факт и экономия у трёх книг сошлись в пределах допуска. Это вывод о данных, а не отсутствие проверки.`}
            />
          ) : (
            <div className="space-y-2">
              {realGroups.map((g) => (
                <ClassCard key={g.kind} group={g} onOpenCode={onOpenCode} />
              ))}
            </div>
          )}

          {payload.orphans.length > 0 && (
            <OrphanCard orphans={payload.orphans} />
          )}

          {formGroups.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Ниже — не расхождения, а форма заполнения: так книги ведутся по замыслу.
              </p>
              {formGroups.map((g) => (
                <ClassCard key={g.kind} group={g} onOpenCode={onOpenCode} />
              ))}
            </div>
          )}
        </>
      )}

      {payload.notes.length > 0 && (
        <div className="space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          {payload.notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}
    </Frame>
  );
}

// ── Шапка раздела ────────────────────────────────────────────────────

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          Сверка трёх источников
        </h2>
        <p className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Одна и та же закупка записана трижды: в книге своего управления, на листе управления
          книги «Ежедневный мониторинг» и в переходящем реестре «25-26». Здесь эти три записи
          сведены по номеру процедуры и сравнены по трём величинам — начальной цене, факту
          против цены победителя и экономии. Когда две записи держат одно число, а третья
          другое, видно, какая книга отстала; какая из них права, решает человек.
        </p>
      </div>
      {children}
    </section>
  );
}

/**
 * Родословная (п.104): из каких книг, на какой момент и сколько строк.
 * Стоит НАД числами, а не под ними: спорить с числом, не зная его источника,
 * читателю нечем.
 */
function Lineage({ payload, rows }: { payload: TriplePayload; rows: readonly TripleRow[] }) {
  const bookRows = rows.reduce((n, r) => n + r.bookRows.length, 0);
  const sheetRows = rows.reduce((n, r) => n + r.sheetRows.length, 0);
  const journalRows = rows.reduce((n, r) => n + r.journalRows.length, 0);
  const books = payload.books.read;

  return (
    <div className={`${CARD} px-4 py-3`}>
      <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
        Что с чем сверялось
      </p>
      <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
        <LineageItem
          title={SIDE_LABELS.book}
          count={bookRows}
          detail={books.length > 0
            ? `Книги: ${books.join(', ')}. Номер процедуры читается из колонки примечаний, деньги — тысячи рублей и переведены в рубли перед сравнением.`
            : 'Книги управлений в этот ответ не попали — третьей стороны в сверке нет.'}
        />
        <LineageItem
          title={SIDE_LABELS.sheet}
          count={sheetRows}
          detail="Восемь листов управлений книги «Ежедневный мониторинг»: начальная цена, цена победителя и экономия в рублях."
        />
        <LineageItem
          title={SIDE_LABELS.journal}
          count={journalRows}
          detail="Лист «25-26» — общий для района: судьба переходящих процедур, деньги в рублях."
        />
      </ul>
      <p className={`mt-2 pt-2 ${RULE_SECTION} text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400`}>
        Книга мониторинга прочитана {fmtReadAt(payload.source.readAt)}; фильтр года и периода из
        шапки к этой сверке не применяется — книги читаются целиком, и это относится к каждому
        числу раздела. Допуск сравнения разный по природе хранения: пары с книгой управления
        терпят десять рублей или один процент (книга держит тысячи с двумя знаками), пара
        «лист управления ↔ переходящий реестр» — полкопейки.
      </p>
      {Object.keys(payload.source.sheetsFailed).length > 0 && (
        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
          Прочитаны не все листы: {Object.keys(payload.source.sheetsFailed).join(', ')} — счётчики
          неполные, и «пары нет» по этим листам может означать «лист не прочитан».
        </p>
      )}
    </div>
  );
}

function LineageItem({ title, count, detail }: { title: string; count: number; detail: string }) {
  return (
    <li className={`${TILE} px-2.5 py-2`}>
      <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">{title}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
        {pluralCount(count, 'строка', 'строки', 'строк')}
      </p>
      <p className="mt-0.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{detail}</p>
    </li>
  );
}

// ── Сводка ───────────────────────────────────────────────────────────

function Overview({ overview }: { overview: ReturnType<typeof overviewOf> }) {
  return (
    <div className={`${CARD} px-4 py-3`}>
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat
          value={fmtCount(overview.codesTotal)}
          label="закупок в сверке"
          hint={`Уникальных номеров процедур во всех трёх книгах. Все три записи на месте у ${fmtCount(overview.allThreeSides)}, две из трёх — у ${fmtCount(overview.twoSides)}, одна — у ${fmtCount(overview.oneSide)}.`}
        />
        <Stat
          value={fmtCount(overview.agreed)}
          label="сошлись"
          hint={overview.expectedOnly > 0
            ? `Ни одного расхождения по всем трём величинам. Сюда включены ${pluralCount(overview.expectedOnly, 'закупка', 'закупки', 'закупок')}, где различие — форма совместной закупки, а не ошибка.`
            : 'Ни одного расхождения по всем трём величинам — начальная цена, факт и экономия у сторон совпали в пределах допуска.'}
        />
        <Stat
          value={fmtCount(overview.diverged)}
          label="разошлись"
          tone="warn"
          hint="Хотя бы одно расхождение: либо записи нет в одной из книг, либо числа сторон не совпали. Каждая такая закупка разобрана карточками ниже."
        />
        <Stat
          value={overview.deltaSumRub === null ? '—' : fmtRub(overview.deltaSumRub)}
          label="разрыв, руб."
          hint={`Сумма расхождений там, где стороны сравнимы. Это НЕ потерянные деньги и не сумма закупок: за разошедшимися строками стоит начальная цена ${fmtRub(overview.divergedAmountRub)} руб., а разрыв — то, на сколько книги не сошлись между собой.`}
        />
      </div>
    </div>
  );
}

function Stat({
  value, label, hint, tone = 'plain',
}: { value: string; label: string; hint: string; tone?: 'plain' | 'warn' }) {
  return (
    <div className={`${TILE} px-2.5 py-2`}>
      <p className={`text-lg font-semibold tabular-nums ${
        tone === 'warn'
          ? 'text-amber-700 dark:text-amber-300'
          : 'text-zinc-800 dark:text-zinc-100'
      }`}>
        {value}
      </p>
      <p className="text-[11px] text-zinc-600 dark:text-zinc-300">{label}</p>
      <p className="mt-0.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{hint}</p>
    </div>
  );
}

// ── Карточка класса ──────────────────────────────────────────────────

/**
 * Одна карточка на класс расхождений. Заголовок отвечает «что и сколько»,
 * подзаголовок — «о каких деньгах», раскрытие — «где именно и что делать».
 */
function ClassCard({
  group, onOpenCode,
}: { group: TripleFindingGroup; onOpenCode?: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? group.items : group.items.slice(0, PREVIEW);

  return (
    <div className={`${CARD} px-4 py-3`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span>
          <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
            {group.label}
          </span>
          <span className="ml-2 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
            {pluralCount(group.items.length, 'закупка', 'закупки', 'закупок')}
            {group.deltaSumRub !== null && (
              <> · разрыв {fmtRub(group.deltaSumRub)} руб.</>
            )}
            {group.deltaSumRub === null && group.amountSumRub !== null && (
              <> · начальная цена {fmtRub(group.amountSumRub)} руб.</>
            )}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`mt-0.5 shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {group.guide !== null && (
        <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          {group.guide.why}
        </p>
      )}

      {open && (
        <div className="mt-2 space-y-1.5">
          {group.guide !== null && (
            <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
              Что делать: {group.guide.todo}
            </p>
          )}
          <ul className="space-y-1.5">
            {shown.map((item) => (
              <FindingItem
                key={`${item.row.code}:${item.finding.kind}:${item.finding.addresses.join(',')}`}
                item={item}
                onOpenCode={onOpenCode}
              />
            ))}
          </ul>
          {group.items.length > PREVIEW && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
            >
              {all
                ? `свернуть до ${PREVIEW} крупнейших`
                : `показать все ${fmtCount(group.items.length)} — сейчас видны ${PREVIEW} крупнейших`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Ответ по одному расхождению (п.119): какая закупка, где она в каждой книге,
 * какие числа с каждой стороны, в чём разница. Числа трёх сторон стоят рядом,
 * под каждым — адрес его строки: сравнивать, листая книги, читателю не надо.
 */
function FindingItem({
  item, onOpenCode,
}: { item: TripleFindingItem; onOpenCode?: (code: string) => void }) {
  const { row, finding } = item;
  const subject = subjectOf(finding.kind, row);
  const addresses = sideAddresses(row);
  const org = orgPhrase(row);

  return (
    <li className={`${TILE} px-2.5 py-2`}>
      <p className="text-[11px] leading-snug text-zinc-700 dark:text-zinc-200">
        <span className="font-mono font-medium">{row.code}</span>
        {row.subject !== '' && <> · {row.subject}</>}
      </p>
      {org !== '' && (
        <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">{org}</p>
      )}

      {/* Три числа рядом и адрес под каждым — «где она в каждой книге». */}
      <div className="mt-1.5 grid gap-1 sm:grid-cols-3">
        {SIDE_ORDER.map((s) => {
          const value = moneyOf(subject.money, s);
          const addr = addresses[s];
          const isOutlier = subject.money.outlier === s;
          return (
            <div key={s} className="min-w-0">
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{SIDE_SHORT[s]}</p>
              <p className={`text-[12px] tabular-nums ${
                isOutlier
                  ? 'font-semibold text-amber-700 dark:text-amber-300'
                  : 'text-zinc-800 dark:text-zinc-100'
              }`}>
                {value === null ? 'записи нет' : fmtRubExact(value)}
              </p>
              <p className="truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500" title={addr.join(', ')}>
                {addr.length === 0 ? '—' : addr.join(', ')}
              </p>
            </div>
          );
        })}
      </div>

      <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
        Сравнивается {subject.label}
        {finding.deltaRub !== null && (
          <>; разница <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
            {fmtRubExact(Math.abs(finding.deltaRub))} руб.
          </span></>
        )}
        {subject.money.outlier !== null && (
          <>; две записи из трёх сходятся, отстала — {SIDE_LABELS[subject.money.outlier]}</>
        )}
      </p>

      <p className="mt-1 text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
        {finding.note}
      </p>

      {onOpenCode !== undefined && (
        <button
          type="button"
          onClick={() => onOpenCode(row.code)}
          className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
        >
          <Search size={9} aria-hidden="true" /> показать эту закупку в реестре
        </button>
      )}
    </li>
  );
}

/**
 * Номера процедур, набранные с опечаткой, — отдельный класс, и он не про
 * деньги. Пара по такому номеру не строится намеренно: соединить строки по
 * догадке значит подменить книгу собственным домыслом. Догадка показывается,
 * связь — нет.
 */
function OrphanCard({ orphans }: { orphans: readonly TripleOrphan[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? orphans : orphans.slice(0, PREVIEW);

  return (
    <div className={`${CARD} px-4 py-3`}>
      <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
        Номер процедуры набран с опечаткой
        <span className="ml-2 text-[11px] font-normal tabular-nums text-zinc-500 dark:text-zinc-400">
          {pluralCount(orphans.length, 'строка', 'строки', 'строк')}
        </span>
      </p>
      <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        В этих строках номер виден, но записан не так, как в остальных книгах: латинская буква
        вместо русской, лишний пробел, иной разделитель. Пара по такому номеру не строится —
        продукт не соединяет строки по догадке. Догадка названа рядом; исправьте номер в книге,
        и закупка встанет в сверку сама.
      </p>
      <ul className="mt-2 space-y-1">
        {shown.map((o) => (
          <li key={`${o.address}:${o.text}`} className={`${TILE} px-2.5 py-1.5`}>
            <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
              {o.address} · {SIDE_SHORT[o.side]}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-700 dark:text-zinc-200">
              «{o.text}»
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
              {o.note}
              {o.subjectCandidate !== null && (
                <> Похожий предмет у закупки{' '}
                  <span className="font-mono">{o.subjectCandidate.code}</span> — совпадение слов{' '}
                  {Math.round(o.subjectCandidate.similarity * 100)} %; это подсказка, а не связь.
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      {orphans.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
        >
          {open ? `свернуть до ${PREVIEW}` : `показать все ${fmtCount(orphans.length)}`}
        </button>
      )}
    </div>
  );
}

// ── Пустоты ──────────────────────────────────────────────────────────

function Empty({
  title, body, action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={`${CARD} px-4 py-4`}>
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
        <Info size={13} aria-hidden="true" className="text-zinc-400" />
        {title}
      </p>
      <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        {body}
      </p>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
