/**
 * Изоляция среза по управлению (канон п.127, владелец 20.08.2026):
 * «никакие сигналы, замечания и т.д. не лезут в фильтр не к своим управлениям».
 *
 * Два правила, общие для всех поверхностей:
 *   1. При выбранном управлении экран показывает ТОЛЬКО записи этого
 *      управления — сравнение идёт по обеим формам ключа (кириллица+латиница,
 *      см. bothDeptKeyForms, «второе ружьё» Б5).
 *   2. Запись без ключа управления — районная: её место — срез «все
 *      управления», в срез конкретного управления она не попадает.
 *
 * Модуль намеренно крошечный и чистый: секции с собственным источником данных
 * (комментарии против структуры, гигиена текста, оценка управлений, сигналы
 * мониторинга) зовут его вместо самодельных сравнений — так у изоляции один
 * дом и один страж-тест.
 */
import { bothDeptKeyForms } from '../dept-key';

/** Периметр управлений из шапки; null — фильтра нет, показывается всё. */
export type DeptScope = ReadonlySet<string> | null;

/** Периметр из выбранных в шапке управлений (пустой выбор = фильтра нет). */
export function deptScopeOf(selected: Iterable<string>): DeptScope {
  const keys = [...selected];
  if (keys.length === 0) return null;
  return bothDeptKeyForms(keys);
}

/**
 * Попадает ли запись с данным ключом управления в периметр.
 * Ключ пуст → запись районная → в срезе управления скрыта (правило 2).
 */
export function inDeptScope(scope: DeptScope, deptKey: string | null | undefined): boolean {
  if (scope === null) return true;
  if (deptKey === null || deptKey === undefined || deptKey === '') return false;
  return scope.has(deptKey);
}

/** Отбор списка по ключу управления записи — общий для секций с своим источником. */
export function filterByDeptScope<T>(
  items: readonly T[],
  scope: DeptScope,
  keyOf: (item: T) => string | null | undefined,
): T[] {
  if (scope === null) return [...items];
  return items.filter((item) => inDeptScope(scope, keyOf(item)));
}
