/**
 * Чем ГРБС объясняет свои решения: основания выбора ЕП и причины просрочек.
 *
 * Исполнитель пишет свободным текстом, и одна причина живёт в десятке
 * редакций (по книгам 26.06: 250 формулировок оснований ЕП и 239 причин
 * отклонения). Здесь они сведены словарями @aemr/shared к кластерам —
 * считать можно по кластеру, а проверять по живому образцу: он показан
 * рядом как есть, без пересказа.
 *
 * Честность: строка, которую словарь не узнал, не прячется — она стоит
 * долей «формулировка не распознана». Это и есть мера пригодности
 * свободного ввода для информационной системы.
 */
import type { ReasonBucket } from '@aemr/core';
import { fmtCount } from '../../lib/report/mappers';
import { ExpandableRows } from '../contract/ExpandableRows';
import { KbHover } from '../contract/KbHover';
import { TILE } from '../dashboard/surfaces';

/** Кто устраняет причину — цвет и слово; цвет всегда с подписью. */
const OWNER_TONE: Record<string, string> = {
  'финансовый орган': 'text-amber-700 dark:text-amber-400',
  'поставщик': 'text-violet-700 dark:text-violet-400',
  'уполномоченный орган': 'text-blue-700 dark:text-blue-400',
  'вне управления': 'text-zinc-500 dark:text-zinc-400',
  'ГРБС': 'text-zinc-700 dark:text-zinc-300',
};

function ReasonRow({ b, total, kind }: { b: ReasonBucket; total: number; kind: 'ep' | 'dev' }) {
  const share = total > 0 ? Math.round((b.count / total) * 100) : 0;
  const unknown = b.cluster === 'UNMAPPED';
  return (
    <div className="text-[11px] leading-relaxed">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <KbHover
          metricKey={kind === 'ep' ? 'ep_count' : 'lifecycle_stage_overdue'}
          live={
            `${fmtCount(b.count)} из ${fmtCount(total)} строк (${share} %) — кластер «${b.label}».\n` +
            `Живой пример из листа: «${b.sample.slice(0, 200)}».` +
            (b.owner ? `\nУстраняет: ${b.owner}.` : '') +
            (b.legitimate === false ? '\nПо 44-ФЗ прямым основанием не является — строка идёт в разбор.' : '')
          }
        >
          <span className={unknown ? 'font-medium text-amber-700 dark:text-amber-400' : 'font-medium text-zinc-700 dark:text-zinc-200'}>
            {b.label}
          </span>
        </KbHover>
        <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{fmtCount(b.count)} · {share} %</span>
        {b.owner && (
          <span className={`text-[10px] ${OWNER_TONE[b.owner] ?? 'text-zinc-500'}`}>
            устраняет: {b.owner}
          </span>
        )}
        {b.legitimate === false && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">не основание по 44-ФЗ</span>
        )}
      </div>
      {b.sample && (
        <div className="ml-3 text-[10px] italic text-zinc-400 dark:text-zinc-500">«{b.sample}»</div>
      )}
    </div>
  );
}

function Block({ title, buckets, kind, note, emptyNote }: {
  title: string; buckets: ReasonBucket[]; kind: 'ep' | 'dev'; note: string;
  /** Что значит пустой блок — своими словами для каждого рода строк. */
  emptyNote: string;
}) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{title}</span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{note}</span>
      </div>
      {/* Честная пустота первого рода (данных нет): блок не исчезает молча —
          пустая колонка листа сама по себе сведение о качестве заполнения,
          ровно тот же довод, по которому ниже стоит кластер «формулировка не
          распознана». Раньше `return null` прятал этот факт. */}
      {buckets.length === 0 ? (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {emptyNote}
        </p>
      ) : (
      <ExpandableRows
        rows={buckets}
        top={4}
        noun="кластеров"
        searchText={(b) => `${b.label} ${b.sample} ${b.owner ?? ''}`}
      >
        {(b) => <ReasonRow key={b.cluster} b={b} total={total} kind={kind} />}
      </ExpandableRows>
      )}
    </div>
  );
}

export function ReasonsPanel({ epReasons, deviations, year, quarter }: {
  epReasons: ReasonBucket[];
  deviations: ReasonBucket[];
  /** Год, за который ядро собрало кластеры (`reasonsOf`, build-report.ts:519). */
  year: number;
  /** Квартал секции — называется, чтобы сказать вслух, что он тут НЕ применён. */
  quarter: number;
}) {
  return (
    // Плитка внутри карточки отчёта (канон п.129): в тёмной теме её
    // отделяет светлота, а не край. Раньше фон плитки был ТЕМНЕЕ карточки
    // (1,01:1 — границы не видно), и всю работу делала обводка.
    <div className={`${TILE} space-y-3 px-3 py-2.5`}>
      <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
        Чем управление объясняет свои решения
      </span>
      {/* Паспорт периметра блока (канон п.58а, работа P0-3 карты «Отчёт+Свод»
          20.08). Ядро собирает кластеры по ВСЕМ строкам года
          (`reasonsOf` — фильтр по PLAN_YEAR, build-report.ts:519), а блок
          стоит внутри квартальной секции — без подписи его читали как
          квартальный. Применимость каждой оси называется вслух: год —
          применён, квартал — нет. */}
      <p className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
        Периметр блока: {year} год целиком, все строки книги управления.
        {' '}Выбранный {quarter} квартал к этим кластерам не применяется —
        основания и причины считаются по году, а не по кварталу.
        {' '}Момент чтения — тот же, что у отчёта (шапка страницы).
      </p>
      <Block
        title="Основания выбора единственного поставщика"
        buckets={epReasons}
        kind="ep"
        note="колонка M листа, сведено справочником"
        emptyNote={`Строк с единственным поставщиком за ${year} год в книге нет либо колонка M у них пуста — оснований, которые можно было бы свести, справочник не нашёл.`}
      />
      <Block
        title="Причины отклонения сроков"
        buckets={deviations}
        kind="dev"
        note="колонка U листа, сведено справочником"
        emptyNote={`За ${year} год колонка U в книге не заполнена: причин отклонения сроков исполнитель не указал — ни одной строки, которую можно было бы отнести к кластеру.`}
      />
      {/* Честное отсутствие двери к строкам (канон «ложная дверь хуже
          отсутствующей», `lib/kb/rows-door.ts`). Соседняя полоса этапности
          строки кластера открывает, здесь кнопки нет — и молчать об этом
          нельзя: читатель вправе считать, что дверь просто забыли.
          Механизм: Реестр ищет по предмету, способу, статусу, управлению и
          учреждению (`server/src/services/rows-filters.ts`, SEARCH_FIELDS);
          свободного текста колонок M и U в этом перечне нет, поэтому переход
          с формулировкой в поиске открыл бы ПУСТОЙ Реестр. Пока поиск не
          знает этих колонок, проверка идёт по живому образцу рядом. */}
      <p className="text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
        Строки кластера отдельной кнопкой не открываются: поиск Реестра идёт по предмету,
        способу и учреждению, а основание из колонки M и причину из колонки U он не читает —
        переход открыл бы пустой список. Проверить формулировку можно по живому образцу,
        он показан под каждым кластером как есть.
      </p>
    </div>
  );
}
