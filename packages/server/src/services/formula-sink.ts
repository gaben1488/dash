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
import { detectFormulaIntegrity, type FormulaDefect } from '@aemr/core';
import { setFormulaSink, type FormulaDelivery } from './source-refresh.js';

export interface BookFormulaVerdict {
  book: string;
  /** Когда разобрано. */
  at: string;
  /** Сколько строк судилось (номер закупки — число больше нуля). */
  rowsJudged: number;
  /** Дефекты книги: затёртые формулы, мутанты, непротянутые. */
  defects: FormulaDefect[];
}

const verdicts = new Map<string, BookFormulaVerdict>();

/**
 * Последние вердикты по книгам. Книги здесь нет — формулы этой книги не
 * разбирались ни разу за жизнь процесса; это НЕ «дефектов нет».
 */
export function formulaVerdicts(): BookFormulaVerdict[] {
  return [...verdicts.values()].sort((a, b) => a.book.localeCompare(b.book, 'ru'));
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
export function acceptFormulaDelivery(delivery: FormulaDelivery): void {
  const defects = detectFormulaIntegrity({
    values: delivery.values as string[][],
    formulas: delivery.formulas as string[][],
    startRow: delivery.startRow,
    book: delivery.book,
  });
  let rowsJudged = 0;
  for (const row of delivery.values ?? []) {
    const a = Number(String((row?.[0] ?? '')).trim());
    if (Number.isFinite(a) && a > 0) rowsJudged++;
  }
  verdicts.set(delivery.book, {
    book: delivery.book,
    at: new Date().toISOString(),
    rowsJudged,
    defects,
  });
}

/**
 * Вставить приёмник в розетку. Зовётся один раз при подъёме приложения.
 * Отказ разбора одной книги не роняет цикл чтения: сервер обязан дочитать
 * остальные, а поломка разбора должна быть видна в журнале, а не в тишине.
 */
export function connectFormulaSink(log?: { warn: (msg: string) => void }): void {
  setFormulaSink((delivery) => {
    try {
      acceptFormulaDelivery(delivery);
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
