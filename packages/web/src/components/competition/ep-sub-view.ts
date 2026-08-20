// ────────────────────────────────────────────────────────────────
// Разбивка доли закупок у единственного поставщика ПО УЧРЕЖДЕНИЯМ
// управления — чистый счёт для режима подведов (приказ владельца 20.08.2026,
// образец подключения — шапка lib/selectors/org-scope.ts).
//
// Откуда числа: расчёт по книге даёт для каждой организации колонки C срез
// по способу закупки — `subordinates[].byMethod.competitive` и `.ep`
// (SubordinateMetrics, core/pipeline/recalculate.ts). Берём оттуда счёт
// плановых строк и плановые деньги — ровно те величины, из которых
// складывается доля ЕП на карточке; вторых формул здесь нет.
//
// Честность периметра: срез способа по учреждению живёт ТОЛЬКО на годовой
// сетке — сочетания «учреждение × способ × квартал» расчёт не хранит. Поэтому
// функция ничего не сужает по периоду, а карточка обязана назвать это словами
// («разбивка — за год целиком»), а не молча показать годовые числа под
// квартальным заголовком.
//
// Честная пустота трёх родов различается ключами: организация, которой нет
// в каноне и в строках, в списке не появляется вовсе; каноничная организация
// без единой счётной строки приходит с hasData=false («строк нет»); ноль
// приходит числом только когда счёт действительно нулевой при живых строках.
// ────────────────────────────────────────────────────────────────

import { ORG_ITSELF_SENTINEL, isOrgItself } from '@aemr/shared';
import { ORG_ITSELF_LABEL } from '../../lib/subordinate-label';

/** Одна строка разбивки: организация управления и её счёт способа за год. */
export interface EpSubRow {
  /** Дословный ключ колонки C; аппарат — ORG_ITSELF_SENTINEL. */
  key: string;
  /** Подпись для экрана: сентинел спрятан за «Аппарат управления». */
  label: string;
  epCount: number;
  kpCount: number;
  /** Плановые деньги, тыс. ₽. */
  epPlan: number;
  kpPlan: number;
  /** Доля ЕП по числу процедур, % — null, когда процедур нет вовсе. */
  countShare: number | null;
  /** Доля ЕП по деньгам плана, % — null, когда плана нет вовсе. */
  moneyShare: number | null;
  /** Есть ли у организации хоть одна счётная строка со способом. */
  hasData: boolean;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Доля части от целого, %. `null` при неположительном целом: делить не на что. */
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** Срез одного способа у организации: счёт плановых строк и плановые деньги. */
function methodSlice(sub: Record<string, unknown>, method: 'ep' | 'competitive'): { count: number; plan: number } {
  const byMethod = (sub.byMethod ?? {}) as Record<string, unknown>;
  const slice = (byMethod[method] ?? {}) as Record<string, unknown>;
  return { count: num(slice.planCount), plan: num(slice.planTotal) };
}

function makeRow(key: string, label: string, sub: Record<string, unknown> | undefined): EpSubRow {
  const ep = sub ? methodSlice(sub, 'ep') : { count: 0, plan: 0 };
  const kp = sub ? methodSlice(sub, 'competitive') : { count: 0, plan: 0 };
  const hasData = ep.count + kp.count > 0 || ep.plan + kp.plan > 0;
  return {
    key,
    label,
    epCount: ep.count,
    kpCount: kp.count,
    epPlan: ep.plan,
    kpPlan: kp.plan,
    countShare: hasData ? shareOf(ep.count, ep.count + kp.count) : null,
    moneyShare: hasData ? shareOf(ep.plan, ep.plan + kp.plan) : null,
    hasData,
  };
}

/**
 * Строки разбивки по организациям управления.
 *
 * Порядок — канон разбивки (org-scope): аппарат первым, дальше учреждения по
 * алфавиту. Список организаций — канон фильтра ∪ живые ключи строк: учреждение
 * из канона без строк остаётся видимым с честным «строк нет», а живое
 * учреждение, которого канон ещё не знает (свежая строка книги), не теряется.
 */
export function buildEpSubRows(
  rawSubs: readonly unknown[] | undefined,
  canonicalSubs: readonly string[],
): EpSubRow[] {
  const live = new Map<string, Record<string, unknown>>();
  let orgItself: Record<string, unknown> | undefined;

  for (const raw of rawSubs ?? []) {
    const sub = (raw ?? {}) as Record<string, unknown>;
    const name = typeof sub.name === 'string' ? sub.name : '';
    if (name === ORG_ITSELF_SENTINEL || isOrgItself(name)) {
      orgItself = sub;
      continue;
    }
    live.set(name, sub);
  }

  const keys = new Set<string>();
  for (const name of canonicalSubs) if (!isOrgItself(name)) keys.add(name);
  for (const name of live.keys()) keys.add(name);

  const subs = [...keys]
    .sort((a, b) => a.localeCompare(b, 'ru'))
    .map((name) => makeRow(name, name, live.get(name)));

  return [makeRow(ORG_ITSELF_SENTINEL, ORG_ITSELF_LABEL, orgItself), ...subs];
}

/** Итог разбивки — чтобы карточка могла сказать, сходится ли она с целым. */
export function sumEpSubRows(rows: readonly EpSubRow[]): {
  epCount: number; kpCount: number; epPlan: number; kpPlan: number; withData: number;
} {
  return rows.reduce(
    (acc, r) => ({
      epCount: acc.epCount + r.epCount,
      kpCount: acc.kpCount + r.kpCount,
      epPlan: acc.epPlan + r.epPlan,
      kpPlan: acc.kpPlan + r.kpPlan,
      withData: acc.withData + (r.hasData ? 1 : 0),
    }),
    { epCount: 0, kpCount: 0, epPlan: 0, kpPlan: 0, withData: 0 },
  );
}
