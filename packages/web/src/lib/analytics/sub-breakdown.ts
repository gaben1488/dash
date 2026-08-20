/**
 * Разбивка управления по организациям для карточек аналитики (режим подведов,
 * приказ владельца 20.08).
 *
 * Два источника, и они не равны по роли:
 *   • ПРИСУТСТВИЕ организации задаёт канон фильтра (org-scope): учреждение,
 *     у которого в выборке нет ни строки, обязано остаться в списке — иначе
 *     «строк нет» и «организации нет» сливаются в одну немую пустоту;
 *   • ЧИСЛА берутся из снимка управления (bySubordinate) и, если период шапки
 *     сужен, — из квартального среза той же организации.
 *
 * Ноль здесь не выдумывается: у организации без чисел поля остаются null,
 * и карточка пишет словами, что строк нет (PRODUCT.md, «честная пустота»).
 */

/** Метрики организации из снимка; поля приходят по проводу как есть. */
export interface SubordinateMetricsLike {
  name: string;
  planTotal?: number | null;
  factTotal?: number | null;
  executionPct?: number | null;
  competitiveCount?: number | null;
  epCount?: number | null;
  quarters?: Record<string, {
    planTotal?: number | null;
    factTotal?: number | null;
    executionPct?: number | null;
    competitiveCount?: number | null;
    epCount?: number | null;
  } | undefined>;
}

export interface SubBreakdownRow {
  key: string;
  label: string;
  /** Есть ли у организации строки в выборке; false — «строк нет», а не ноль. */
  hasRows: boolean;
  planTotal: number | null;
  factTotal: number | null;
  executionPct: number | null;
  kpCount: number | null;
  epCount: number | null;
}

export function buildSubBreakdown(input: {
  /** Канон организаций управления: ключ и подпись (аппарат первым). */
  groups: ReadonlyArray<{ key: string; label: string }>;
  /** Метрики организаций из снимка управления. */
  subordinates: ReadonlyArray<SubordinateMetricsLike>;
  /** Период шапки: 'year' — годовые итоги, иначе квартальный срез. */
  periodKey: string;
}): SubBreakdownRow[] {
  const metrics = new Map<string, SubordinateMetricsLike>();
  for (const sub of input.subordinates) metrics.set(String(sub.name), sub);

  return input.groups.map((group) => {
    const m = metrics.get(group.key);
    const scoped = input.periodKey === 'year' ? m : m?.quarters?.[input.periodKey];
    return {
      key: group.key,
      label: group.label,
      hasRows: m != null,
      planTotal: scoped?.planTotal ?? null,
      factTotal: scoped?.factTotal ?? null,
      executionPct: scoped?.executionPct ?? null,
      kpCount: scoped?.competitiveCount ?? null,
      epCount: scoped?.epCount ?? null,
    };
  });
}

/** Итоги разбивки: суммы и сколько организаций реально ведут закупки. */
export function subBreakdownTotals(rows: readonly SubBreakdownRow[]): {
  plan: number;
  fact: number;
  withRows: number;
} {
  return {
    plan: rows.reduce((s, r) => s + (r.planTotal ?? 0), 0),
    fact: rows.reduce((s, r) => s + (r.factTotal ?? 0), 0),
    withRows: rows.filter((r) => r.hasRows && (r.planTotal ?? 0) > 0).length,
  };
}
