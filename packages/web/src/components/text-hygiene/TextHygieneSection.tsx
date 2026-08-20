/**
 * Раздел «Гигиена текста» на вкладке «Контроль» (канон п.122, приказ владельца
 * 20.08.2026: подача структурой, а не простынёй).
 *
 * ЧТО ЗДЕСЬ ПОКАЗАНО. Полный перечень находок гигиены набора и орфографии по
 * всем книгам: карточка-сводка правила text_hygiene на этой же вкладке ведёт
 * сюда. Каждая находка — строка таблицы: управление, адрес (лист · ячейка),
 * что не так, как записано (дефектное место подсвечено), готовое значение с
 * кнопкой «скопировать» — тон диагноста п.53: механизм + адрес + действие,
 * без упрёков.
 *
 * ПЕРИМЕТР И МОМЕНТ. Детекторы проходят по всем книгам целиком; период и
 * способ из шапки к разделу не применяются (канон п.58). Выбранное управление,
 * напротив, ПРИМЕНЯЕТСЯ (канон п.127, 20.08.2026): в срезе управления раздел
 * показывает только его находки — чужие книги в чужой срез не лезут. Поверх
 * него живёт локальный отбор раздела: род находки и книга внутри среза.
 * Момент чтения назван в плашке.
 *
 * ОДИН РЯД РОДОВ (приказ владельца 20.08.2026). Орфография — такой же род
 * находки, как двойной пробел, и стоит в ТОМ ЖЕ ряду чипов, а не отдельным
 * переключателем: читатель отбирает «что именно показать» одним движением.
 * Отбор по управлению действует на ОБЕ группы — и на дефекты набора, и на
 * орфографию, — а счётчик книги называет все её находки, а не половину.
 * Книга, у которой нашлась только орфография, чипом не пропадает.
 *
 * ЧЕСТНАЯ ПУСТОТА. «Дефектов не найдено — проверено N ячеек» и «книги не
 * прочитаны — проверки не было» различаются и словами, и тоном.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Clock, Copy, Info, RotateCcw, SpellCheck } from 'lucide-react';
import { productLabel } from '@aemr/shared';
import { useStore } from '../../store';
import { deptScopeOf, filterByDeptScope } from '../../lib/selectors/dept-isolation';
import { pluralRu } from '../../lib/economy-copy';
import { Card, CardHeader } from '../ui/card';
import { Chip } from '../ui/chip';
import { DataTable, TBody, THead, Td, Th, Tr } from '../ui/data-table';
import { EmptyState } from '../EmptyState';
import { SkeletonCard } from '../Skeleton';
import { KBTooltip } from '../ui/kb-tooltip';
import {
  TEXT_HYGIENE_KB,
  TEXT_HYGIENE_KIND_LABELS,
  TEXT_HYGIENE_KIND_ORDER,
  fmtCount,
  fmtMoment,
  pluralFindings,
  type TextHygieneItem,
  type TextHygieneKind,
} from './contract';
import { useTextHygiene } from './useTextHygiene';

/* ── Подсветка дефектного места в контексте ──────────────────────────── */

/**
 * Что подсвечивать в вырезке — по роду дефекта. Невидимые символы приходят
 * с сервера уже показанными явно (␣ — неразрывный пробел, ⇥ — табуляция,
 * · — символ нулевой ширины), поэтому подсветка ловит сами маркеры.
 */
const HIGHLIGHT_RE: Partial<Record<TextHygieneKind, RegExp>> = {
  double_space: / {2,}/g,
  space_before_punct: /[ ␣⇥]+[,.;:!?]/g,
  missing_space_after_punct: /[,;:](?=[A-Za-zА-Яа-яЁё])/g,
  invisible_char: /[␣⇥·]/g,
  mixed_alphabet: /[A-Za-z]+/g,
  // edge_space и registry_mismatch показывают значение целиком в кавычках —
  // подсвечивать внутри нечего, дефект в самом значении.
};

/** Дефектное место — заметной заливкой акцента, без смены смысла цветов данных. */
function Highlighted({ text, re }: { text: string; re: RegExp | undefined }) {
  if (!re) return <>{text}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (m[0].length === 0) continue;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <mark
        key={at}
        className="rounded-[2px] px-px"
        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink-strong)', boxShadow: 'inset 0 0 0 1px var(--accent-line)' }}
      >
        {m[0]}
      </mark>,
    );
    last = at + m[0].length;
  }
  if (parts.length === 0) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/* ── Кнопка «скопировать готовое значение» ───────────────────────────── */

function CopyFixButton({ fix }: { fix: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fix);
      setState('done');
    } catch {
      // Буфер обмена недоступен (например, страница не в фокусе) — говорим
      // словами, а не делаем вид, что скопировалось.
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 1600);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Скопировать готовое значение ячейки — вставляется в книгу целиком"
      aria-label="Скопировать готовое значение ячейки"
      // Рамки у кнопки нет (канон п.129): она повторяется в каждой строке
      // таблицы, и восемь десятков обводок подряд — частокол, а не форма.
      // Кнопку от ячейки отделяет светлота поверхности.
      className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-badge)] bg-[var(--surface-raised)] px-1.5 py-0.5 ds-text-3xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-strong)]"
    >
      {state === 'done'
        ? <><Check size={11} aria-hidden="true" style={{ color: 'var(--data-good)' }} /> скопировано</>
        : state === 'failed'
          ? <><AlertTriangle size={11} aria-hidden="true" style={{ color: 'var(--data-warn)' }} /> не удалось</>
          : <><Copy size={11} aria-hidden="true" /> копировать</>}
    </button>
  );
}

/** Готовое значение: моноширинно + кнопка. Значение видно, а не спрятано за кнопкой. */
function FixCell({ fix }: { fix: string }) {
  return (
    <span className="flex items-center gap-2">
      <code className="font-mono ds-text-2xs whitespace-pre-wrap break-words text-[var(--ink)]">{fix}</code>
      <CopyFixButton fix={fix} />
    </span>
  );
}

/** Адрес находки: лист · ячейка, вторым этажом — стабильный «№ п/п» (п.98б). */
function AddressCell({ sheet, cell, rowSeq }: { sheet: string; cell: string; rowSeq: string | null }) {
  return (
    <span className="block whitespace-nowrap">
      <span className="font-mono ds-text-2xs text-[var(--ink)]">{sheet} · {cell}</span>
      <span
        className="block ds-text-3xs text-[var(--ink-faint)]"
        title="«№ п/п» из колонки A — стабильный адрес: строки листа двигаются, № п/п остаётся."
      >
        {rowSeq ? `№ п/п ${rowSeq}` : '№ п/п не проставлен'}
      </span>
    </span>
  );
}

/* ── Плашка момента чтения (канон п.58) + перечитка по требованию ────── */

function PeriodBadge({
  asOf,
  rowsSource,
  onReload,
  reloading,
  scoped,
}: {
  asOf: string;
  rowsSource: string;
  onReload: () => void;
  reloading: boolean;
  /** Активен ли срез по управлению из шапки (канон п.127). */
  scoped: boolean;
}) {
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--surface-raised)] px-2 py-0.5 ds-text-3xs font-[var(--weight-medium)] text-[var(--ink-muted)]">
          <Clock size={10} aria-hidden="true" />
          <span className="tabular-nums">данные на {fmtMoment(asOf)}</span>
        </div>
        {/* Кнопка честной свежести: перечитать книги и пересчитать сейчас,
            не дожидаясь автоматической перечитки (?refresh=true на сервере). */}
        <button
          type="button"
          onClick={onReload}
          disabled={reloading}
          title="Перечитать книги и пересчитать находки прямо сейчас — не дожидаясь автоматической перечитки"
          className="inline-flex items-center gap-1 rounded-[var(--radius-badge)] bg-[var(--surface-raised)] px-1.5 py-0.5 ds-text-3xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-strong)] disabled:opacity-60"
        >
          <RotateCcw size={10} aria-hidden="true" className={reloading ? 'animate-spin' : undefined} />
          {reloading ? 'читаем…' : 'перечитать'}
        </button>
      </div>
      <span
        className="max-w-[15rem] text-right ds-text-3xs leading-tight text-[var(--ink-faint)]"
        title="Детекторы проходят по всем счётным строкам всех книг; период и способ из шапки раздел не сужают. Выбранное управление срез сужает (канон п.127)."
      >
        {scoped
          ? 'проверены все книги; показаны находки выбранных управлений (п.127)'
          : 'проверены все книги целиком; период из шапки здесь не действует'}
        {rowsSource === 'snapshot' && '; строки — из сохранённого снимка'}
      </span>
    </div>
  );
}

/* ── Раздел ──────────────────────────────────────────────────────────── */

interface FlatItem extends TextHygieneItem {
  dept: string;
  deptLatin: string;
  sheet: string;
}

/**
 * Род находки в одном ряду чипов: механические дефекты набора плюс орфография.
 * Орфография приходит отдельным списком сервера, но для читателя это такой же
 * род, как «двойные пробелы», — и отбирается тем же чипом (приказ 20.08.2026).
 */
type FindingKind = TextHygieneKind | 'spelling';

// Литеральный тип, а не расширенный FindingKind: иначе сравнение
// `kind === SPELLING_KIND` не сужает род и словарь дефектов индексируется
// ключом «орфография», которого в нём нет.
const SPELLING_KIND = 'spelling' as const;
const SPELLING_LABEL = 'орфография';

/** Подпись рода для чипа и подсказки: словарь дефектов плюс орфография. */
function findingKindLabel(kind: FindingKind): string {
  return kind === SPELLING_KIND ? SPELLING_LABEL : TEXT_HYGIENE_KIND_LABELS[kind];
}

/** Одна книга в ряду чипов управлений: обе группы находок в одном счётчике. */
interface DeptChip {
  dept: string;
  deptLatin: string;
  deptName: string;
  hygiene: number;
  spelling: number;
  total: number;
}

export function TextHygieneSection() {
  const { data, loading, error, reload } = useTextHygiene();
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<Set<FindingKind>>(new Set());

  // Изоляция по управлению (канон п.127): выбранное в шапке управление сужает
  // и находки, и чипы книг — чужие книги в чужой срез не попадают. Локальный
  // отбор раздела (deptFilter) живёт ПОВЕРХ этого среза.
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const deptScope = useMemo(() => deptScopeOf(selectedDepartments), [selectedDepartments]);
  const scopedByDept = useMemo(
    () => filterByDeptScope(data?.byDept ?? [], deptScope, (d) => d.dept),
    [data, deptScope],
  );
  const scopedLanguage = useMemo(
    () => filterByDeptScope(data?.language ?? [], deptScope, (l) => l.dept),
    [data, deptScope],
  );

  /** Плоский перечень находок: фильтры и таблица работают по одной оси. */
  const allItems: FlatItem[] = useMemo(() => {
    return scopedByDept.flatMap((d) =>
      d.items.map((item) => ({ ...item, dept: d.dept, deptLatin: d.deptLatin, sheet: d.sheet })),
    );
  }, [scopedByDept]);

  const deptItems = useMemo(
    () => (deptFilter ? allItems.filter((i) => i.dept === deptFilter) : allItems),
    [allItems, deptFilter],
  );

  /**
   * Отбор по управлению действует на ОБЕ группы: орфография сужается тем же
   * чипом книги, что и дефекты набора (приказ 20.08.2026).
   */
  const deptLanguage = useMemo(
    () => (deptFilter ? scopedLanguage.filter((l) => l.dept === deptFilter) : scopedLanguage),
    [scopedLanguage, deptFilter],
  );

  /**
   * Ряд чипов книг. Строится по ОБЪЕДИНЕНИЮ обеих групп: книга, у которой
   * нашлась только орфография, из ряда не пропадает, а счётчик называет все
   * находки книги, а не половину.
   */
  const deptChips = useMemo<DeptChip[]>(() => {
    const byDept = new Map<string, DeptChip>();
    for (const d of scopedByDept) {
      byDept.set(d.dept, {
        dept: d.dept,
        deptLatin: d.deptLatin,
        deptName: d.deptName,
        hygiene: d.items.length,
        spelling: 0,
        total: d.items.length,
      });
    }
    for (const l of scopedLanguage) {
      const chip = byDept.get(l.dept);
      if (chip) {
        chip.spelling += 1;
        chip.total += 1;
      } else {
        byDept.set(l.dept, {
          dept: l.dept,
          deptLatin: l.deptLatin,
          deptName: l.dept,
          hygiene: 0,
          spelling: 1,
          total: 1,
        });
      }
    }
    return [...byDept.values()].sort((a, b) => b.total - a.total || a.dept.localeCompare(b.dept, 'ru'));
  }, [scopedByDept, scopedLanguage]);

  /**
   * Счётчики родов — после отбора по управлению: числа чипов совпадают с тем,
   * что стоит в таблицах. Орфография считается наравне с дефектами набора.
   */
  const kindCounts = useMemo(() => {
    const counts = new Map<FindingKind, number>();
    for (const item of deptItems) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    if (deptLanguage.length > 0) counts.set(SPELLING_KIND, deptLanguage.length);
    return counts;
  }, [deptItems, deptLanguage]);

  /** Роды в одном ряду: механика набора канонным порядком, орфография замыкает. */
  const kindOrder = useMemo<FindingKind[]>(
    () => [...TEXT_HYGIENE_KIND_ORDER, SPELLING_KIND].filter((k) => (kindCounts.get(k) ?? 0) > 0),
    [kindCounts],
  );

  const filteredItems = useMemo(
    () => (kindFilter.size > 0 ? deptItems.filter((i) => kindFilter.has(i.kind)) : deptItems),
    [deptItems, kindFilter],
  );

  /** Орфография показана, пока её род не исключён отбором ряда. */
  const languageItems = useMemo(
    () => (kindFilter.size === 0 || kindFilter.has(SPELLING_KIND) ? deptLanguage : []),
    [deptLanguage, kindFilter],
  );

  /**
   * Отобрана одна орфография — таблицу набора не показываем вовсе: пустая
   * карточка «под отбор ничего не подошло» здесь была бы шумом, а не ответом.
   */
  const hygieneAsked = kindFilter.size === 0 || [...kindFilter].some((k) => k !== SPELLING_KIND);

  const toggleKind = (kind: FindingKind) => {
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const hasFilter = deptFilter !== null || kindFilter.size > 0;
  const resetFilters = () => {
    setDeptFilter(null);
    setKindFilter(new Set());
  };

  return (
    <section aria-label="Гигиена текста" className="space-y-4">
      {/* Шапка раздела: механизм словами + момент чтения. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <KBTooltip {...TEXT_HYGIENE_KB} showIcon>
            <h2 className="ds-text-lg font-[var(--weight-strong)] text-[var(--ink-strong)]">
              Гигиена текста
            </h2>
          </KBTooltip>
          <p className="ds-prose mt-0.5 ds-text-xs text-[var(--ink-muted)]">
            Дефекты набора и орфография в текстовых колонках книг: имя подведа (C),
            предмет закупки (G), обоснование ЕП (M). Каждая находка несёт адрес,
            дефектное место и готовое значение — оно копируется и вставляется в книгу
            целиком, править руками не нужно.
          </p>
        </div>
        {data && (
          <PeriodBadge
            asOf={data.asOf}
            rowsSource={data.rowsSource}
            onReload={reload}
            reloading={loading}
            scoped={deptScope !== null}
          />
        )}
      </div>

      {/* Отказ сервера: прежний ответ не стирается, момент назван в плашке. */}
      {error && (
        <div
          className="flex items-start gap-2 rounded-[var(--radius-card)] border px-4 py-3 ds-text-xs"
          style={{
            borderColor: 'color-mix(in srgb, var(--data-warn) 38%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--data-warn) 10%, transparent)',
            color: 'var(--data-warn)',
          }}
        >
          <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
          <div>
            <p>
              Перечень не прочитан: {error}
              {data && ' Ниже — находки предыдущего чтения; момент указан в плашке.'}
            </p>
            <button
              type="button"
              onClick={reload}
              className="mt-1.5 inline-flex items-center gap-1 font-[var(--weight-medium)] hover:underline"
            >
              <RotateCcw size={11} aria-hidden="true" /> Прочитать ещё раз
            </button>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Проверяем текст книг: гигиена набора и орфография</span>
          <SkeletonCard />
        </div>
      ) : !data ? (
        !error && (
          <EmptyState
            tone="problem"
            title="Перечень гигиены текста не получен"
            description="Сервер не ответил — находки не потеряны, их просто не из чего показать."
            action={{ label: 'Прочитать ещё раз', onClick: reload }}
          />
        )
      ) : data.rowsSource === 'none' ? (
        <EmptyState
          tone="problem"
          title="Строки книг не прочитаны — проверки не было"
          description="Ни живого кэша, ни сохранённого снимка: детекторам не по чему пройти. Это отсутствие данных, а не отсутствие дефектов. Нажмите «Обновить» в шапке и откройте раздел снова."
          action={{ label: 'Прочитать ещё раз', onClick: reload }}
        />
      ) : data.totals.hygieneFindings === 0 && data.totals.languageFindings === 0 ? (
        <>
          <EmptyState
            title="Дефектов не найдено"
            description={
              `Проверено ${fmtCount(data.totals.cellsChecked)} ` +
              `${pluralRu(data.totals.cellsChecked, 'ячейка', 'ячейки', 'ячеек')} в ` +
              `${data.booksChecked.length} ${pluralRu(data.booksChecked.length, 'книге', 'книгах', 'книгах')}: ` +
              'двойных пробелов, невидимых символов, латиницы в кириллице, отступлений от ' +
              'справочника и опечаток по словарю корпуса нет.'
            }
          />
          {data.booksSilent.length > 0 && (
            <p className="ds-text-2xs text-[var(--ink-muted)]">
              Оговорка: строки книг {data.booksSilent.join(', ')} не прочитаны — по ним проверки
              не было, и «дефектов нет» к ним не относится.
            </p>
          )}
        </>
      ) : allItems.length === 0 && scopedLanguage.length === 0 ? (
        // Книга находки несёт, но все они — у других управлений: срез шапки
        // (канон п.127) честно говорит об этом, а не показывает пустое место.
        <EmptyState
          title="По выбранным управлениям находок нет"
          description={
            `В книгах есть ${fmtCount(data.totals.hygieneFindings + data.totals.languageFindings)} ` +
            `${pluralFindings(data.totals.hygieneFindings + data.totals.languageFindings)}, но все они — ` +
            'у других управлений. Их перечень виден в срезе «все управления»: снимите отбор управления в шапке.'
          }
        />
      ) : (
        <>
          {/* Фильтры: управление и род дефекта. Счётчики совпадают с таблицей. */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Отбор по управлению">
              <span className="ds-text-3xs text-[var(--ink-faint)]">Управление:</span>
              <Chip
                tone="neutral"
                pressed={deptFilter === null}
                onClick={() => setDeptFilter(null)}
                title="Показать находки всех книг"
              >
                все книги
              </Chip>
              {deptChips.map((d) => (
                <Chip
                  key={d.dept}
                  tone="neutral"
                  pressed={deptFilter === d.dept}
                  onClick={() => setDeptFilter(deptFilter === d.dept ? null : d.dept)}
                  title={
                    `${d.deptName}: ${fmtCount(d.hygiene)} ${pluralFindings(d.hygiene)} набора, ` +
                    `${fmtCount(d.spelling)} ${pluralFindings(d.spelling)} орфографии`
                  }
                >
                  {productLabel(d.deptLatin)} · {fmtCount(d.total)}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Отбор по роду находки">
              <span className="ds-text-3xs text-[var(--ink-faint)]">Род находки:</span>
              {kindOrder.map((kind) => (
                <Chip
                  key={kind}
                  tone="accent"
                  pressed={kindFilter.has(kind)}
                  onClick={() => toggleKind(kind)}
                  title={
                    kind === SPELLING_KIND
                      ? 'Показать только орфографию — слова с единственным близким соседом в словаре книг'
                      : `Показать только находки рода «${findingKindLabel(kind)}»`
                  }
                >
                  {findingKindLabel(kind)} · {kindCounts.get(kind)}
                </Chip>
              ))}
              {hasFilter && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 ds-text-2xs font-[var(--weight-medium)] text-[var(--ink-muted)] hover:text-[var(--ink-strong)] hover:underline"
                >
                  <RotateCcw size={11} aria-hidden="true" /> Снять отбор раздела
                </button>
              )}
            </div>
          </div>

          {/* Перечень гигиены набора. Прокрутка живёт внутри контейнера таблицы. */}
          {deptItems.length > 0 && hygieneAsked && (
            <Card bare aria-label="Перечень дефектов набора">
              <div className="px-[var(--card-pad)] pt-[var(--card-pad)]">
                <CardHeader
                  title="Дефекты набора"
                  scope={`${fmtCount(filteredItems.length)} из ${fmtCount(deptItems.length)} ${pluralFindings(deptItems.length)}`}
                  note="Колонка C сличается со справочником имён подведов, G — с механикой набора. Готовое значение закрывает все дефекты ячейки разом."
                />
              </div>
              {filteredItems.length === 0 ? (
                <EmptyState
                  size="compact"
                  title="Под отбор раздела не подошла ни одна находка"
                  description="Скрыл их отбор по роду дефекта или управлению — снимите его, и перечень вернётся."
                  action={{ label: 'Снять отбор раздела', onClick: resetFilters }}
                />
              ) : (
                <DataTable
                  caption={`Дефекты набора текста: ${fmtCount(filteredItems.length)} ${pluralFindings(filteredItems.length)} на ${fmtMoment(data.asOf)}`}
                  captionHidden
                  maxHeight="60vh"
                >
                  <THead>
                    <tr>
                      <Th>Управление</Th>
                      <Th>Адрес</Th>
                      <Th>Что не так</Th>
                      <Th>Как записано</Th>
                      <Th>Готовое значение</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {filteredItems.map((item, i) => (
                      <Tr key={`${item.dept}-${item.cell}-${item.kind}-${i}`}>
                        <Td className="whitespace-nowrap">{productLabel(item.deptLatin)}</Td>
                        <Td><AddressCell sheet={item.sheet} cell={item.cell} rowSeq={item.rowSeq} /></Td>
                        <Td className="max-w-[16rem]">
                          <span className="block ds-text-2xs">{item.label}</span>
                          <span className="block ds-text-3xs text-[var(--ink-faint)]">
                            {TEXT_HYGIENE_KIND_LABELS[item.kind]}
                          </span>
                        </Td>
                        <Td className="max-w-[22rem]">
                          <span className="font-mono ds-text-2xs whitespace-pre-wrap break-words text-[var(--ink-muted)]">
                            <Highlighted text={item.context} re={HIGHLIGHT_RE[item.kind]} />
                          </span>
                        </Td>
                        <Td className="max-w-[24rem]"><FixCell fix={item.fix} /></Td>
                      </Tr>
                    ))}
                  </TBody>
                </DataTable>
              )}
            </Card>
          )}

          {/* Орфография — отдельной группой: слово · контекст · лист/ячейка. */}
          {languageItems.length > 0 && (
            <Card bare aria-label="Орфография">
              <div className="px-[var(--card-pad)] pt-[var(--card-pad)]">
                <CardHeader
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <SpellCheck size={14} aria-hidden="true" className="text-[var(--ink-muted)]" />
                      Орфография
                    </span>
                  }
                  scope={`${fmtCount(languageItems.length)} ${pluralFindings(languageItems.length)}`}
                  note="Словарь собран из самих книг: показываются только слова с единственным близким соседом. Решение о правке — за человеком."
                />
              </div>
              <DataTable
                caption={`Орфография по словарю корпуса: ${fmtCount(languageItems.length)} ${pluralFindings(languageItems.length)} на ${fmtMoment(data.asOf)}`}
                captionHidden
                maxHeight="50vh"
              >
                <THead>
                  <tr>
                    <Th>Управление</Th>
                    <Th>Адрес</Th>
                    <Th>Слово</Th>
                    <Th>Контекст</Th>
                    <Th>Предлагается</Th>
                    <Th>Готовое значение</Th>
                  </tr>
                </THead>
                <TBody>
                  {languageItems.map((item, i) => (
                    <Tr key={`${item.dept}-${item.cell}-${item.word}-${i}`}>
                      <Td className="whitespace-nowrap">{productLabel(item.deptLatin)}</Td>
                      <Td><AddressCell sheet={item.sheet} cell={item.cell} rowSeq={item.rowSeq} /></Td>
                      <Td className="whitespace-nowrap font-mono ds-text-2xs">{item.word}</Td>
                      <Td className="max-w-[22rem]">
                        <span className="font-mono ds-text-2xs whitespace-pre-wrap break-words text-[var(--ink-muted)]">
                          <Highlighted
                            text={item.context}
                            re={new RegExp(item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')}
                          />
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {item.suggestion ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-mono ds-text-2xs text-[var(--ink)]">{item.suggestion}</span>
                            <Chip tone={item.confidence === 'высокая' ? 'good' : 'neutral'} title={
                              item.confidence === 'высокая'
                                ? 'Сосед из ядра словаря — самых частых слов книг'
                                : 'Сосед из обычной части словаря — проверьте по смыслу'
                            }>
                              {item.confidence}
                            </Chip>
                          </span>
                        ) : (
                          <span className="ds-text-2xs text-[var(--ink-faint)]">подсказки нет</span>
                        )}
                      </Td>
                      <Td className="max-w-[24rem]"><FixCell fix={item.fix} /></Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>
            </Card>
          )}

          {/* Орфография скрыта отбором рода — говорим словами, а не пустым местом:
              исчезнувшая группа читается как «опечаток нет», а это неправда. */}
          {deptLanguage.length > 0 && languageItems.length === 0 && (
            <p className="ds-text-2xs text-[var(--ink-muted)]">
              Орфография скрыта отбором рода: {fmtCount(deptLanguage.length)}{' '}
              {pluralFindings(deptLanguage.length)} ждут — верните чип «орфография» в ряду родов.
            </p>
          )}

          {/* Орфография пуста при живой гигиене — говорим словами, а не пустым местом. */}
          {deptLanguage.length === 0 && data.totals.languageFindings === 0 && (
            <p className="ds-text-2xs text-[var(--ink-muted)]">
              Орфография: опечаток по словарю корпуса не найдено — проверены предмет закупки (G)
              и обоснование ЕП (M) всех счётных строк.
            </p>
          )}

          {/* Оговорки сервера: откуда строки, каких книг не хватает. */}
          {data.notes.length > 0 && (
            <div className="flex items-start gap-2 ds-text-2xs text-[var(--ink-muted)]">
              <Info size={13} className="mt-px shrink-0" aria-hidden="true" />
              <p className="max-w-3xl">{data.notes.join(' ')}</p>
            </div>
          )}

          {/* Итог раздела: знаменатель проверки — рядом с числом находок. */}
          <p className="text-center ds-text-3xs text-[var(--ink-faint)]">
            Проверено {fmtCount(data.totals.cellsChecked)}{' '}
            {pluralRu(data.totals.cellsChecked, 'ячейка', 'ячейки', 'ячеек')} в{' '}
            {fmtCount(data.totals.rowsChecked)}{' '}
            {pluralRu(data.totals.rowsChecked, 'счётной строке', 'счётных строках', 'счётных строках')}{' '}
            {data.booksChecked.length} {pluralRu(data.booksChecked.length, 'книги', 'книг', 'книг')} —{' '}
            {fmtCount(data.totals.hygieneFindings)} {pluralFindings(data.totals.hygieneFindings)} набора,{' '}
            {fmtCount(data.totals.languageFindings)} {pluralFindings(data.totals.languageFindings)} орфографии.
          </p>
        </>
      )}
    </section>
  );
}
