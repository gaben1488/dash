/**
 * recon.ts — сверка расчёта с официальным листом «СВОД ТД-ПМ»: доступность,
 * бейджи и подписи ключей.
 *
 * Класс дефекта, который здесь закрыт: бейдж «сверено» гас молча. Стоило
 * выбрать квартал кроме первого, месяц, одно управление или один бюджет — и
 * значок просто исчезал, а рядом оставались числа, про которые читатель имел
 * право думать, что они по-прежнему сверены. Теперь у каждого негорящего
 * бейджа есть причина текстом, и она показывается на экране.
 *
 * Почему сверка вообще ограничена. Официальный лист — одноактивностный
 * сводный блок «ВСЕ» по всем управлениям, по суммам всех бюджетов, за 1 кв и
 * за год. Любой более узкий срез сравнивать с ним некорректно: подмножество
 * против полного эталона всегда «разойдётся», и это будет ложная тревога.
 */
import { getMetricByKey, type SvodPeriodKey } from '@aemr/shared';

export type ReconStatus = 'ok' | 'warning' | 'high';

/** Строка сверки из ответа сервера (структурно = SvodReconRow). */
export interface ReconRow {
  /** Технический ключ официальной метрики, напр. `competitive.q1.total_plan`. */
  key: string;
  calc: number;
  official: number;
  deltaPct: number;
  status: ReconStatus;
}

/** Почему сверка недоступна. `ok` — доступна. */
export type ReconBlockCode = 'ok' | 'activity' | 'department' | 'budget' | 'period' | 'absent';

export interface ReconAvailability {
  code: ReconBlockCode;
  available: boolean;
  /** Причина одной фразой — её видит пользователь. */
  reason: string;
}

const REASON: Readonly<Record<Exclude<ReconBlockCode, 'ok'>, string>> = {
  activity: 'Официальный лист ведётся сразу по всем видам деятельности — выбранный срез сравнивать не с чем.',
  department: 'Официальный лист сверялся по всем управлениям сразу — на выбранное подмножество эталона нет.',
  budget: 'Официальный лист ведёт суммы по всем бюджетам сразу — при выбранном бюджете сверять нечего.',
  period: 'Официальный лист ведётся за 1 кв и за год — за выбранный период эталона нет.',
  absent: 'Официальный лист не прочитан — сверять не с чем.',
};

/** Периоды, за которые официальный лист вообще существует. */
const REFERENCE_PERIODS: readonly SvodPeriodKey[] = ['q1', 'year'];

export interface ReconAvailabilityInput {
  /** Выбраны все виды деятельности (срез, который считал сервер). */
  activityIsAll: boolean;
  /** Активен фильтр по управлениям. */
  deptFiltered: boolean;
  /** Активен фильтр по бюджету (ФБ/КБ/МБ). */
  budgetFiltered: boolean;
  /** Единственный ключ периода; null — период сложен из нескольких ячеек. */
  period: SvodPeriodKey | null;
  /** Пришли ли вообще строки сверки от сервера. */
  hasRows: boolean;
}

/** Доступна ли сверка для текущего среза, и если нет — почему. */
export function reconAvailability(input: ReconAvailabilityInput): ReconAvailability {
  const block = (code: Exclude<ReconBlockCode, 'ok'>): ReconAvailability => ({
    code,
    available: false,
    reason: REASON[code],
  });
  if (!input.activityIsAll) return block('activity');
  if (input.deptFiltered) return block('department');
  if (input.budgetFiltered) return block('budget');
  if (input.period === null || !REFERENCE_PERIODS.includes(input.period)) return block('period');
  if (!input.hasRows) return block('absent');
  return { code: 'ok', available: true, reason: '' };
}

export interface ReconBadge {
  status: ReconStatus | 'none';
  /** Худшее расхождение по группе, % — для подсказки. */
  worstDeltaPct: number;
  /** Сколько показателей группы сверено. */
  checked: number;
  /** Причина, по которой бейдж не горит; пустая строка, когда горит. */
  reason: string;
}

/** Технический префикс ключа сверки → раздел таблицы. */
const PREFIX_BY_METHOD: Readonly<Record<'kp' | 'ep', string>> = {
  kp: 'competitive',
  ep: 'sole',
};

const METHOD_BY_PREFIX: Readonly<Record<string, string>> = {
  competitive: 'КП',
  sole: 'ЕП',
};

const FIELD_LABEL: Readonly<Record<string, string>> = {
  count: 'количество',
  total_plan: 'план',
  total_fact: 'факт',
  economy_total: 'экономия',
};

/**
 * Подпись ключа сверки для читателя: `competitive.q1.total_plan` → «КП · план».
 * Нераспознанное НЕ показывается латиницей — вместо неё честная формулировка,
 * а сам ключ остаётся только в технической подсказке вызывающего кода.
 */
export function reconKeyLabel(key: string): string {
  const [prefix, , field] = key.split('.');
  const method = METHOD_BY_PREFIX[prefix] ?? 'раздел не распознан';
  const label = FIELD_LABEL[field] ?? 'показатель не распознан';
  return `${method} · ${label}`;
}

/** Показатель сверки — количество (штуки), а не деньги. */
export function isCountMetric(key: string): boolean {
  return key.endsWith('.count');
}

/**
 * Бейджи сверки по разделам КП и ЕП для выбранного периода.
 * Статус группы — худший статус её показателей (расхождение > предупреждение > совпало).
 */
export function reconBadges(
  recon: readonly ReconRow[],
  availability: ReconAvailability,
  period: SvodPeriodKey | null,
): { kp: ReconBadge; ep: ReconBadge } {
  const dark = (reason: string): ReconBadge => ({
    status: 'none',
    worstDeltaPct: 0,
    checked: 0,
    reason,
  });
  if (!availability.available || period === null) {
    const reason = availability.reason || REASON.period;
    return { kp: dark(reason), ep: dark(reason) };
  }

  const out = { kp: dark(REASON.absent), ep: dark(REASON.absent) };
  for (const method of ['kp', 'ep'] as const) {
    const rows = recon.filter((r) => r.key.startsWith(`${PREFIX_BY_METHOD[method]}.${period}.`));
    if (rows.length === 0) continue;
    let worst: ReconStatus = 'ok';
    let worstDelta = 0;
    for (const row of rows) {
      if (row.status === 'high' || (row.status === 'warning' && worst === 'ok')) worst = row.status;
      if (Math.abs(row.deltaPct) > Math.abs(worstDelta)) worstDelta = row.deltaPct;
    }
    out[method] = { status: worst, worstDeltaPct: worstDelta, checked: rows.length, reason: '' };
  }
  return out;
}

/** Расхождения выбранного периода, худшие первыми. */
export function reconMismatches(
  recon: readonly ReconRow[],
  availability: ReconAvailability,
  period: SvodPeriodKey | null,
): ReconRow[] {
  if (!availability.available || period === null) return [];
  return recon
    .filter((r) => r.status !== 'ok' && r.key.split('.')[1] === period)
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
}

// ── Карточка диагноста расхождения (канон п.53) ────────────────────────────
//
// Дословное требование владельца: по каждому сигналу виден ответ — КАКАЯ
// строка, ЧТО в ней и ПОЧЕМУ. До 21.08 подвал сверки показывал две трети
// карточки: «КП · план · расчёт 1 234 против листа 1 200». Не хватало третьей
// части — адреса ячейки, в которую надо смотреть, и действия с адресатом
// (работа P0-4 карты вкладки «Отчёт+Свод»).
//
// Ничего не выдумывается: адрес ячейки берётся из карты официальных метрик
// `@aemr/shared` (REPORT_MAP: ключ сверки И ЕСТЬ ключ метрики листа), а
// направление расхождения — прямое сравнение двух чисел, которые уже на
// экране. Гипотезы о причине не подменяют факт: сказано, что именно
// расходится и куда смотреть, а не «наверняка забыли год плана».

/** Кто держит сторону расхождения — к нему адресуется действие. */
export type ReconOwner = 'sheet' | 'books';

export interface ReconDiagnosis {
  /** Адрес ячейки листа СВОД в нотации A1 («K9»); пустая строка — карта ключа не знает. */
  cell: string;
  /** Имя листа-источника («СВОД ТД-ПМ»); пустая строка — карта ключа не знает. */
  sheet: string;
  /** Человеческая подпись официальной метрики из карты («КП 1 кв: итого план»). */
  officialLabel: string;
  /** В какую сторону разошлось: расчёт больше листа или меньше. */
  direction: 'calc-higher' | 'calc-lower';
  /** Чья сторона отстаёт по смыслу расхождения. */
  owner: ReconOwner;
  /** ЧТО в строке — одной фразой, без чисел (числа рисует экран рядом). */
  what: string;
  /** ПОЧЕМУ так выходит — механизм расхождения, не догадка о виновном. */
  why: string;
  /** ЧТО СДЕЛАТЬ и КОМУ. */
  action: string;
}

/**
 * Карточка диагноста для одного расхождения сверки.
 *
 * Механизм расхождения, из которого выведены обе формулировки, простой и
 * проверяемый: лист СВОД заполняется руками и сводит числа на момент своей
 * последней правки, а расчёт пересобирается из живых строк книг ГРБС при
 * каждом чтении. Поэтому «расчёт выше листа» означает строки, которых в
 * ячейку листа ещё не внесли, а «расчёт ниже листа» — строки, которые в лист
 * попали, а в периметр расчёта не вошли (чаще всего у них не проставлен год
 * плана — такая строка не принадлежит ни кварталу, ни году).
 */
export function reconDiagnosis(row: ReconRow): ReconDiagnosis {
  const entry = getMetricByKey(row.key);
  const direction = row.calc >= row.official ? 'calc-higher' : 'calc-lower';
  const cell = entry?.sourceCell ?? '';
  // Падежи развязаны: адрес нужен и в предложном («в ячейке K9»), и в
  // винительном («открыть ячейку K9»). Одна заготовка на оба места давала
  // «В ячейку листа официального листа …» — карту ключа продукт не знает
  // не так часто, но фраза читателю достаётся всё равно.
  const cellIn = cell === '' ? 'сводной ячейке официального листа' : `ячейке ${cell} официального листа`;
  const cellAcc = cell === '' ? 'сводную ячейку официального листа' : `ячейку ${cell} официального листа`;
  return {
    cell,
    sheet: entry?.sourceSheet ?? '',
    officialLabel: entry?.label ?? reconKeyLabel(row.key),
    direction,
    owner: direction === 'calc-higher' ? 'sheet' : 'books',
    what: direction === 'calc-higher'
      ? `В строках книг управлений этого показателя больше, чем записано в ${cellIn}.`
      : `В ${cellIn} этого показателя больше, чем расчёт нашёл в строках книг.`,
    why: direction === 'calc-higher'
      ? 'Лист заполняется руками и показывает состояние на момент последней правки, а расчёт пересобирается из живых строк книг при каждом чтении: строки, заведённые после правки листа, в ячейку ещё не попали.'
      : 'Расчёт берёт только строки, попавшие в периметр периода. Строка без проставленного года плана не принадлежит ни кварталу, ни году и в счёт не входит, а в сумму листа её уже внесли.',
    action: direction === 'calc-higher'
      ? `Открыть ${cellAcc} и обновить её по расчёту — лист ведёт УЭР.`
      : 'Открыть строки этого среза в Реестре и найти строки без года плана — заполняет их управление, чья это книга.',
  };
}
