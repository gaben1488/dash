/**
 * Приёмник формул: розетка сервера ↔ слой разбора ядра.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ПУТЬ, КОГДА ЕСТЬ СНИМОК. Разбор формул внутри пересборки
 * снимка (snapshot.ts кладёт `sheetFormulas` во вход конвейера) работает
 * только тогда, когда снимок пересобирается. А самый частый случай ручной
 * починки ячейки — ровно обратный: владелец правит формулу, значения строк
 * при этом не меняются, цикл честно говорит «изменений нет — снимок не
 * пересобирался», и дефекты формул остались бы невидимыми до следующей
 * правки данных. Замер на проде 30.08 это и показал: восемь книг, 98 402
 * формульных ячейки прочитаны, а разбор не запускался.
 *
 * Поэтому чтение формул отдаётся слою ядра НАПРЯМУЮ, минуя снимок. Здесь —
 * только доставка и хранение последнего вердикта по книге; сами правила
 * (эталон графы, мутанты, дыры) живут в ядре и сюда не переезжают.
 */
import { detectFormulaIntegrity, formulaIntegrityRowNumber, type FormulaDefect } from '@aemr/core';
import { setFormulaSink, type FormulaDelivery } from './source-refresh.js';
import { loadFormulaAudits } from './source-integrity-state.js';
import type { TrustCheckCounts, TrustCheckCoverage } from '@aemr/shared';

export interface BookFormulaVerdict {
  book: string;
  /** Когда разобрано. */
  at: string;
  /** Сколько строк судилось (номер закупки — число больше нуля). */
  rowsJudged: number;
  /** Complete denominator from the SAME source read. Absent in older records: no numeric grade. */
  checks?: TrustCheckCounts;
  /** Дефекты книги: затёртые формулы, мутанты, непротянутые. */
  defects: FormulaDefect[];
}

/** Первая строка ДАННЫХ книги ГРБС: строки 1-3 — шапка (канон колонок). */
const FIRST_DATA_ROW = 4;

const verdicts = new Map<string, BookFormulaVerdict>();

/**
 * Последние вердикты по книгам. Книги здесь нет — формулы этой книги не
 * разбирались ни разу за жизнь процесса; это НЕ «дефектов нет».
 */
export function formulaVerdicts(): BookFormulaVerdict[] {
  return [...verdicts.values()].sort((a, b) => a.book.localeCompare(b.book, 'ru'));
}

/** Recover the last valid verdict, without a Google request or a weekly snapshot. */
export function restoreFormulaVerdicts(): void {
  verdicts.clear();
  for (const entry of loadFormulaAudits()) {
    if (entry.verdict) verdicts.set(entry.verdict.book, entry.verdict);
  }
}

/** Только для стражей: забыть вердикты. */
export function resetFormulaVerdicts(): void {
  verdicts.clear();
}

/**
 * Разобрать одну посылку формул и запомнить вердикт книги. Публична ради
 * стражей: розетку из source-refresh обратно не достать, а проверять надо
 * именно разбор, а не факт подключения.
 */
export function acceptFormulaDelivery(delivery: FormulaDelivery): BookFormulaVerdict {
  // ШАПКА КНИГИ НЕ СУДИТСЯ. Лист приходит целиком с первой строки, а данные
  // начинаются с четвёртой: строки 1-3 — заголовки, и третья из них несёт
  // НОМЕРА КОЛОНОК (1, 2, 3 … 27, 28). Старый гейт по одному A принимал
  // их за закупки. Сохраняем границу чтения книги; слой дополнительно
  // исключает служебные строки по назначению, в том числе внутри данных.
  const skip = Math.max(0, FIRST_DATA_ROW - delivery.startRow);
  const values = (delivery.values ?? []).slice(skip) as string[][];
  const formulas = (delivery.formulas ?? []).slice(skip) as string[][];
  const coverage: TrustCheckCoverage[] = [];
  const defects = detectFormulaIntegrity({
    values,
    formulas,
    startRow: Math.max(delivery.startRow, FIRST_DATA_ROW),
    book: delivery.book,
  }, coverage);
  let rowsJudged = 0;
  for (const row of values) {
    if (formulaIntegrityRowNumber(row ?? []) !== null) rowsJudged++;
  }
  const verdict: BookFormulaVerdict = {
    book: delivery.book,
    at: delivery.at ?? new Date().toISOString(),
    rowsJudged,
    ...(coverage[0] ? { checks: {
      expected: coverage[0].expected, checked: coverage[0].checked, failed: coverage[0].failed,
    } } : {}),
    defects,
  };
  verdicts.set(delivery.book, verdict);
  return verdict;
}

/**
 * Вставить приёмник в розетку. Зовётся один раз при подъёме приложения.
 * Отказ разбора одной книги не роняет цикл чтения: сервер обязан дочитать
 * остальные, а поломка разбора должна быть видна в журнале, а не в тишине.
 */
export function connectFormulaSink(log?: { warn: (msg: string) => void }): void {
  setFormulaSink((delivery) => {
    try {
      return acceptFormulaDelivery(delivery);
    } catch (err) {
      log?.warn(`Разбор формул книги «${delivery.book}» не состоялся: ${(err as Error).message}`);
      throw err; // источник отметит посылку как непринятую — молчания не будет
    }
  });
}

/** Вынуть приёмник (выключение службы, стражи). */
export function disconnectFormulaSink(): void {
  setFormulaSink(null);
}
