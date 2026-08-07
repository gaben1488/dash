/**
 * GET /api/analytics/economic — четыре экономические метрики первого эшелона
 * доезжают до экрана (план запуска docs/superpowers/plans/2026-08-07-launch-readiness.md
 * §2: формула → тест → база знаний → провенанс → интерфейс; счёт и пороги уже
 * готовы в @aemr/core, здесь закрываются провенанс и подача).
 *
 * Роут — тонкий адаптер над чистыми функциями ядра (декабрьский навес,
 * точность планирования, разрыв освоения по источникам, соблюдение планового
 * квартала). Собственной счётной семантики он не добавляет и зоны берёт у тех
 * же функций: свой классификатор в роуте означал бы, что порог, поправленный
 * в ядре, разошёлся с цветом на экране.
 *
 * Правила чисел, из-за которых ответ устроен именно так:
 *   - процент выдаётся ТОЛЬКО вместе с числителем и знаменателем — без них
 *     карточка «откуда число» не собирается, а без карточки метрика на экран
 *     не идёт (пирамида агрегации §3.2);
 *   - пустой знаменатель даёт null и подпись «вердикта нет», а не ноль и не
 *     зелёную зону: «нет плана» и «план не исполнен» — разные управленческие
 *     новости, и путать их запрещено;
 *   - итог района собирается из СТРОК всех книг разом, а не усреднением
 *     процентов ГРБС: у каждого ГРБС свой знаменатель, и среднее по ним
 *     отвечало бы на вопрос, которого никто не задавал;
 *   - разрыв освоения — разность двух долей, и своего числителя у него нет;
 *     вместо выдуманного роут раскрывает числители и знаменатели по каждому
 *     источнику финансирования;
 *   - оговорки счёта (факт без привязки к кварталу, строки без факта, квартал,
 *     выведенный из даты) едут рядом со значением, а не теряются: метрика без
 *     них выглядела бы точнее, чем она есть.
 *
 * Период разбирает общий дом services/period-params.ts — год (или новая ось
 * years/quarters/months) и неделя-срез. Все четыре метрики ГОДОВЫЕ: квартал
 * выбора на счёт не влияет, и роут говорит об этом плашкой, а не молчит.
 *
 * Источник строк — то же правило одной оси недели, что у /api/report: срез
 * текущей недели читается из живого кэша книг ГРБС, срез прошлых недель — из
 * снимка той недели (строки-атомы снимка), чтобы история не переписывалась
 * сегодняшними правками книг. Снимка нет — живые строки с честной плашкой.
 */
import type { FastifyInstance } from 'fastify';
import type { RawRow } from '@aemr/core';
// Прямой путь к модулю метрик — временный: корневой index пакета их пока не
// реэкспортирует. Как только реэкспорт появится, строка сворачивается в общий
// импорт из '@aemr/core' выше и больше ничего менять не нужно.
import {
  decemberOverhang,
  planningAccuracy,
  quarterCompliance,
  sourceExecutionGap,
  type BudgetSource,
  type MetricZone,
  type RatioValue,
} from '@aemr/core/src/metrics/economic.js';
import { DEPARTMENTS, collectRowsByDept, floorToThursday, isoOfDayNumber } from '@aemr/shared';
import { config } from '../config.js';
import { productCalendarDay } from '../services/product-calendar.js';
import { getDeptSheetValues, getSnapshotAtOrBefore } from '../services/snapshot.js';
import {
  parsePeriodQuery,
  resolvePeriodParams,
  type PeriodQuery,
} from '../services/period-params.js';

// ── Форма ответа ─────────────────────────────────────────────────────

/**
 * Ключи метрик ответа. Тот же набор — у карточек базы знаний в вебе: по нему
 * интерфейс находит объяснение метрики, поэтому ключи менять нельзя, не
 * поправив базу знаний.
 */
export type EconomicMetricKey =
  | 'december_overhang'
  | 'planning_accuracy'
  | 'source_execution_gap'
  | 'quarter_compliance';

/** Доля с раскрытым отношением: значение неотделимо от своих частей. */
export interface RatioPayload {
  /** Проценты (40 = 40 %); null — знаменателя нет. */
  value: number | null;
  numerator: number;
  denominator: number;
}

/** Общая часть любой метрики ответа: число, вердикт и оговорки счёта. */
export interface MetricPayload {
  /** Русское название метрики — подпись плитки. */
  label: string;
  /** Значение; null — считать не из чего. */
  value: number | null;
  /** Единица: проценты или процентные пункты (разность долей). */
  unit: '%' | 'п.п.';
  /** Числитель; null — у разности долей своего числителя нет. */
  numerator: number | null;
  denominator: number | null;
  zone: MetricZone | null;
  /** Подпись зоны для читателя; при null-зоне — честное «вердикта нет». */
  zoneLabel: string;
  /** Что уточняет число: пропуски привязки, исключённые строки, допущения. */
  caveats: string[];
}

export interface DecemberOverhangPayload extends MetricPayload {
  /** Та же доля по числу процедур — другой знаменатель, другой ответ. */
  byCount: RatioPayload;
}

export interface PlanningAccuracyPayload extends MetricPayload {
  /** Буквенная оценка PEFA PI-1 по агрегатному отклонению. */
  grade: 'A' | 'B' | 'C' | 'D' | null;
  /** Отклонение со знаком: минус — потрачено меньше плана. */
  signedValue: number | null;
  /** Медиана построчного отклонения — разброс, который агрегат прячет. */
  medianValue: number | null;
  medianRowCount: number;
  planTotal: number;
  factTotal: number;
}

export interface SourceExecutionGapPayload extends MetricPayload {
  /** Освоение по каждому источнику — числители разрыва раскрыты здесь. */
  bySource: Record<BudgetSource, RatioPayload>;
  /** Пара источников, давшая максимум: адрес проблемы, а не только число. */
  widestPair: [BudgetSource, BudgetSource] | null;
}

export interface QuarterCompliancePayload extends MetricPayload {
  /** Средний сдвиг в кварталах (факт минус план). */
  meanShiftQuarters: number | null;
}

export interface EconomicMetricsPayload {
  december_overhang: DecemberOverhangPayload;
  planning_accuracy: PlanningAccuracyPayload;
  source_execution_gap: SourceExecutionGapPayload;
  quarter_compliance: QuarterCompliancePayload;
}

export interface EconomicScopePayload {
  /** Короткое имя ГРБС; у итога района — пусто. */
  dept: string | null;
  /** Подпись строки для читателя. */
  name: string;
  metrics: EconomicMetricsPayload;
}

// ── Подписи ──────────────────────────────────────────────────────────

const METRIC_LABELS: Record<EconomicMetricKey, string> = {
  december_overhang: 'Декабрьский навес',
  planning_accuracy: 'Точность планирования',
  source_execution_gap: 'Разрыв освоения по источникам',
  quarter_compliance: 'Соблюдение планового квартала',
};

/**
 * Подписи зон. Слово вместо голого цвета: «жёлтый» ничего не сообщает тому,
 * кто принимает решение, а «риск возврата целевых средств» — сообщает.
 */
const ZONE_LABELS: Record<EconomicMetricKey, Record<MetricZone, string>> = {
  december_overhang: {
    normal: 'Норма',
    yellow: 'Повышенный навес',
    red: 'Критический навес',
  },
  planning_accuracy: {
    normal: 'План достоверен',
    yellow: 'Отклонение заметное',
    red: 'План недостоверен',
  },
  source_execution_gap: {
    normal: 'Норма',
    yellow: 'Источники расходятся',
    red: 'Риск возврата целевых средств',
  },
  quarter_compliance: {
    normal: 'Норма',
    yellow: 'График сдвигается',
    red: 'График не соблюдается',
  },
};

/** Зоны нет — значит нет и знаменателя. Молчать об этом нельзя. */
const NO_VERDICT = 'Вердикта нет: считать не из чего';

const zoneLabelOf = (key: EconomicMetricKey, zone: MetricZone | null): string =>
  zone === null ? NO_VERDICT : ZONE_LABELS[key][zone];

/** Тысячи рублей в человеческом виде — разряды пробелами, без хвоста копеек. */
const ruAmount = (value: number): string =>
  value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

/** Номер суток → «дд.мм.гггг» — формат дат в плашках читателю. */
const ruDateOfDay = (day: number): string => isoOfDayNumber(day).split('-').reverse().join('.');

const ratioPayload = (r: RatioValue): RatioPayload => ({
  value: r.pct,
  numerator: r.numerator,
  denominator: r.denominator,
});

// ── Счёт ─────────────────────────────────────────────────────────────

interface MetricScope {
  /** Год: навес читает его как год факта, остальные три — как год плана. */
  year: number;
  /** Номер суток среза; не задан — прямой эфир, гейт факта не применяется. */
  asOfDay?: number;
}

/**
 * Четыре метрики одного периметра строк. Периметр задаётся вызывающим кодом
 * (книга ГРБС или все книги района), а фильтр строк, гейт факта и пороги —
 * внутри функций ядра, одни и те же для любого периметра.
 */
function metricsOf(rows: readonly RawRow[], scope: MetricScope): EconomicMetricsPayload {
  const opts = {
    year: scope.year,
    ...(scope.asOfDay !== undefined ? { asOfDay: scope.asOfDay } : {}),
  };

  const overhang = decemberOverhang(rows, opts);
  const accuracy = planningAccuracy(rows, opts);
  const gap = sourceExecutionGap(rows, opts);
  const compliance = quarterCompliance(rows, opts);

  const overhangCaveats: string[] = [];
  if (overhang.unattributed.count > 0) {
    overhangCaveats.push(
      `Факт без привязки к кварталу: строк — ${overhang.unattributed.count}, `
      + `денег — ${ruAmount(overhang.unattributed.amount)} тыс. руб. Эти деньги остаются `
      + 'в знаменателе и занижают индекс: значит, не работает привязка, а не отсутствует навес.',
    );
  }
  if (overhang.quarterFromDateCount > 0) {
    overhangCaveats.push(
      'Квартал факта выведен из даты заключения там, где столбец «Квартал (факт)» пуст: '
      + `таких строк — ${overhang.quarterFromDateCount}.`,
    );
  }

  const accuracyCaveats: string[] = [];
  if (accuracy.pendingRows.length > 0) {
    accuracyCaveats.push(
      `Строк без факта в периметр не включено: ${accuracy.pendingRows.length}. `
      + 'Незаключённая процедура — ещё не недоосвоение, и её нулевой факт дал бы '
      + 'отклонение на пустом месте.',
    );
  }
  if (accuracy.zeroPlanRows.length > 0) {
    accuracyCaveats.push(
      `Строк с нулевым планом: ${accuracy.zeroPlanRows.length} — в медиану они не вошли, `
      + 'делить не на что.',
    );
  }
  if (accuracy.medianPct !== null) {
    accuracyCaveats.push(
      `Медиана построчного отклонения посчитана по строкам числом ${accuracy.medianRowCount}: `
      + 'агрегат в норме при большой медиане означает, что ошибки строк гасят друг друга.',
    );
  }

  const gapCaveats: string[] = [
    'Разрыв — разность двух долей, и своего числителя у него нет: числители и знаменатели '
    + 'раскрыты отдельно по каждому источнику финансирования.',
  ];
  if (gap.sourcesWithoutPlan.length > 0) {
    gapCaveats.push(
      `Без плана и потому вне сравнения: ${gap.sourcesWithoutPlan.join(', ')}.`,
    );
  }

  const complianceCaveats: string[] = [];
  if (compliance.unattributedRows.length > 0) {
    complianceCaveats.push(
      `Строк с фактом, но без определимых кварталов: ${compliance.unattributedRows.length} — `
      + 'в знаменатель они не вошли.',
    );
  }
  if (compliance.quarterFromDateCount > 0) {
    complianceCaveats.push(
      'Квартал факта выведен из даты заключения: '
      + `таких строк — ${compliance.quarterFromDateCount}.`,
    );
  }
  if (compliance.assumedSameYearCount > 0) {
    complianceCaveats.push(
      'Сравнение шло в допущении «год факта равен году плана» там, где год не проставлен: '
      + `таких строк — ${compliance.assumedSameYearCount}.`,
    );
  }

  return {
    december_overhang: {
      label: METRIC_LABELS.december_overhang,
      value: overhang.money.pct,
      unit: '%',
      numerator: overhang.money.numerator,
      denominator: overhang.money.denominator,
      zone: overhang.zone,
      zoneLabel: zoneLabelOf('december_overhang', overhang.zone),
      caveats: overhangCaveats,
      byCount: ratioPayload(overhang.count),
    },
    planning_accuracy: {
      label: METRIC_LABELS.planning_accuracy,
      value: accuracy.aggregate.pct,
      unit: '%',
      numerator: accuracy.aggregate.numerator,
      denominator: accuracy.aggregate.denominator,
      zone: accuracy.zone,
      zoneLabel: zoneLabelOf('planning_accuracy', accuracy.zone),
      caveats: accuracyCaveats,
      grade: accuracy.grade,
      signedValue: accuracy.signedPct,
      medianValue: accuracy.medianPct,
      medianRowCount: accuracy.medianRowCount,
      planTotal: accuracy.planTotal,
      factTotal: accuracy.factTotal,
    },
    source_execution_gap: {
      label: METRIC_LABELS.source_execution_gap,
      value: gap.gapPp,
      unit: 'п.п.',
      // Числитель и знаменатель здесь честно пусты: см. первую оговорку.
      numerator: null,
      denominator: null,
      zone: gap.zone,
      zoneLabel: zoneLabelOf('source_execution_gap', gap.zone),
      caveats: gapCaveats,
      bySource: {
        'ФБ': ratioPayload(gap.bySource['ФБ']),
        'КБ': ratioPayload(gap.bySource['КБ']),
        'МБ': ratioPayload(gap.bySource['МБ']),
      },
      widestPair: gap.widestPair,
    },
    quarter_compliance: {
      label: METRIC_LABELS.quarter_compliance,
      value: compliance.onTime.pct,
      unit: '%',
      numerator: compliance.onTime.numerator,
      denominator: compliance.onTime.denominator,
      zone: compliance.zone,
      zoneLabel: zoneLabelOf('quarter_compliance', compliance.zone),
      caveats: complianceCaveats,
      meanShiftQuarters: compliance.meanShiftQuarters,
    },
  };
}

// ── Роут ─────────────────────────────────────────────────────────────

export async function economicMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: PeriodQuery }>('/api/analytics/economic', async (request, reply) => {
    const parsed = parsePeriodQuery(request.query);
    if (parsed.errors.length > 0) {
      // Все причины сразу: кривой запрос чинится за один заход, а не за три.
      return reply.status(400).send({
        error: 'BadRequest',
        message: parsed.errors.join(' '),
        statusCode: 400,
      });
    }

    const todayDay = productCalendarDay(new Date(), config.weeklySnapshot.utcOffsetHours);
    const period = resolvePeriodParams(parsed, { todayDay });
    const notes: string[] = [];

    // Правило источника строк («одна ось недели»): срез прошлых недель обязан
    // читаться из снимка той недели, иначе прошлое пересчитается по нынешнему
    // состоянию книг и цифра в архиве поедет задним числом.
    const currentThursday = floorToThursday(todayDay);
    let rowsByDept: Record<string, unknown[][]> | undefined;
    if (!period.live && period.asOfDay < currentThursday) {
      const snapshot = getSnapshotAtOrBefore(period.asOfDay);
      if (snapshot?.rowsByDept) {
        rowsByDept = snapshot.rowsByDept;
        // День снимка — по календарю ПРОДУКТА: момент создания снимка хранится
        // в UTC, и его UTC-срез назвал бы камчатский четверг 04:00 средой.
        const createdMs = Date.parse(snapshot.createdAt);
        const snapshotDay = Number.isNaN(createdMs)
          ? null
          : productCalendarDay(new Date(createdMs), config.weeklySnapshot.utcOffsetHours);
        notes.push(
          `Метрики посчитаны из снимка ${snapshotDay !== null ? ruDateOfDay(snapshotDay) : snapshot.createdAt}.`,
        );
      } else {
        // Честная плашка вместо тихой подмены: читатель видит сегодняшние
        // строки под прошлой датой среза — и знает об этом.
        notes.push(
          `Снимка на ${ruDateOfDay(period.asOfDay)} нет — показаны текущие данные под датой среза.`,
        );
      }
    }
    if (!rowsByDept) {
      rowsByDept = collectRowsByDept(getDeptSheetValues());
    }

    if (Object.keys(rowsByDept).length === 0) {
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        message:
          'Кэш книг ГРБС пуст — данные ещё не загружены (стартовый preload не выполнен '
          + 'или Google Sheets недоступен). Повторите запрос позже.',
        statusCode: 503,
      });
    }

    const year = period.slices[0].year;
    const years = [...new Set(period.slices.map((s) => s.year))];
    if (years.length > 1) {
      notes.push(
        `Выбрано несколько лет (${years.join(', ')}); экономические метрики годовые — `
        + `показан ${year}.`,
      );
    }
    if (period.slices.some((s) => s.from?.kind === 'quarter' || s.from?.kind === 'month')) {
      notes.push(
        'Метрики годовые по своей природе: выбор квартала или месяца на их расчёт не влияет, '
        + `счёт идёт за ${year} год целиком.`,
      );
    }

    // Гейт факта — только у архивного среза. В эфире его нет: иначе метрики
    // молча прятали бы сегодняшние заключения, которые официальный лист уже
    // показывает (канон «эфир по умолчанию»).
    const scope: MetricScope = {
      year,
      ...(period.live ? {} : { asOfDay: period.asOfDay }),
    };

    const departments: EconomicScopePayload[] = [];
    const districtRows: RawRow[] = [];
    for (const dept of DEPARTMENTS) {
      const rows = rowsByDept[dept.nameShort] as RawRow[] | undefined;
      if (!rows || rows.length === 0) continue;
      districtRows.push(...rows);
      departments.push({
        dept: dept.nameShort,
        name: dept.name,
        metrics: metricsOf(rows, scope),
      });
    }

    return {
      period: {
        year,
        asOfDay: period.asOfDay,
        asOfDate: ruDateOfDay(period.asOfDay),
        live: period.live,
        // Подпись выбора появляется только у новой формы запроса — старый
        // запрос обязан получать прежний ответ без лишних ключей.
        ...(parsed.hasSelection ? { selectionLabel: period.label } : {}),
      },
      // Итог района — из строк всех книг разом. Складывать или усреднять
      // проценты ГРБС здесь нельзя: у каждого свой знаменатель.
      district: {
        dept: null,
        name: 'Итог по району',
        metrics: metricsOf(districtRows, scope),
      } satisfies EconomicScopePayload,
      departments,
      notes,
    };
  });
}
