/**
 * provenance-view.ts — чистая витрина провенанса плановой суммы (без React).
 *
 * ЗАЧЕМ. Ядро (@aemr/core) классифицирует правки плановых ячеек структурно —
 * из адреса ячейки и пары чисел было/стало (канон п.27: свободный текст
 * машинно не читается). Здесь эта классификация превращается в СЛОВА, которые
 * читает специалист: «план снижен задним числом», «исправлена единица
 * измерения», «план увеличен», «план заполнен».
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО МОДУЛЯ — не выдавать молчание журнала за чистые данные.
 * Журнал правок ведётся крайне неравномерно (замер 18.08 по восьми книгам: от
 * 33 724 записей у одного управления до 13 у другого), поэтому пустая лента
 * означает либо «плановую сумму не правили», либо «следов нет вовсе», и эти два
 * исхода обязаны выглядеть по-разному. Оценку даёт assessJournal.
 *
 * ЕДИНИЦЫ. Ленту считаем в тысячах рублей — ровно так ведут книги (канон п.52),
 * и округлять её до общей единицы дэшборда нельзя: снижение на 0,4 тыс. руб.
 * при округлении до тысяч превратилось бы в ноль, то есть в «ничего не было».
 */
import { pluralRu } from '../../lib/economy-copy';
import type {
  PlanEvent,
  PlanEventKind,
  RowProvenanceResponse,
} from '../../lib/provenance/contract';

/** Тон элемента ленты — ключ палитры PlanProvenanceView.tsx (обе темы там же). */
export type ProvenanceTone = 'red' | 'amber' | 'violet' | 'zinc';

/** Подпись вида правки: слова, пояснение механизма и тон. */
interface KindMeta {
  label: string;
  hint: string;
  tone: ProvenanceTone;
  /** true — событие рисуется крупнее: ради него секцию и открывают. */
  emphasis: boolean;
}

/**
 * Словарь видов правок. Тексты — тон диагноста (канон п.53): механизм и адрес,
 * без упрёка в адрес заполняющего. Порча данных (сдвиг разряда, дата в денежной
 * ячейке, минус) названа порчей прямо, но с действием «проверить ячейку», а не
 * с обвинением.
 */
export const PLAN_EVENT_META: Readonly<Record<PlanEventKind, KindMeta>> = {
  'retro-cut': {
    label: 'план снижен задним числом',
    hint: 'Плановую сумму уменьшили после того, как она была проставлена. Разница план−факт '
      + 'при этом схлопывается, и сэкономленные деньги перестают быть видны.',
    tone: 'red',
    emphasis: true,
  },
  raise: {
    label: 'план увеличен',
    hint: 'Плановую сумму подняли: добавили лимиты либо уточнили начальную цену.',
    tone: 'amber',
    emphasis: false,
  },
  fill: {
    label: 'план заполнен',
    hint: 'Плановая ячейка была пуста — в неё впервые внесли сумму.',
    tone: 'violet',
    emphasis: false,
  },
  clear: {
    label: 'план убран',
    hint: 'Плановую ячейку очистили. Стоит проверить, не перенесён ли план на другую строку.',
    tone: 'amber',
    emphasis: false,
  },
  'unit-fix': {
    label: 'исправлена единица измерения',
    hint: 'Сумму ввели в рублях вместо тысяч и вернули к канону книги. Плановые деньги при '
      + 'этом не менялись, в «снятое с плана» такая правка не входит.',
    tone: 'zinc',
    emphasis: false,
  },
  'scale-shift': {
    label: 'сдвинут разряд суммы',
    hint: 'У числа переехала запятая (в сто, в сто тысяч раз) — сама сумма прежняя. '
      + 'В «снятое с плана» не входит.',
    tone: 'zinc',
    emphasis: false,
  },
  'date-in-money': {
    label: 'в денежную ячейку попала дата',
    hint: 'Вместо суммы в ячейке оказалось целое число из календарной полосы. Это дефект '
      + 'заполнения, а не движение денег: ячейку надо проверить глазами.',
    tone: 'amber',
    emphasis: false,
  },
  'invalid-value': {
    label: 'плановая сумма ушла в минус',
    hint: 'Отрицательного плана не бывает — ячейка испорчена. В «снятое с плана» не входит, '
      + 'значение надо исправить в книге.',
    tone: 'amber',
    emphasis: false,
  },
  unknown: {
    label: 'прежнее значение не отслежено',
    hint: 'Журнал сам признаёт, что не запомнил прежнее значение ячейки: судить о направлении '
      + 'правки не по чему.',
    tone: 'zinc',
    emphasis: false,
  },
};

/** Русские подписи плановых колонок книги — шапка листа, не выдумка. */
const PLAN_COLUMN_RU: Readonly<Record<string, string>> = {
  H: 'план, федеральный бюджет',
  I: 'план, краевой бюджет',
  J: 'план, местный бюджет',
  K: 'план, итого',
};

/** Число в тысячах: разряды по-русски, копейки не съедаются. */
export function formatThousands(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

/** «2026-04-08T16:08:00» → «08.04.2026»; неразобранное — как пришло. */
export function formatBookDate(at: string): string {
  const m = at.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : at;
}

/**
 * «2026-04-08T16:08:00» → «16:08». Время берётся ЛИТЕРАЛЬНО, без разбора в
 * Date: журнал хранит момент по часам книги и без смещения, а пересчёт через
 * Date приписал бы ему часовой пояс читателя и сдвинул бы час правки.
 */
export function formatBookTime(at: string): string | null {
  const m = at.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Значение стороны правки словами: число, честная пустота, честное незнание. */
function sideLabel(value: number | null, known: boolean): string {
  if (!known) return 'не отслежено';
  if (value === null) return 'пусто';
  return formatThousands(value);
}

/** Элемент ленты — всё, что нужно строке показа, без единой ветки в JSX. */
export interface ProvenanceEventView {
  key: string;
  /** «08.04.2026». */
  dateLabel: string;
  /** «16:08»; null — журнал записал только дату. */
  timeLabel: string | null;
  /** Автор правки как его записал журнал; null — автор не проставлен. */
  author: string | null;
  /** Вид события словами. */
  kindLabel: string;
  /** Пояснение механизма — подсказка при наведении. */
  kindHint: string;
  /** «1 116,72 → 12» (тыс. руб.). */
  transition: string;
  /** Адрес ячейки книги («J96») — там правку видно глазами. */
  cell: string;
  /** Русское имя колонки («план, местный бюджет»). */
  columnLabel: string;
  tone: ProvenanceTone;
  emphasis: boolean;
  /** true — правка сделана уже ПОСЛЕ заключения контракта. */
  afterFact: boolean;
}

/**
 * Лента событий из ответа сервера. Порядок — от свежего к старому: читателю
 * важнее «что случилось с планом последним», а не «с чего всё начиналось».
 *
 * Порядок задаётся ЗДЕСЬ сортировкой по моменту правки, а не переворотом
 * входного массива: полагаться на то, что сервер прислал события по
 * возрастанию, значит расставить историю задом наперёд в тот день, когда
 * порядок ответа изменится, — и не заметить этого.
 */
export function buildProvenanceEvents(events: readonly PlanEvent[]): ProvenanceEventView[] {
  return [...events]
    .sort((a, b) => (a.at === b.at ? a.cell.localeCompare(b.cell) : b.at.localeCompare(a.at)))
    .map((e, index): ProvenanceEventView => {
      const meta = PLAN_EVENT_META[e.kind] ?? PLAN_EVENT_META.unknown;
      const author = e.author.trim();
      return {
        key: `${e.cell}|${e.at}|${index}`,
        dateLabel: formatBookDate(e.at),
        timeLabel: formatBookTime(e.at),
        author: author === '' ? null : author,
        kindLabel: meta.label,
        kindHint: meta.hint,
        transition: `${sideLabel(e.was, e.wasKnown)} → ${sideLabel(e.became, e.becameKnown)}`,
        cell: e.cell,
        columnLabel: PLAN_COLUMN_RU[e.column] ?? e.column,
        tone: meta.tone,
        emphasis: meta.emphasis,
        afterFact: e.factAtEdit === true,
      };
    });
}

// ── Наблюдаемость: почему лента может быть пуста ──────────────────────

/**
 * Порог «журнал почти не ведётся», записей на книгу. Взят из живого замера
 * 18.08, а не из головы: журналы книг делятся надвое с большим зазором — УО
 * 33 724, УКСиМП 4 904, УД 568 против УФБП 124, УАГЗО 70, УДТХ 34, УЭР 31,
 * УИО 13. Порог стоит ровно в этом зазоре: ниже него молчание ленты не
 * доказывает ничего, и об этом надо говорить читателю вслух.
 */
export const SCANT_JOURNAL_ENTRIES = 200;

export type JournalNoticeLevel = 'unreadable' | 'empty' | 'keyless' | 'scant';

export interface JournalNotice {
  level: JournalNoticeLevel;
  /** Заголовок плашки — одна фраза, которую читают вместо тишины. */
  title: string;
  /** Что это значит и что делать. */
  detail: string;
}

/**
 * Оценивает, можно ли вообще судить о плановой истории этой строки.
 * null — журнал книги ведётся достаточно, лента говорит сама за себя.
 *
 * Порядок проверок — от «сервер не смог» к «данных мало»: непрочитанная книга
 * не имеет права выглядеть как книга без правок, а книга с укороченной шапкой
 * журнала (все записи без номера строки — живой случай УАГЗО) не имеет права
 * выглядеть как книга, где эту закупку не трогали.
 */
export function assessJournal(p: RowProvenanceResponse): JournalNotice | null {
  const { observability } = p;
  const entries = observability.journalEntries;

  if (!p.journalAvailable) {
    return {
      level: 'unreadable',
      title: `Книга ${p.dept} сейчас не прочитана — история плановой суммы не просмотрена`,
      detail:
        (p.journalError ? `Причина: ${p.journalError}. ` : '')
        + 'Это не «правок не было» и не «журнал не ведётся»: источник не ответил. '
        + 'Повторите запрос позже; если книга молчит и дальше — проверьте доступ к ней.',
    };
  }

  if (entries === 0) {
    return {
      level: 'empty',
      title: `Журнал правок по книге ${p.dept} не ведётся — история плановой суммы пуста`,
      detail:
        'Правки плана в этой книге не фиксируются вовсе, поэтому снижение суммы задним числом '
        + 'здесь невидимо в принципе. Молчание ленты означает отсутствие следов, а не отсутствие '
        + 'правок. Сверить план можно с начальной ценой процедуры в реестре определения поставщика.',
    };
  }

  const keyless = Math.max(observability.unparsedRowKeys, p.journalRowKeyless);
  if (keyless >= entries) {
    return {
      level: 'keyless',
      title: `Записи журнала книги ${p.dept} не привязаны к закупкам — историю строки не выделить`,
      detail:
        `Журнал ведётся (${entries} записей), но ни в одной нет номера строки: книга заполняет `
        + 'его по укороченной шапке. Правки видны только целиком по книге, поэтому судить о плане '
        + 'этой закупки нельзя. Действие — добавить в журнал книги колонку «Строка».',
    };
  }

  if (entries < SCANT_JOURNAL_ENTRIES) {
    return {
      level: 'scant',
      title: `Журнал правок по книге ${p.dept} почти не ведётся — история неполна`,
      detail:
        `В журнале всего ${entries} записей, тогда как у самых аккуратных книг их десятки тысяч. `
        + 'Часть правок плана в него не попала, поэтому пустая или короткая лента ничего не '
        + 'доказывает: следа нет, а не правки не было.',
    };
  }

  return null;
}

/**
 * Что написать вместо ленты, когда событий нет, а журнал при этом в порядке.
 * Три исхода различимы, и сливать их в «правок нет» нельзя: у них разный смысл
 * и разное следующее действие.
 */
export function emptyLedgerNote(p: RowProvenanceResponse): string {
  const { observability } = p;
  if (!observability.coversRow) {
    const caveat = observability.unparsedRowKeys > 0
      ? ` У ${observability.unparsedRowKeys} записей журнала номер строки не читается — они могли `
        + 'относиться и к этой закупке.'
      : '';
    return `В журнале книги ${p.dept} нет ни одной записи об этой строке: её либо не правили с тех `
      + `пор, как журнал ведётся, либо правка в него не попала.${caveat}`;
  }
  if (observability.planEntries === 0) {
    return `Строку правили, но плановых ячеек (H, I, J, K) правки не касались: плановая сумма `
      + 'стоит такой, какой её внесли.';
  }
  return 'Правки плановых ячеек в журнале есть, но ни одна не изменила значение.';
}

// ── Итог: сколько плана ушло задним числом ────────────────────────────

export interface RetroCutHeadline {
  /** true — снятия задним числом были: показываем итог крупно. */
  present: boolean;
  /** «снято с плана задним числом: 1 104,72 тыс. ₽» либо честное отрицание. */
  title: string;
  /** Объяснение механизма — зачем читателю это число. */
  mechanism: string;
  /** Приписка про правки уже ПОСЛЕ заключения; null — таких нет либо факта нет. */
  afterFact: string | null;
  /** Приписка про правки, которые в итог НЕ вошли; null — таких нет. */
  excluded: string | null;
}

/**
 * Итоговая плашка «снято с плана задним числом».
 *
 * Механизм называется прямо (канон п.102): при перераспределении и изъятии
 * экономию отминусовывают от плановой суммы, и разница план−факт перестаёт её
 * показывать — экономия растворяется в плане. Дефекты заполнения (сдвиг
 * разряда, дата в денежной ячейке, минус) в итог НЕ входят и перечисляются
 * отдельной припиской: без неё читатель справедливо спросит, почему число
 * меньше, чем сумма всех снижений подряд.
 */
export function buildRetroCutHeadline(p: RowProvenanceResponse): RetroCutHeadline {
  const s = p.summary;
  const mechanism =
    'Снижение плановой суммы задним числом убирает разницу между планом и фактом: '
    + 'сэкономленные деньги перестают быть видны и растворяются в плане. Так делают, когда '
    + 'экономию изымают и перераспределяют на другую закупку. Честная экономия по торгам '
    + 'считается против начальной цены процедуры в реестре определения поставщика.';

  const excludedParts: string[] = [];
  if (s.unitFixCount > 0) excludedParts.push(`исправлений единиц — ${s.unitFixCount}`);
  if (s.scaleShiftCount > 0) excludedParts.push(`сдвигов разряда — ${s.scaleShiftCount}`);
  if (s.dateInMoneyCount > 0) excludedParts.push(`дат в денежной ячейке — ${s.dateInMoneyCount}`);
  if (s.invalidValueCount > 0) excludedParts.push(`отрицательных сумм — ${s.invalidValueCount}`);
  const excluded = excludedParts.length > 0
    ? `В итог не вошли: ${excludedParts.join(', ')}. Это дефекты записи, а не движение денег.`
    : null;

  if (s.retroCutCount === 0) {
    return {
      present: false,
      title: 'Задним числом план не снижали',
      mechanism,
      afterFact: null,
      excluded,
    };
  }

  const afterFact = s.retroCutAfterFactCount !== null && s.retroCutAfterFactCount > 0
    ? `Из них ${s.retroCutAfterFactCount} — уже ПОСЛЕ заключения контракта, на `
      + `${formatThousands(s.retroCutAfterFactTotal ?? 0)} тыс. ₽. Правка плана после заключения — `
      + 'самый прямой признак того, что экономию изъяли.'
    : null;

  return {
    present: true,
    title: `Снято с плана задним числом: ${formatThousands(s.retroCutTotal)} тыс. ₽`
      + ` (${s.retroCutCount} ${pluralRu(s.retroCutCount, 'правка', 'правки', 'правок')})`,
    mechanism,
    afterFact,
    excluded,
  };
}
