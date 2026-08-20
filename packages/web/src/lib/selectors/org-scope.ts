/**
 * Режим подведов (приказ владельца 20.08.2026) — единая точка, по которой
 * любая страница понимает, в каком организационном срезе она находится,
 * и как разложить свои строки по подведомственным учреждениям.
 *
 * Три режима — ровно те, что умеет фильтр организаций (OrgStrip):
 *   • 'district' — управление не выбрано (или выбрано несколько):
 *     страница живёт районным срезом, разбивка по подведам не строится;
 *   • 'withSubs' — выбран ОДИН ГРБС «с подведомственными» (кнопка управления
 *     в фильтре): карточки, где это осмысленно, переходят из режима одной
 *     строки ГРБС в разбивку по подведам;
 *   • 'grbs' — выбран один ГРБС «только ГРБС» (deptOnlyMode): подведы
 *     сознательно скрыты пользователем — разбивка НЕ строится, и страница
 *     обязана сказать об этом словами, а не молча показать пусто.
 *
 * Ключи и подписи:
 *   • ключ подведа — ДОСЛОВНОЕ значение колонки C книги (canonicalName,
 *     п.51 интервью 14.08): только он строково совпадает с живыми строками;
 *   • строки самого управления сворачиваются в ORG_ITSELF_SENTINEL
 *     (@aemr/shared subordinateKey) и подписываются «Аппарат управления»;
 *   • канонический список подведов = subordinatesMap управления: подвед без
 *     единой строки в выборке ПРИСУТСТВУЕТ в разбивке с пустым списком —
 *     «строк нет» и «организации нет» обязаны различаться (честная пустота).
 *
 * ── Образец подключения (Пульт, pages/Dashboard.tsx) ─────────────────────
 *
 *   const orgScope = useOrgScope();                    // без строк: режим + список подведов
 *   // или, если у зоны есть свои отфильтрованные строки с колонкой C:
 *   const orgScope = useOrgScope(rows, (r) => subordinateKey(r.subordinate));
 *
 *   if (orgScope.mode === 'withSubs') {
 *     // карточка переключается в разбивку: orgScope.subordinates —
 *     // [{ key, label, rows }], аппарат первым, дальше подведы по алфавиту;
 *     // подвед без строк приходит с rows: [] — рисуем честное «строк нет».
 *     if (!orgScope.hasSubs) {
 *       // «У этого управления подведомственных учреждений нет» — словами.
 *     }
 *   } else if (orgScope.mode === 'grbs') {
 *     // одна строка ГРБС + оговорка «подведы скрыты режимом „только ГРБС“».
 *   } // 'district' — прежний районный вид без изменений.
 *
 * Зоны страниц повторяют этот образец; сам механизм страниц не знает.
 */
import { useMemo } from 'react';
import { ORG_ITSELF_SENTINEL, isOrgItself } from '@aemr/shared';
import { useStore } from '../../store';
import { toCanonicalDeptId } from '../dept-key';
import { ORG_ITSELF_LABEL } from '../subordinate-label';

export type OrgScopeMode = 'district' | 'grbs' | 'withSubs';

/** Одно ведро разбивки: подвед (или аппарат) и его строки из выборки зоны. */
export interface OrgScopeGroup<T> {
  /** Дословный ключ колонки C; для аппарата — ORG_ITSELF_SENTINEL. */
  key: string;
  /** Подпись для экрана: сентинел спрятан за «Аппарат управления». */
  label: string;
  /** Строки выборки зоны, легшие в это ведро; [] — строк нет (не «нет организации»). */
  rows: T[];
}

export interface OrgScope<T = unknown> {
  mode: OrgScopeMode;
  /** Кириллический канон ключа единственного выбранного ГРБС; null в 'district'. */
  dept: string | null;
  /**
   * Разбивка по организациям управления. Заполнена ТОЛЬКО в 'withSubs':
   * аппарат первым, дальше подведы (канон subordinatesMap ∪ живые ключи строк)
   * по алфавиту. В 'grbs' и 'district' — пустой массив: разбивку в этих
   * режимах строить нельзя, а не «не из чего».
   */
  subordinates: Array<OrgScopeGroup<T>>;
  /**
   * Есть ли у управления подведы ВООБЩЕ (по канону фильтра) — независимо от
   * режима. Нужен для честной фразы: 'grbs' с hasSubs=true — «подведы скрыты
   * режимом», withSubs с hasSubs=false — «у управления подведов нет».
   */
  hasSubs: boolean;
}

/** Режим и ключ управления из состояния фильтра организаций. */
export function resolveOrgScopeMode(
  selectedDepartments: ReadonlySet<string>,
  deptOnlyMode: ReadonlySet<string>,
): { mode: OrgScopeMode; dept: string | null } {
  if (selectedDepartments.size !== 1) return { mode: 'district', dept: null };
  const dept = toCanonicalDeptId([...selectedDepartments][0]);
  const only = deptOnlyMode.has(dept) || deptOnlyMode.has([...selectedDepartments][0]);
  return { mode: only ? 'grbs' : 'withSubs', dept };
}

/**
 * Разложить строки зоны по подведам управления.
 *
 * Правила объединения — те же, что у фильтра организаций (mergeSubordinates):
 * канонический список subordinatesMap ∪ живые ключи строк. Каноничный подвед
 * без строк остаётся в списке с rows: [] — пропадание организации из разбивки
 * недопустимо так же, как пропадание пункта из фильтра. Живой ключ, которого
 * канон не знает (свежая строка книги), добавляется — строку нельзя потерять.
 */
export function groupRowsBySubordinate<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  canonicalSubs: readonly string[],
): Array<OrgScopeGroup<T>> {
  const buckets = new Map<string, T[]>();
  // Канон первым — задаёт присутствие организаций без строк.
  for (const name of canonicalSubs) {
    if (!isOrgItself(name)) buckets.set(name, []);
  }
  const orgItselfRows: T[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (key === ORG_ITSELF_SENTINEL || isOrgItself(key)) {
      orgItselfRows.push(row);
      continue;
    }
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  const subs = [...buckets.entries()]
    .map(([key, bucketRows]) => ({ key, label: key, rows: bucketRows }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  return [
    // Аппарат — всегда первой строкой (порядок канона RatingTableV2),
    // даже без строк: «закупок аппарата в выборке нет» — тоже ответ.
    { key: ORG_ITSELF_SENTINEL, label: ORG_ITSELF_LABEL, rows: orgItselfRows },
    ...subs,
  ];
}

/** Чистая сборка скоупа — для тестов и вызова вне React. */
export function buildOrgScope<T>(input: {
  selectedDepartments: ReadonlySet<string>;
  deptOnlyMode: ReadonlySet<string>;
  subordinatesMap: Record<string, string[]>;
  rows?: readonly T[];
  keyOf?: (row: T) => string;
}): OrgScope<T> {
  const { mode, dept } = resolveOrgScopeMode(input.selectedDepartments, input.deptOnlyMode);
  const canonical = dept ? (input.subordinatesMap[dept] ?? []) : [];
  const realCanonical = canonical.filter((name) => !isOrgItself(name));
  if (mode !== 'withSubs') {
    return { mode, dept, subordinates: [], hasSubs: realCanonical.length > 0 };
  }
  const groups = groupRowsBySubordinate(
    input.rows ?? [],
    input.keyOf ?? (() => ORG_ITSELF_SENTINEL),
    realCanonical,
  );
  return {
    mode,
    dept,
    subordinates: groups,
    hasSubs: realCanonical.length > 0 || groups.length > 1,
  };
}

/**
 * Хук зоны страницы. Без аргументов отдаёт режим + список организаций
 * (rows каждой группы пусты); со строками зоны — полную разбивку.
 * keyOf обязан возвращать ключ-ведро колонки C — обычно
 * `subordinateKey(row.subordinate)` из @aemr/shared.
 */
export function useOrgScope<T = unknown>(
  rows?: readonly T[],
  keyOf?: (row: T) => string,
): OrgScope<T> {
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const deptOnlyMode = useStore((s) => s.deptOnlyMode);
  const subordinatesMap = useStore((s) => s.subordinatesMap);
  return useMemo(
    () => buildOrgScope({ selectedDepartments, deptOnlyMode, subordinatesMap, rows, keyOf }),
    [selectedDepartments, deptOnlyMode, subordinatesMap, rows, keyOf],
  );
}
