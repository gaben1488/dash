// ────────────────────────────────────────────────────────────────
// Раскрытие счётчика «Расхождения» страницы «Экономия» (канон п.119:
// по каждому сигналу виден ответ — какая строка, что в ней, почему).
//
// Источник строк — перечень замечаний последнего чтения книг (fd.issues,
// уже отфильтрованный по выбранным управлениям: изоляция п.127 обеспечена
// входом). Отбираются замечания с сигналом «расхождение по признанию
// экономии»; адрес каждой строки — лист · строка · № п/п НА МОМЕНТ ЧТЕНИЯ
// (лист живёт, строки двигаются — п.98б), момент чтения назван словами.
//
// Store не читает — все данные и колбэки через пропсы, как остальные
// блоки страницы.
// ────────────────────────────────────────────────────────────────

import clsx from 'clsx';
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { ORG_ITSELF_SENTINEL, productLabel, subordinateKey } from '@aemr/shared';
import { pluralRu } from '../../lib/economy-copy';
import { readingMoment } from '../../lib/reading-moment';
import { ORG_ITSELF_LABEL, subordinateLabel } from '../../lib/subordinate-label';
import { Card, FOCUS_RING, SectionHead, TILE } from './primitives';

/** Ключ сигнала расхождения — тот же, каким Реестр фильтрует строки. */
export const ECONOMY_CONFLICT_SIGNAL = 'economyConflict';

/** Сколько строк показываем в раскрытии; остаток называется числом. */
const ROWS_VISIBLE_LIMIT = 30;

const rowsWord = (n: number) => pluralRu(n, 'строка', 'строки', 'строк');
const orgWord = (n: number) => pluralRu(n, 'организации', 'организаций', 'организаций');

/** Узкий контракт замечания — только поля, которые блок читает. */
export interface ConflictIssue {
  departmentId?: string;
  subordinateId?: string;
  sheet?: string;
  row?: number;
  rowSeq?: string;
  title?: string;
  description?: string;
}

/** Адрес строки-основания: лист · строка · № п/п (без выдумки — что есть). */
function conflictAddress(iss: ConflictIssue): string | null {
  const parts = [
    iss.sheet ? `лист ${iss.sheet}` : null,
    iss.row != null ? `строка ${iss.row}` : null,
    iss.rowSeq ? `№ п/п ${iss.rowSeq}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Режим подведов карточки (org-scope, приказ владельца 20.08.2026): при одном
 * выбранном ГРБС «с подведомственными» плоский список строк превращается в
 * разбивку по учреждениям — читатель спрашивает не «сколько расхождений у
 * управления», а «у кого именно из учреждений».
 */
export interface ConflictSubScope {
  /** Короткое имя выбранного управления — подписи адресные, а не общие. */
  deptLabel: string;
  /** Есть ли у управления подведы вообще (канон фильтра, не выборка). */
  hasSubs: boolean;
  /**
   * Канонические организации управления: ключ колонки C и подпись. Организация
   * без единого расхождения из разбивки НЕ пропадает — она называется словами
   * («расхождений нет»), потому что «нет строк» и «нет организации» —
   * разные новости.
   */
  orgs: ReadonlyArray<{ key: string; label: string }>;
}

/** Одно ведро разбивки: учреждение и его строки-расхождения. */
interface ConflictGroup {
  key: string;
  label: string;
  rows: ConflictIssue[];
}

/**
 * Разложить замечания по учреждениям управления: аппарат первым, дальше
 * организации по алфавиту. Живой ключ, которого канон не знает (свежая строка
 * книги), добавляется — строку нельзя потерять.
 */
export function groupConflictsByOrg(
  issues: readonly ConflictIssue[],
  orgs: ReadonlyArray<{ key: string; label: string }>,
): ConflictGroup[] {
  const buckets = new Map<string, ConflictIssue[]>();
  for (const org of orgs) {
    if (org.key !== ORG_ITSELF_SENTINEL) buckets.set(org.key, []);
  }
  const own: ConflictIssue[] = [];
  for (const iss of issues) {
    const raw = iss.subordinateId;
    const key = raw ? subordinateKey(raw) : ORG_ITSELF_SENTINEL;
    if (key === ORG_ITSELF_SENTINEL) { own.push(iss); continue; }
    const bucket = buckets.get(key);
    if (bucket) bucket.push(iss);
    else buckets.set(key, [iss]);
  }
  const rest = [...buckets.entries()]
    .map(([key, rows]) => ({ key, label: key, rows }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  return [{ key: ORG_ITSELF_SENTINEL, label: ORG_ITSELF_LABEL, rows: own }, ...rest];
}

export interface EconomyConflictRowsProps {
  /** Замечания-расхождения периметра (уже отфильтрованы по управлениям — п.127). */
  issues: ConflictIssue[];
  /** Счётчик hero-полосы — сумма расхождений по строкам расчёта управлений. */
  conflictsTotal: number;
  /** Момент последнего чтения книг (ISO) — тот же, что в паспорте данных. */
  lastRefreshed: string | null;
  open: boolean;
  onToggle: () => void;
  /** Переход в Реестр с готовым фильтром признака «расхождение экономии». */
  onOpenRegistry: () => void;
  /** Не null — карточка живёт в режиме подведов (см. ConflictSubScope). */
  subScope?: ConflictSubScope | null;
}

/**
 * Одна строка-основание: кто, где, что. Адрес — на момент чтения книг (п.98б),
 * оговорка о моменте стоит внизу карточки, а не у каждой строки.
 * В разбивке по учреждениям имя управления не повторяется: оно уже названо
 * заголовком карточки и фильтром.
 */
function ConflictRowLine({ iss, withDept }: { iss: ConflictIssue; withDept: boolean }) {
  const addr = conflictAddress(iss);
  return (
    <li className="text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-400">
      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
        {withDept
          ? (iss.departmentId ? productLabel(iss.departmentId) : 'Управление не определено')
          : (addr ?? 'адрес строки не сохранён')}
      </span>
      {withDept && iss.subordinateId && (
        <span className="text-zinc-500"> · {subordinateLabel(iss.subordinateId)}</span>
      )}
      {withDept && addr && <span className="text-zinc-500"> · {addr}</span>}
      <span className="block text-zinc-500">
        {iss.description || iss.title || 'Флаг «является экономией» у финансового органа и управления не совпал.'}
      </span>
    </li>
  );
}

export function EconomyConflictRows({
  issues, conflictsTotal, lastRefreshed, open, onToggle, onOpenRegistry, subScope,
}: EconomyConflictRowsProps) {
  // Нечего раскрывать и нечего объяснять — блок честно не рисуется вовсе:
  // «расхождений нет» уже сказано в hero-полосе.
  if (conflictsTotal === 0 && issues.length === 0) return null;

  // Фраза момента чтения — из единственного дома продукта (lib/reading-moment):
  // молчание сервера там не выдаётся за свежесть, и своей копии подписи здесь
  // быть не должно.
  const moment = readingMoment({ readAt: lastRefreshed });

  const detailId = 'economy-conflict-rows';

  // ── Разбивка по учреждениям (org-scope). Потолок показа общий на карточку:
  //    тридцать строк — предел читаемости, дальше читателя ведём в Реестр. ──
  const groups = subScope ? groupConflictsByOrg(issues, subScope.orgs) : null;
  let budget = ROWS_VISIBLE_LIMIT;
  const shownGroups = (groups ?? [])
    .filter(g => g.rows.length > 0)
    .map(g => {
      const shown = g.rows.slice(0, Math.max(budget, 0));
      budget -= shown.length;
      return { ...g, shown };
    });
  // Организации управления, у которых расхождений нет вовсе, — списком слов.
  const quietOrgs = (groups ?? [])
    .filter(g => g.rows.length === 0)
    .map(g => g.label);

  return (
    <Card accent="amber">
      <SectionHead
        icon={<AlertTriangle size={12} className="text-amber-600 dark:text-amber-400" />}
        title="Расхождения по признанию экономии"
        hint="финансовый орган и управление разошлись в флаге «является экономией»"
        right={
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={detailId}
            className={clsx(
              'flex items-center gap-1 text-[10px] font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-zinc-100 px-1.5 py-0.5 rounded-md transition-colors shrink-0',
              FOCUS_RING,
            )}
          >
            {open ? <ChevronUp size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
            {open ? 'Скрыть строки' : `Показать строки (${issues.length})`}
          </button>
        }
      />

      {open && (
        <div id={detailId} className="px-4 py-2.5 space-y-2">
          {issues.length === 0 ? (
            // Счётчик hero посчитан по строкам расчёта, а перечень замечаний
            // этого чтения строк не содержит — честно назвать оба факта.
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Счётчик выше насчитал {conflictsTotal} {rowsWord(conflictsTotal)} по расчёту
              управлений, но в перечень замечаний последнего чтения эти строки не попали.
              Откройте Реестр с фильтром признака — он покажет строки по текущим данным.
            </p>
          ) : groups ? (
            // ── Режим подведов: строки разложены по учреждениям управления ──
            <>
              <div className="space-y-1.5">
                {shownGroups.map(g => (
                  <div key={g.key} className={clsx(TILE, 'px-2.5 py-1.5')}>
                    <p className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300">
                      {g.label}
                      <span className="ml-1.5 font-normal text-zinc-500">
                        {g.rows.length} {rowsWord(g.rows.length)}
                      </span>
                    </p>
                    <ul className="mt-1 space-y-1">
                      {g.shown.map((iss, i) => (
                        <ConflictRowLine key={i} iss={iss} withDept={false} />
                      ))}
                    </ul>
                    {g.rows.length > g.shown.length && (
                      <p className="mt-1 text-[9px] text-zinc-500">
                        {g.shown.length === 0
                          ? `строки не показаны — потолок в ${ROWS_VISIBLE_LIMIT} ${rowsWord(ROWS_VISIBLE_LIMIT)} на карточку исчерпан, полный список в Реестре`
                          : `показаны ${g.shown.length} из ${g.rows.length} — остальные в Реестре`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {quietOrgs.length > 0 && (
                // Организация без расхождений из разбивки не пропадает: «строк
                // нет» — такой же ответ, как строка с числом.
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Расхождений нет у {quietOrgs.length} {orgWord(quietOrgs.length)}: {quietOrgs.join(', ')}.
                </p>
              )}
              {subScope && !subScope.hasSubs && (
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  У {subScope.deptLabel} подведомственных учреждений нет — все расхождения
                  принадлежат аппарату управления.
                </p>
              )}
              {issues.length !== conflictsTotal && (
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Счётчик hero-полосы ({conflictsTotal}) считает по строкам расчёта управлений,
                  в перечне замечаний последнего чтения — {issues.length} {rowsWord(issues.length)}:
                  перечни могли разойтись, если книги правились после чтения.
                </p>
              )}
            </>
          ) : (
            <>
              <ul className="space-y-1.5">
                {issues.slice(0, ROWS_VISIBLE_LIMIT).map((iss, i) => (
                  <ConflictRowLine key={i} iss={iss} withDept />
                ))}
              </ul>
              {issues.length > ROWS_VISIBLE_LIMIT && (
                <p className="text-[10px] text-zinc-500">
                  Показаны первые {ROWS_VISIBLE_LIMIT} из {issues.length} строк — полный
                  список в Реестре по кнопке ниже.
                </p>
              )}
              {issues.length !== conflictsTotal && (
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Счётчик hero-полосы ({conflictsTotal}) считает по строкам расчёта управлений,
                  в перечне замечаний последнего чтения — {issues.length} {rowsWord(issues.length)}:
                  перечни могли разойтись, если книги правились после чтения.
                </p>
              )}
            </>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <p className="text-[9px] text-zinc-500 dark:text-zinc-600">
              {moment.iso
                ? `Адреса строк верны на момент чтения книг: ${moment.phrase}. Лист живёт, строки могли сдвинуться.`
                : `Адреса строк — на последнее чтение книг, но ${moment.phrase}. Лист живёт, строки могли сдвинуться.`}
            </p>
            <button
              type="button"
              onClick={onOpenRegistry}
              className={clsx(
                'inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap',
                FOCUS_RING,
              )}
            >
              <ExternalLink size={9} aria-hidden="true" />
              Открыть строки в Реестре
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
