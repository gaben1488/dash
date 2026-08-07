/**
 * Сборка доказательств числа для страницы «Отчёт» (бриф «Отчёт++», шаг 6).
 *
 * Приёмка брифа: «каждое число раскрывается до ячейки без ухода со страницы».
 * Здесь живёт чистый слой без React — превращение уже посчитанных данных
 * отчёта в ProofData для оверлея ProofOverlay.
 *
 * Закон модуля: НИ ОДНОГО нового числа. Показатель берётся ровно тот, что
 * уже напечатан на странице; строки-атомы — те, что пришли из проекции.
 * Второй дом арифметики завёлся бы мгновенно, а доказательство обязано
 * сходиться с доказываемым. Единственный счёт здесь — сумма вкладов
 * строк-атомов, и она нужна не чтобы заменить итог, а чтобы честно назвать
 * расхождение с ним, если оно есть.
 *
 * Второй закон: нет атомов и нет адреса ячейки — доказательства НЕТ, функция
 * возвращает null, и страница не рисует кнопку. Пустой оверлей врал бы
 * читателю, будто доказательство существует, но оказалось пустым.
 */
import { SVOD_SHEET_NAME, findDept, quarterLabel } from '@aemr/shared';
import type { Report } from '@aemr/core';
import type { ProofData, ProofRow } from '../../components/contract/ProofOverlay';
import { fmtCount, fmtThousands, type GrbsSectionVM } from './mappers';

/** Порог сходимости денег и счётчиков: ниже — округление, не расхождение. */
const EPS = 0.5;

/**
 * Адрес первички ГРБС «книга · вкладка». Ключ входа проекции может быть
 * латинским идентификатором, поэтому имя берётся из реестра управлений;
 * управление не опознано — показываем полное наименование, а не ключ
 * (внутренние ключи наружу не выводятся).
 */
function sheetAddress(dept: string, deptLabel: string): string {
  const entry = findDept(dept);
  return entry ? `${entry.id} · ${entry.sheetName}` : deptLabel;
}

/** Σ вкладов строк-атомов — сторона сверки с итогом, не замена итога. */
function sumRows(rows: readonly ProofRow[]): number {
  return rows.reduce((s, r) => s + r.value, 0);
}

/** Знак расхождения словом: «+»/«−» перед модулем разницы. */
function signed(delta: number, fmt: (n: number) => string): string {
  return `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))}`;
}

/**
 * Остаток отчётного квартала ГРБС: сколько плановых позиций осталось без
 * даты заключения и какие именно это строки книги.
 *
 * Перечень незаключённых проекция читает «на сейчас» (канон эфира), а
 * счётчик остатка — на дату среза. В архивном отчёте они законно расходятся,
 * и доказательство обязано назвать это вслух, а не подогнать одно под другое.
 */
export function quarterPendingProof(
  vm: GrbsSectionVM,
  quarter: 1 | 2 | 3 | 4,
): ProofData | null {
  if (vm.pendingPositions.length === 0) return null;

  const sheet = sheetAddress(vm.dept, vm.deptLabel);
  const rows: ProofRow[] = vm.pendingPositions.map((p) => ({
    sheet,
    row: p.sheetRow,
    subject: p.subject || 'Без наименования',
    value: p.planTotal,
  }));

  const parts = [
    `${fmtCount(vm.pendingCount)} = ${fmtCount(vm.totalRow.plan)} плановых позиций ` +
      `${quarterLabel(quarter)} − ${fmtCount(vm.totalRow.fact)} заключённых.`,
    `В колонке «Вклад» — плановая сумма позиции: по строкам ниже это ` +
      `${fmtThousands(sumRows(rows))} тыс. руб.`,
  ];
  if (rows.length !== vm.pendingCount) {
    parts.push(
      `Строк ниже ${fmtCount(rows.length)}, а не ${fmtCount(vm.pendingCount)}: перечень ` +
        'незаключённых читается на текущий момент, а счётчик остатка — на дату среза. ' +
        'Обе стороны показаны как есть.',
    );
  }

  return {
    metricKey: 'pending_count',
    displayValue: fmtCount(vm.pendingCount),
    formula: parts.join(' '),
    origin: 'calc',
    rows,
  };
}

/**
 * Закупки без подтверждённого финансирования: строки со способом и плановыми
 * деньгами, но без проставленного года плана. Без аргумента dept доказывается
 * районный итог, с аргументом — итог одного управления.
 *
 * Эти же строки объясняют, почему официальный лимит листа меньше нашего
 * пересчёта: формулы листа считают год строго и таких строк не видят.
 */
export function unfundedProof(report: Report, dept?: string): ProofData | null {
  const unfunded = report.unfunded;
  if (unfunded === undefined) return null;

  const groups = dept === undefined
    ? unfunded.byDept
    : unfunded.byDept.filter((d) => d.dept === dept);

  const rows: ProofRow[] = groups.flatMap((d) => {
    const sheet = sheetAddress(d.dept, d.deptLabel);
    return d.positions.map((p) => ({
      sheet,
      row: p.sheetRow,
      subject: p.subject || 'Без наименования',
      subordinate: p.subordinate,
      value: p.planTotal,
    }));
  });
  if (rows.length === 0) return null;

  // Итог берётся объявленный проекцией, а не пересчитанный по строкам:
  // на странице напечатан именно он, и доказательство обязано доказывать его.
  const declaredTotal = dept === undefined
    ? unfunded.total
    : groups.reduce((s, d) => s + d.total, 0);
  const declaredCount = dept === undefined
    ? unfunded.count
    : groups.reduce((s, d) => s + d.count, 0);

  const parts = [
    `${fmtThousands(declaredTotal)} тыс. руб. = сумма плановых сумм ` +
      `${fmtCount(declaredCount)} позиций, у которых год плана не проставлен.`,
    'Формулы официального листа такие строки не видят — в его лимит они не входят.',
  ];
  const atoms = sumRows(rows);
  if (Math.abs(atoms - declaredTotal) > EPS) {
    parts.push(
      `Строки ниже дают ${fmtThousands(atoms)} тыс. руб. — ` +
        `${signed(atoms - declaredTotal, fmtThousands)} к показанному итогу.`,
    );
  }
  if (rows.length !== declaredCount) {
    parts.push(`Строк ниже ${fmtCount(rows.length)} при счётчике ${fmtCount(declaredCount)}.`);
  }

  return {
    // Ключ этапности, а не 'plan_total': проекция относит эти же строки к доле
    // «без подтверждённого финансирования», и заголовок доказательства обязан
    // называть показатель тем же именем, каким его знает продукт.
    metricKey: 'lifecycle_stage_no_funding',
    displayValue: `${fmtThousands(declaredTotal)} тыс. руб.`,
    formula: parts.join(' '),
    origin: 'calc',
    rows,
  };
}

/** Вход доказательства официального числа — одна ячейка листа СВОД. */
export interface SvodCellProofInput {
  metricKey: string;
  /** Официальное число листа как есть, без пересчёта. */
  value: number;
  /** Адрес в нотации A1 («O2») — без него доказательства не существует. */
  cell?: string;
  /** Строка листа (1-based), если проекция её донесла. */
  sheetRow?: number;
  /** Наш пересчёт того же показателя — сторона сверки, не подмена. */
  calc?: number;
  /** Деньги печатаются с «тыс. руб.», счётчики — целыми без единицы. */
  money?: boolean;
}

/**
 * Официальное число листа СВОД: строк-атомов нет по природе показателя —
 * его считают формулы самого листа. Честная причина вместо пустоты и адрес
 * ячейки, по которому число проверяется в живой книге.
 *
 * Официал листа не подменяется нашим пересчётом: пересчёт называется рядом
 * как вторая сторона сверки, вместе с величиной расхождения.
 */
export function svodCellProof(input: SvodCellProofInput): ProofData | null {
  if (input.cell === undefined || input.cell === '') return null;

  const fmt = input.money === true ? fmtThousands : fmtCount;
  const unit = input.money === true ? ' тыс. руб.' : '';
  const displayValue = `${fmt(input.value)}${unit}`;

  const parts = [
    `${displayValue} — как записано на листе «${SVOD_SHEET_NAME}», ячейка ${input.cell}` +
      (input.sheetRow === undefined ? '' : ` (строка ${input.sheetRow})`) + '.',
  ];
  if (input.calc !== undefined) {
    const delta = input.calc - input.value;
    parts.push(
      Math.abs(delta) > EPS
        ? `Наш пересчёт из строк книг: ${fmt(input.calc)}${unit} — ${signed(delta, fmt)} к листу; ` +
            'обе стороны показаны как есть.'
        : `Наш пересчёт из строк книг сходится: ${fmt(input.calc)}${unit}.`,
    );
  }

  return {
    metricKey: input.metricKey,
    displayValue,
    formula: parts.join(' '),
    origin: 'svod',
    svodCell: input.cell,
    rows: [],
    emptyReason:
      'Строк-слагаемых нет: число посчитано формулами самого листа и взято целиком, ' +
      'без пересчёта по строкам книг. Проверить его можно в названной ячейке.',
  };
}

/** Ключ денежной плитки года → часть официального яруса листа. */
const YEAR_MONEY_PART: Readonly<Record<string, 'plan' | 'fact' | 'economy'>> = {
  plan_total: 'plan',
  fact_total: 'fact',
  economy_total: 'economy',
};

/**
 * Официальные деньги года района (строка «ИТОГО 2026:» листа СВОД) — те
 * самые числа денежных плиток сводки. Яруса листа нет либо показатель не
 * денежный — доказательства нет: плитка честно живёт без кнопки.
 */
export function officialYearMoneyProof(report: Report, metricKey: string): ProofData | null {
  const part = YEAR_MONEY_PART[metricKey];
  if (part === undefined) return null;
  const official = report.official?.yearMoney?.[part];
  if (official === undefined) return null;

  return svodCellProof({
    metricKey,
    value: official.total,
    cell: official.cell,
    sheetRow: official.row,
    calc: report.integralSummary.money[part].total,
    money: true,
  });
}
