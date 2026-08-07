/**
 * GET /api/report — страница «Отчёт» как серверная проекция (волна 2A,
 * спека docs/superpowers/specs/2026-07-13-report-2-0-product-design.md §5).
 *
 * Роут — тонкий адаптер над чистым buildReport из @aemr/core: собирает вход
 * и не добавляет собственной счётной семантики. Правило источника строк —
 * одна ось недели (дизайн-док 2026-07-23 §4 R2): срез текущей недели (от
 * последнего четверга) читается из ЖИВЫХ источников, срез прошлых недель —
 * из СЛЕПКА той недели (snapshots.data: rowsByDept + svodGrid + issues),
 * чтобы история не переписывалась сегодняшними правками книг. Снимка со
 * строками нет — живые данные с честной плашкой, без тихой подмены.
 *
 * Живые источники:
 *   - строки-атомы: кэш книг ГРБС (deptSheetCache, ключи — кириллические
 *     короткие имена), шапка срезается canonical-хелпером collectRowsByDept;
 *   - официал: лист СВОД ТД-ПМ через parseSvodGrid; лист недоступен —
 *     отчёт отдаётся без официальной колонки, buildReport ставит плашку;
 *   - сигналы: issues снапшота того же года (демо-снапшот — не источник).
 *
 * Параметры (все опциональны). Старая форма — одиночный срез:
 *   year     план-год среза (2020..2100); дефолт — год даты среза;
 *   quarter  отчётный квартал 1..4; дефолт — календарный квартал даты среза;
 *   asOf     дата среза YYYY-MM-DD; дефолт — ПРЯМОЙ ЭФИР (явный asOf уважается
 *            как задан и открывает архив).
 * Новая форма — ось времени мультизначениями (фаза 3 карты оси времени,
 * docs/superpowers/specs/2026-08-07-time-axis-map.md §4):
 *   years=2025,2026  quarters=2026:1,2026:2  months=2026:5  week=YYYY-MM-DD
 * Формы не смешиваются (см. period-params.ts). Дефолты документированы и в
 * METHODOLOGY ответа.
 *
 * Рядом с полями Report ответ несёт methodology (строка METHODOLOGY — как
 * посчитано) и svodOnlineUrl (ссылка «СВОД онлайн» — где сверить: официальная
 * сводная книга Google Sheets; id книги не настроен — поля нет). При выборе
 * несколькими периодами добавляются selectionLabel (подпись выбора) и
 * periods — по отчёту на каждый срез; корень ответа при этом равен первому
 * срезу, поэтому старый клиент, не знающий о periods, читает ответ как прежде.
 * Суммирования периодов роут не делает: складывать проценты нельзя, а суммой
 * счётчиков занимается ядро — до тех пор каждый срез отдаётся своим.
 */
import type { FastifyInstance } from 'fastify';
import { buildReport, type BuildReportInput } from '@aemr/core';
import {
  SVOD_SHEET_NAME,
  buildSheetUrl,
  collectRowsByDept,
  floorToThursday,
  isoOfDayNumber,
  parseSvodGrid,
  parseSvodExtras,
  type Issue,
  type SvodGridBlock,
  type SvodSheetExtras,
} from '@aemr/shared';
import { getDeptSheetValues, getSnapshot, getSnapshotAtOrBefore, getDeptLoadMeta, getSvodGridCache, setSvodGridCache } from '../services/snapshot.js';
import { getSheetData } from '../services/google-sheets.js';
import { productCalendarDay } from '../services/product-calendar.js';
import {
  parsePeriodQuery,
  resolvePeriodParams,
  type PeriodQuery,
  type PeriodSlice,
} from '../services/period-params.js';
import { config } from '../config.js';

/**
 * Последний четверг «сегодня» — по календарю ПРОДУКТА (фиксированное смещение
 * config.weeklySnapshot.utcOffsetHours, Камчатка +12), а не по календарю машины:
 * прод-сервер живёт в UTC, и окно среда 12:00 — четверг 00:00 UTC иначе отдавало
 * бы живые данные без плашки за уже закрытую неделю (ревью R2a №3).
 */
const currentProductThursday = (): number =>
  floorToThursday(productCalendarDay(new Date(), config.weeklySnapshot.utcOffsetHours));

/** Методология отчёта — та же строка уходит читателю страницы. */
const METHODOLOGY =
  'Исполнение квартала — канон G = E/D листа СВОД: D — процедуры плана квартала ' +
  '(столбцы O/P), E — из них заключённые (есть дата в столбце Q), накопительно на дату среза. ' +
  'Числа origin=calc пересчитаны из строк-атомов книг ГРБС каноническим движком; ' +
  'origin=svod — ячейки официального листа СВОД ТД-ПМ без пересчёта (двухисточниковость: ' +
  'расхождение видно, подмены нет). Экономия — только утверждённая (флаг AD=«да» + дата факта). ' +
  'Деньги — тыс. руб., трёхсрез ФБ/КБ/МБ. Режим по умолчанию — ПРЯМОЙ ЭФИР: числа на текущий ' +
  'момент, как считает официальный лист. Дата среза адресует архив: параметр asOf открывает ' +
  'снимок той недели, и только тогда факт режется по дате (заключённое позже в снимок не входит).';

/**
 * Ссылка «СВОД онлайн» — открыть официальную сводную книгу Google Sheets,
 * ту самую, из которой роут читает лист СВОД ТД-ПМ. Ведёт на книгу целиком,
 * без привязки к вкладке (gid не указываем — лист читатель выберет сам).
 * Считается НА КАЖДЫЙ запрос, не на import: config.google.spreadsheetId
 * мутируется в рантайме (PUT /api/sources — смена источника), и замороженная
 * константа вела бы в старую книгу (ponytail-ревью R1-хвоста #1).
 * Id не настроен → undefined: JSON.stringify выбрасывает ключ из ответа.
 */
function svodOnlineUrl(): string | undefined {
  return config.google.spreadsheetId ? buildSheetUrl(config.google.spreadsheetId) : undefined;
}

/**
 * Разбор периода живёт в services/period-params.ts — одном доме валидации оси
 * времени для всех роутов. Семантика прежняя и здесь только напоминается:
 *
 * ДЕФОЛТ БЕЗ asOf/week — ПРЯМОЙ ЭФИР, «на сейчас» (канон пользователя 27.07:
 * «отчётные даты — это про ХРАНЕНИЕ данных, а видеть ситуацию мы должны в
 * прямом эфире»). Дата среза остаётся, но её роль — адресовать СНИМОК недели
 * (архив), а не резать живой просмотр. В живом режиме гейт факта не
 * применяется: числа сходятся с официальным листом, который тоже считает на
 * текущий момент.
 *
 * Явный asOf = обращение к архиву: уважается как задан (без флора к четвергу),
 * гейт факта включается, строки берутся из снимка той недели. Параметр week
 * адресует тот же архив, но по неделе: срез — четверг выбранной недели,
 * клампнутый к последнему прошедшему.
 */

/** Номер суток → «дд.мм.гггг» — формат дат в плашках читателю. */
const ruDateOfDay = (day: number): string => isoOfDayNumber(day).split('-').reverse().join('.');

/**
 * Официальный лист СВОД ТД-ПМ; недоступен/пуст → undefined (плашка в notes).
 * Читается из кэша ТОГО ЖЕ цикла, что и книги ГРБС: свежий запрос рядом с
 * кэшем книг давал ложные расхождения сверки на 1–2 строки (УО 31≠32) —
 * формулы СВОДа видят правку сотрудника мгновенно, кэш книг — после
 * обновления. Прямое чтение — только фолбэк холодного старта.
 */
async function readSvodGrid(): Promise<{ grid: SvodGridBlock[]; extras: SvodSheetExtras; loadedAt: string | null } | undefined> {
  try {
    let entry = getSvodGridCache();
    if (entry === null) {
      // Холодный старт: читаем сами и кладём в кэш — момент чтения берём
      // из кэша ПОСЛЕ записи, иначе loadedAt оставался null и плашка
      // расходящихся моментов молчала ровно в своём сценарии.
      setSvodGridCache(await getSheetData(SVOD_SHEET_NAME));
      entry = getSvodGridCache();
    }
    const values = entry?.values ?? [];
    const grid = parseSvodGrid(values);
    // Итоговый ярус того же листа: остаток к заключению и «Расч. экономия»
    // (M31/M32) — официальные числа, которые ручной отчёт печатает дословно.
    const extras = parseSvodExtras(values);
    return grid.length > 0 ? { grid, extras, loadedAt: entry?.loadedAt ?? null } : undefined;
  } catch {
    return undefined;
  }
}

/** Сигналы снапшота года; демо-фолбэк и отказ снапшота — честные «без сигналов». */
async function readIssues(year: number): Promise<Issue[]> {
  try {
    const snapshot = await getSnapshot(false, year);
    return snapshot.id.startsWith('demo-') ? [] : snapshot.issues;
  } catch {
    return [];
  }
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: PeriodQuery }>('/api/report', async (request, reply) => {
    const parsed = parsePeriodQuery(request.query);
    if (parsed.errors.length > 0) {
      // Все причины сразу: кривой запрос чинится за один заход, а не за три.
      return reply.status(400).send({ error: 'BadRequest', message: parsed.errors.join(' '), statusCode: 400 });
    }
    const period = resolvePeriodParams(parsed, {
      // Сегодня по календарю ПРОДУКТА (не UTC): камчатский четверг 04:00 —
      // это уже четверг. Флора к четвергу нет: эфир — на сейчас.
      todayDay: productCalendarDay(new Date(), config.weeklySnapshot.utcOffsetHours),
    });

    // Правило источника строк («одна ось недели»): срез текущей недели — живой
    // кэш; срез прошлых недель — снимок той недели, чтобы отчёт за прошлое не
    // пересчитывался по сегодняшнему состоянию книг.
    const currentThursday = currentProductThursday();
    const sourceNotes: string[] = [];
    let input: BuildReportInput | undefined;
    /**
     * Сигналы по годам выбора — только у ЖИВОГО пути: снимок несёт свои
     * (годонезависимо, см. ниже), а живой читает снапшот на каждый год.
     * undefined = сигналы уже лежат во входе и от года среза не зависят.
     */
    let issuesByYear: Map<number, Issue[]> | undefined;

    if (!period.live && period.asOfDay < currentThursday) {
      const snapshot = getSnapshotAtOrBefore(period.asOfDay);
      if (snapshot?.rowsByDept) {
        // Всё из снимка: строки, официальная сетка, сигналы — единый момент времени.
        // Сигналы снимка годонезависимы ОСОЗНАННО: у Issue (@aemr/shared) нет
        // поля года — фильтровать нечем; живой путь получает год-скоуп не
        // фильтром списка, а тем, что весь пайплайн собирался под этот год.
        input = {
          rowsByDept: snapshot.rowsByDept,
          ...(snapshot.svodGrid && snapshot.svodGrid.length > 0 ? { svodGrid: snapshot.svodGrid } : {}),
          issues: snapshot.issues,
        };
        // День снимка в плашке — по календарю ПРОДУКТА: createdAt — UTC-инстант,
        // и его UTC-срез назвал бы камчатский четверг 04:00 «средой» (ревью №7).
        const createdMs = Date.parse(snapshot.createdAt);
        const snapshotDay = Number.isNaN(createdMs)
          ? null
          : productCalendarDay(new Date(createdMs), config.weeklySnapshot.utcOffsetHours);
        sourceNotes.push(
          `Отчёт построен из снимка ${snapshotDay !== null ? ruDateOfDay(snapshotDay) : snapshot.createdAt}.`,
        );
      } else {
        // Честная плашка вместо тихой подмены: снимка той недели нет, читатель
        // видит сегодняшние строки под прошлой датой среза — и знает об этом.
        sourceNotes.push(
          `Снимка на ${ruDateOfDay(period.asOfDay)} нет — показаны текущие данные под датой среза.`,
        );
      }
    }

    if (!input) {
      const rowsByDept = collectRowsByDept(getDeptSheetValues());
      // Мета снимается ЗДЕСЬ же: между чтением строк и плашкой ниже стоит
      // await, за который конкурентный /api/refresh успевает обновить кэш —
      // плашка описывала бы не ту пару (code-review 03.08).
      const deptMetaAtRead = getDeptLoadMeta();
      if (Object.keys(rowsByDept).length === 0) {
        return reply.status(503).send({
          error: 'ServiceUnavailable',
          message:
            'Кэш книг ГРБС пуст — данные ещё не загружены (стартовый preload не выполнен ' +
            'или Google Sheets недоступен). Повторите запрос позже.',
          statusCode: 503,
        });
      }
      // Сигналы читаются на КАЖДЫЙ год выбора: снапшот года — свой, и один
      // список сигналов на все годы приписал бы замечания чужому году.
      const years = [...new Set(period.slices.map((s) => s.year))];
      const [svodRead, issueEntries] = await Promise.all([
        readSvodGrid(),
        Promise.all(years.map(async (y) => [y, await readIssues(y)] as const)),
      ]);
      issuesByYear = new Map(issueEntries);
      input = {
        rowsByDept,
        ...(svodRead ? { svodGrid: svodRead.grid, svodExtras: svodRead.extras } : {}),
        issues: issuesByYear.get(period.slices[0].year) ?? [],
      };

      // Моменты чтения двух половин сверки. Расходятся сильнее трёх минут —
      // говорим прямо: возможны кратковременные расхождения на 1–2 строки,
      // которые обновление данных сравняет само.
      const deptTimes = Object.values(deptMetaAtRead)
        .map((m) => Date.parse(m.loadedAt))
        .filter(Number.isFinite);
      const svodTime = svodRead?.loadedAt ? Date.parse(svodRead.loadedAt) : NaN;
      if (deptTimes.length > 0 && Number.isFinite(svodTime)) {
        const deptAt = Math.max(...deptTimes);
        if (Math.abs(deptAt - svodTime) > 3 * 60 * 1000) {
          const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
          sourceNotes.push(
            `Книги ГРБС прочитаны в ${hhmm(deptAt)}, СВОД — в ${hhmm(svodTime)} (UTC): ` +
            'сверка может кратковременно расходиться на 1–2 строки до следующего обновления данных.',
          );
        }
      }
    }

    /**
     * Один срез = один прогон ядра. Все срезы считаются по ОДНОМУ входу:
     * пересобирать источники между срезами нельзя — документ склеился бы из
     * разных моментов чтения книг (тот же класс, что фикс 67c131c в вебе).
     *
     * Гейт факта — только у архивного среза. В эфире его нет: иначе отчёт
     * молча прятал бы сегодняшние заключения, которые официальный лист уже
     * показывает (канон «эфир по умолчанию», 27.07).
     */
    const baseInput = input;
    const buildSlice = (slice: PeriodSlice) => {
      const sliceInput = issuesByYear
        ? { ...baseInput, issues: issuesByYear.get(slice.year) ?? [] }
        : baseInput;
      const report = buildReport(sliceInput, {
        year: slice.year,
        quarter: slice.quarter,
        ...(period.live ? {} : { asOfDay: period.asOfDay }),
      });
      // Плашка об источнике — первой: читатель сперва узнаёт, откуда числа.
      // Следом — плашка гранулярности: месяц ядро отчёта пока не считает, и
      // молчать о подмене месяца кварталом нельзя (карта оси времени, класс Г).
      const granularityNote = slice.from?.kind === 'month'
        ? [`Выбор месяца ${slice.from.year}:${slice.from.month} приведён к ${slice.quarter} кв. `
          + `${slice.year}: отчёт считается квартальными срезами.`]
        : [];
      report.notes.unshift(...sourceNotes, ...granularityNote);
      return {
        ...report,
        // asOfDay в ответе есть ВСЕГДА (веб адресует им снимки недели), а режим
        // называет флаг live: эфир — числа на сейчас, архив — на дату среза.
        period: { ...report.period, asOfDay: period.asOfDay, live: period.live },
      };
    };

    const reports = period.slices.map(buildSlice);
    return {
      ...reports[0],
      methodology: METHODOLOGY,
      svodOnlineUrl: svodOnlineUrl(),
      // Поля выбора появляются ТОЛЬКО у новой формы запроса: старый запрос
      // обязан получать прежний ответ без единого лишнего ключа.
      ...(parsed.hasSelection ? { selectionLabel: period.label, periods: reports } : {}),
    };
  });
}
