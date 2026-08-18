/**
 * sheet-metrics.ts — показатели листа «СВОД ТД-ПМ», которых во вкладке не было.
 *
 * Сверка с живым листом 18.08.2026 показала три яруса чисел, которые лист
 * считает сам, а «Свод» не показывал ни разу:
 *
 *   1. «План минус Факт разбивка» → «Остаток к заключ.» ФБ/КБ/МБ/ИТОГО
 *      (шапка K1:O2). Формулы листа: `=H14-L14`, `=I14-M14`, `=J14-N14`,
 *      `=K14-O14` — план минус факт по каждому источнику. На листе строка
 *      привязана к «Итого ЭА 2026», то есть считается по конкурентным
 *      процедурам за год; здесь та же арифметика применяется к любой строке
 *      среза, а привязка листа называется на экране словами.
 *
 *   2. «Доля ЭА, ЭЗК, ЭК и аналоги:» и «Доля ЕП:» — по ДЕНЬГАМ, двумя
 *      колонками: «факт» (G) и «план» (H). Формулы листа: `=O14/O29`,
 *      `=K14/K29` для ЭА и `=O26/O29`, `=K26/K29` для ЕП. Вкладка показывала
 *      долю ЕП по ШТУКАМ — другое число под тем же словом.
 *
 *   3. «Законтрактовано, %» (Q) и «Отклонение, тыс. руб» (P) — в модели строки
 *      они были (`spentPct`, `amountDeviation`), но в таблицу не выводились.
 *      Здесь для них нужен только показ, поэтому отдельных функций нет.
 *
 * Пустоты честные: нулевой знаменатель даёт null («нет базы»), а не 0 % —
 * ровно как лист, который в этом случае печатает «-» (формулы `IF(K=0;"-";…)`).
 */
import type { SvodBlock, SvodRow } from '@aemr/shared';

/** Остаток к заключению по источникам финансирования, тыс. руб. */
export interface SvodRemainder {
  fb: number | null;
  kb: number | null;
  mb: number | null;
  total: number | null;
}

/** План минус факт: null, когда хотя бы одной половины нет (не 0). */
function minus(plan: number | null, fact: number | null): number | null {
  if (plan === null || fact === null) return null;
  const v = plan - fact;
  return Number.isFinite(v) ? v : null;
}

/**
 * «Остаток к заключ.» строки: план − факт по ФБ/КБ/МБ и по ИТОГО.
 *
 * Знак положительный, когда часть плана ещё не законтрактована, — так же
 * читается и число листа (O2 = 238 922,04 при отрицательном P14 = −238 922,04:
 * «Отклонение» и «Остаток» — одна величина с разных сторон).
 */
export function remainderToConclude(row: SvodRow): SvodRemainder {
  return {
    fb: minus(row.planFB, row.factFB),
    kb: minus(row.planKB, row.factKB),
    mb: minus(row.planMB, row.factMB),
    total: minus(row.planTotal, row.factTotal),
  };
}

/** Доля способа закупки в деньгах: по факту и по плану (доли 0..1). */
export interface SvodMethodShare {
  fact: number | null;
  plan: number | null;
}

/** Доли обоих способов — пара, которая на листе стоит двумя строками. */
export interface SvodMethodShares {
  kp: SvodMethodShare;
  ep: SvodMethodShare;
}

/** Доля с честной пустотой: нулевой или отсутствующий знаменатель → null. */
function share(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole === 0) return null;
  const v = part / whole;
  return Number.isFinite(v) ? v : null;
}

/**
 * Доли ЭА и ЕП по деньгам — как строки 31–32 листа.
 *
 * Знаменатель — «ИТОГО 2026:» блока (КП+ЕП), числитель — итог своего способа.
 * Считается по уже свёрнутым суммам среза, а не усреднением процентов
 * управлений: иначе маленькое управление весило бы столько же, сколько
 * большое.
 */
export function methodShares(block: SvodBlock): SvodMethodShares {
  const total = block.total.year;
  return {
    kp: {
      fact: share(block.kp.year.factTotal, total.factTotal),
      plan: share(block.kp.year.planTotal, total.planTotal),
    },
    ep: {
      fact: share(block.ep.year.factTotal, total.factTotal),
      plan: share(block.ep.year.planTotal, total.planTotal),
    },
  };
}

/**
 * Доля ЕП по КОЛИЧЕСТВУ плановых процедур.
 *
 * На листе такого числа нет — там доля считается только по деньгам. Оставлено
 * отдельной функцией с говорящим именем, чтобы две разные доли ЕП никогда
 * больше не назывались на экране одним словом.
 */
export function epShareByCount(block: SvodBlock): number | null {
  return share(block.ep.year.planCount, block.total.year.planCount);
}
