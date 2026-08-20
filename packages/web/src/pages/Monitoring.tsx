/**
 * «Мониторинг · Реестр процедур определения поставщика» — книга «Ежедневный
 * мониторинг» целиком (канон п.101а, спека
 * docs/superpowers/specs/2026-08-18-monitoring-tab-spec-v2.md).
 *
 * ЧТО ЭТОТ ЭКРАН ОБЕЩАЕТ. Перенести ФОРМУ КНИГИ, а не выжимку из неё: у
 * каждого листа свой режим, и в режиме лист узнаётся глазами. Восемь листов
 * управлений, свод, переходящий реестр «25-26» с победителями и ИНН,
 * справочник учреждений и три скрытых листа-предка — четырнадцать листов,
 * ни одного молча выброшенного.
 *
 * ПОЧЕМУ РЕЖИМ И РАЗРЕЗ РАЗВЕДЕНЫ. Режим отвечает на вопрос «на какой лист я
 * смотрю», разрез — «какие строки меня интересуют». Они перпендикулярны:
 * выбрав квартал, читатель обязан увидеть его и на листе УО, и в своде.
 * Поэтому смена режима разрезов не сбрасывает, а панель разрезов стоит выше
 * ряда режимов.
 *
 * ЧЕСТНЫЕ ПУСТОТЫ — ТРИ РАЗНЫЕ (п.36). «Книга не прочитана» (отказ чтения),
 * «на прочитанных листах нет строк» (книга пуста) и «разрезы всё срезали»
 * (отбор экрана) — три разные новости с тремя разными действиями, и путать
 * их нельзя. Четвёртая пустота — «сервер этот лист ещё не отдаёт»: она про
 * незаконченную трубу чтения, а не про книгу.
 *
 * ДЕНЬГИ — РУБЛИ, и подпись единицы стоит у каждой суммы: книги управлений
 * ведутся в тысячах, перепутать эти две книги значит ошибиться в тысячу раз.
 *
 * ВЕРХ ВКЛАДКИ — ОДИН РЯД (п.128-1, п.128-2, владелец 20.08.2026). Линейки
 * листов управлений внутри вкладки нет: срез по управлению даёт глобальный
 * фильтр шапки (изоляция п.127). Режимы листов, поиск и кнопка разрезов стоят
 * в одном ряду; панель разрезов раскрывается по кнопке.
 *
 * РАЙОННЫЕ ЛИСТЫ ПРИ ВЫБРАННОМ УПРАВЛЕНИИ показываются целиком с пояснением:
 * «Сводный», «25-26» и справочник — листы всего района, и резать их по
 * управлению продукт не берётся (решение о резке — за владельцем).
 *
 * АНАЛИТИКА КНИГИ (воронка, снижение, поставщики, сроки, сезонность, сверка)
 * встаёт ниже реестра секцией `MonitoringAnalyticsSection`: она сама ходит за
 * своими данными, и её отказ реестр не роняет. Считается она по ВСЕЙ районной
 * книге — при выбранном управлении об этом сказано словами, а не молчанием.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, SearchX } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { SkeletonKPIRow, SkeletonTable } from '../components/Skeleton';
import { BookPeriodBadge } from '../components/monitoring/BookPeriodBadge';
import { BookStatusStrip } from '../components/monitoring/BookStatusStrip';
import { PortraitNumbers } from '../components/monitoring/PortraitNumbers';
import { SheetModeTabs } from '../components/monitoring/SheetModeTabs';
import { SliceBar } from '../components/monitoring/SliceBar';
import { RegistryTable } from '../components/monitoring/RegistryTable';
import { SheetTotalsRow, SvodTable } from '../components/monitoring/SvodTable';
import { JournalTable } from '../components/monitoring/JournalTable';
import { DirectoryTable } from '../components/monitoring/DirectoryTable';
import { AncestorSheets } from '../components/monitoring/AncestorSheets';
import { SignalCards } from '../components/monitoring/SignalCards';
import { MonitoringAnalyticsSection } from '../components/monitoring/AnalyticsSection';
import { humanizeRequestError } from '../api';
import { useStore } from '../store';
import { deptScopeOf, inDeptScope } from '../lib/selectors/dept-isolation';
import { useOrgScope } from '../lib/selectors/org-scope';
import { scopeProcedures, scopeSignals } from '../lib/monitoring/dept-scope';
import {
  fetchMonitoring, fetchMonitoringMatch,
  type JournalRow, type LineageChain, type MatchPayload, type MatchRow,
  type MonitoringPayload,
} from '../lib/monitoring/contract';
import { ALL_DEPTS_MODE, deptSheetName, modeById, type SheetMode } from '../lib/monitoring/modes';
import {
  applySlices, emptySlices, hasAnySlice, sortProcedures,
  type SliceState, type SortDir, type SortKey,
} from '../lib/monitoring/slices';
import { portraitFrom } from '../lib/monitoring/portrait';
import { fmtReadAt, pluralCount } from '../lib/monitoring/format';

export function MonitoringPage() {
  const [data, setData] = useState<MonitoringPayload | null>(null);
  const [match, setMatch] = useState<MatchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modeId, setModeId] = useState<string>(ALL_DEPTS_MODE.id);
  const [slices, setSlices] = useState<SliceState>(emptySlices);
  const [sortKey, setSortKey] = useState<SortKey>('row');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [openCode, setOpenCode] = useState<string | null>(null);

  const load = useCallback((refresh = false) => {
    setLoading(true);
    setError(null);
    fetchMonitoring(refresh)
      .then((resp) => setData(resp))
      .catch((e: unknown) => setError(humanizeRequestError(e)))
      .finally(() => setLoading(false));
    // Сверка с книгами управлений едет отдельным запросом и отдельной судьбой:
    // её роут может быть ещё не поднят, и это не повод не показать реестр.
    void fetchMonitoringMatch().then(setMatch).catch(() => setMatch(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  const mode = modeById(modeId);

  // Изоляция по управлению (канон п.127): выбранное в шапке управление сужает
  // и реестр процедур, и сигналы книги — чужие листы в срез не попадают.
  // Периметр периода/года у книги по-прежнему свой: книга читается целиком.
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const deptScope = useMemo(() => deptScopeOf(selectedDepartments), [selectedDepartments]);

  // Режим подведов (приказ владельца 20.08.2026). Разбивка по подведам на
  // этой вкладке НЕ строится: заказчик в книге мониторинга записан свободным
  // текстом и со словарём подведов (колонка C книг ГРБС) строково не
  // совпадает — молчаливое сопоставление по похожести теряло бы строки.
  // Мультидименсиональность у реестра своя: каждая строка несёт заказчика,
  // и разрез «Заказчик» раскладывает лист по учреждениям. Единственное, что
  // вкладка обязана режиму, — честно сказать словами, что «только ГРБС» к
  // листу не применяется (см. пояснение у таблицы).
  const orgScope = useOrgScope();
  const procedures = useMemo(
    () => scopeProcedures(data?.procedures ?? [], deptScope),
    [data, deptScope],
  );
  const scopedSignals = useMemo(
    () => scopeSignals(data?.signals ?? [], deptScope),
    [data, deptScope],
  );

  // Режимов отдельных листов управлений больше нет (п.128-1): строки реестра
  // сужает периметр шапки, а не кнопка внутри вкладки.
  const modeRows = procedures;

  const filtered = useMemo(() => applySlices(modeRows, slices), [modeRows, slices]);
  const sorted = useMemo(() => sortProcedures(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const portrait = useMemo(() => portraitFrom(filtered), [filtered]);

  /** Счётчик на кнопке «Реестр» — сколько строк даёт периметр после разрезов. */
  const modeCounts = useMemo(() => ({ all: filtered.length }), [filtered]);

  // Три указателя «код процедуры → …»: родословная и строка «25-26» дают
  // карточке то, чего на листе управления нет, сверка — встречную сторону из
  // книги ГРБС. Строятся один раз на ответ, а не на каждую открытую карточку.
  const lineageByCode = useMemo(() => {
    const map = new Map<string, LineageChain>();
    for (const chain of data?.journal?.lineage ?? []) {
      for (const code of chain.codes) map.set(code, chain);
    }
    return map;
  }, [data]);

  const journalByCode = useMemo(() => {
    const map = new Map<string, JournalRow>();
    for (const r of data?.journal?.rows ?? []) {
      if (r.code !== null && !map.has(r.code)) map.set(r.code, r);
    }
    return map;
  }, [data]);

  const matchByCode = useMemo(() => {
    const map = new Map<string, MatchRow>();
    for (const r of match?.rows ?? []) map.set(r.code, r);
    return map;
  }, [match]);

  /**
   * Итог листа под таблицей реестра (§2.1) — когда в шапке выбрано РОВНО одно
   * управление: тогда таблица и есть его лист, и под ней уместна строка «что
   * лист отдаёт своду». При двух и более управлениях итог листа был бы ложью
   * о сумме, поэтому не показывается.
   */
  const sheetTotals = useMemo(() => {
    if (deptScope === null || selectedDepartments.size !== 1) return null;
    return data?.svod?.rows.find((r) => inDeptScope(deptScope, r.dept)) ?? null;
  }, [data, deptScope, selectedDepartments]);

  const onSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  const onOpenCode = useCallback((code: string) => {
    // Переход по родословной: показать процедуру там, где она лежит, а не
    // делать вид, что она нашлась в текущем разрезе.
    setModeId(ALL_DEPTS_MODE.id);
    setSlices({ ...emptySlices(), query: code });
    setOpenCode(code);
  }, []);

  const readAtLabel = data ? `данные книги на ${fmtReadAt(data.source.readAt)}` : 'книга ещё читается';
  const pendingIds = data
    ? [
      ...(data.svod === null ? ['svod'] : []),
      ...(data.journal === null ? ['journal'] : []),
      ...(data.directory === null ? ['directory'] : []),
    ]
    : [];

  // Скоуп словами (п.58): периметр шапки и разрезы называются, а не подразумеваются.
  const deptNames = [...selectedDepartments].map(deptSheetName);
  const scopeParts: string[] = [];
  if (deptScope !== null) {
    scopeParts.push(deptNames.length <= 2
      ? `лист${deptNames.length > 1 ? 'ы' : ''} «${deptNames.join('», «')}»`
      : `${pluralCount(deptNames.length, 'управление', 'управления', 'управлений')} из шапки`);
  }
  if (hasAnySlice(slices)) scopeParts.push('выбранные разрезы');
  const scopeLabel = scopeParts.length > 0 ? scopeParts.join(' · ') : 'весь реестр книги';

  return (
    <div className="space-y-4">
      {/* ── Шапка вкладки: название по п.101а, компактно в один блок (п.128-2) ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">
            Мониторинг · Реестр процедур определения поставщика
          </h1>
          <p className="mt-0.5 max-w-3xl text-[11px] text-zinc-500 dark:text-zinc-400">
            Книга «Ежедневный мониторинг» целиком: восемь листов управлений, свод, переходящий
            реестр «25-26», справочник учреждений и листы-предки. Деньги книги —{' '}
            <span className="font-medium">в рублях</span> (книги управлений — в тысячах).
            Фильтр года из шапки не применяется — книга читается целиком; выбранное управление
            сужает реестр и сигналы до своих листов (п.127).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BookPeriodBadge label={readAtLabel} note="книга читается целиком, без периода из шапки" />
          <button
            type="button"
            onClick={() => load(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/40"
          >
            <RotateCcw size={12} aria-hidden="true" /> Прочитать книгу заново
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4" role="status" aria-live="polite">
          <span className="sr-only">Читаем книгу «Ежедневный мониторинг»</span>
          <SkeletonKPIRow count={6} />
          <SkeletonTable rows={12} />
        </div>
      ) : error !== null || data === null ? (
        <EmptyState
          tone="problem"
          title="Книга «Ежедневный мониторинг» не прочитана"
          description="Реестр собрать не из чего: сервер не отдал ни одного листа книги. Это отказ чтения, а не «в книге пусто» — числа не потеряны, их просто неоткуда взять прямо сейчас."
          {...(error !== null ? { detail: error } : {})}
          action={{ label: 'Прочитать ещё раз', onClick: () => load(true) }}
        />
      ) : (
        <>
          <BookStatusStrip data={data} rowsTotal={procedures.length} onReload={() => load(true)} />

          {procedures.length === 0 ? (
            <EmptyState
              title="На прочитанных листах книги нет ни одной строки процедуры"
              description="Листы управлений прочитаны, но строк с данными в них не нашлось. Это пустота самой книги, а не отказ чтения: если процедуры ожидались — стоит открыть книгу-источник."
              action={{ label: 'Прочитать ещё раз', onClick: () => load(true) }}
            />
          ) : (
            <>
              {/* ── Один ряд управления вкладкой: режимы · поиск · разрезы (п.128-2) ── */}
              <SliceBar
                rows={modeRows}
                slices={slices}
                onChange={(next) => { setSlices(next); setOpenCode(null); }}
                shownCount={filtered.length}
                leading={(
                  <SheetModeTabs
                    activeId={modeId}
                    onSelect={(m: SheetMode) => { setModeId(m.id); setOpenCode(null); }}
                    pendingIds={pendingIds}
                    counts={modeCounts}
                  />
                )}
              />

              {/* Подсказка режима — только у листов с собственной формой:
                  у реестра ту же роль выполняет портрет со скоупом. */}
              {mode.kind !== 'registry' && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{mode.hint}</p>
              )}

              {/* Районные листы при выбранном управлении режутся только решением
                  владельца — пока показываются целиком, и об этом сказано словами. */}
              {deptScope !== null && (mode.kind === 'svod' || mode.kind === 'journal' || mode.kind === 'directory') && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  В шапке выбрано управление, но лист «{mode.sheet ?? mode.label}» — районный и
                  показан целиком: срез по управлению к нему не применяется, резать этот лист
                  продукт не берётся (решение — за владельцем).
                </p>
              )}

              {/* Честность режима «только ГРБС» (закон подведов 20.08.2026):
                  лист управления не делится на аппарат и подведы — вместо
                  молчаливого (и ненадёжного) отсева сказано словами. */}
              {mode.kind === 'registry' && orgScope.mode === 'grbs' && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Режим «только ГРБС» из шапки к этой книге не применяется: лист управления
                  ведётся по заказчикам-учреждениям без словаря подведов, и надёжно отделить
                  закупки аппарата от подведомственных продукт не берётся — показан весь лист.
                  Разложить его по учреждениям можно разрезом «Заказчик».
                </p>
              )}

              {mode.kind === 'registry' && (
                <PortraitNumbers portrait={portrait} scopeLabel={scopeLabel} readAtLabel={readAtLabel} />
              )}

              {/* ── Содержимое режима ── */}
              {mode.kind === 'registry' && (
                sorted.length === 0 ? (
                  <EmptyState
                    icon={SearchX}
                    title="Под выбранные разрезы не попала ни одна процедура"
                    description={`На этом листе ${pluralCount(modeRows.length, 'процедура', 'процедуры', 'процедур')}, и разрезы срезали их все. Это отбор экрана, а не пустота книги.`}
                    action={{ label: 'Снять все разрезы', onClick: () => setSlices(emptySlices()) }}
                  />
                ) : (
                  <>
                    <RegistryTable
                      rows={sorted}
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSort}
                      lineageByCode={lineageByCode}
                      journalByCode={journalByCode}
                      matchByCode={matchByCode}
                      onOpenCode={onOpenCode}
                      openCode={openCode}
                    />
                    {sheetTotals !== null && <SheetTotalsRow row={sheetTotals} />}
                  </>
                )
              )}

              {mode.kind === 'svod' && (
                data.svod !== null
                  ? <SvodTable svod={data.svod} readAtLabel={readAtLabel} />
                  : <PendingSheet name="СВОДНЫЙ" onReload={() => load(true)} />
              )}

              {mode.kind === 'journal' && (
                data.journal !== null
                  ? <JournalTable journal={data.journal} readAtLabel={readAtLabel} query={slices.query} />
                  : <PendingSheet name="25-26" onReload={() => load(true)} />
              )}

              {mode.kind === 'directory' && (
                data.directory !== null
                  ? (
                    <DirectoryTable
                      directory={data.directory}
                      readAtLabel={readAtLabel}
                      onPickCustomer={(name) => {
                        setModeId(ALL_DEPTS_MODE.id);
                        setSlices({ ...emptySlices(), customer: name });
                      }}
                    />
                  )
                  : <PendingSheet name="Перечень ГРБС" onReload={() => load(true)} />
              )}

              {mode.kind === 'ancestors' && <AncestorSheets />}

              {/* ── Аналитика книги — ниже реестра (канон п.101а, спека §3–§4).
                  Секция остаётся смонтированной при смене режима (класс hidden),
                  чтобы не перечитывать аналитику при каждом переключении листа. ── */}
              <div className={mode.kind === 'registry' ? 'space-y-3' : 'hidden'}>
                {deptScope !== null && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Аналитика ниже — районная: она считается по всей книге, срез по управлению из
                    шапки к ней пока не применяется. Числа аналитики шире показанного выше реестра.
                  </p>
                )}
                <MonitoringAnalyticsSection
                  procedures={data.procedures}
                  onPickDiscountBucket={(bucketKey) => {
                    // Клик по столбу гистограммы — разрез реестра той же
                    // корзиной (п.119: от числа к строкам-основаниям).
                    // Корзину считает ядро с обеих сторон, разойтись нечему.
                    setSlices((prev) => ({ ...prev, reductionBucket: bucketKey }));
                    setOpenCode(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              </div>

              {/* ── Нераспознанные коды: сигнал с адресами, не потеря ── */}
              {data.unparsedCodes.length > 0 && (
                <details className="rounded-xl border border-zinc-100 dark:border-zinc-700/50 bg-white dark:bg-zinc-800/60 px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">
                  <summary className="cursor-pointer font-medium">
                    Код процедуры не разобран у{' '}
                    {pluralCount(data.unparsedCodes.length, 'строки', 'строк', 'строк')} — по каждой
                    сказано, что записано и на что это похоже
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {data.unparsedCodes.map((u) => (
                      <li key={`${u.sheet}:${u.row}`} className="tabular-nums">
                        Лист «{u.sheet}», строка {u.row}: «{u.text}»
                        {u.guess !== null
                          ? <> — похоже на <span className="font-mono font-medium">{u.guess}</span>{u.note !== null ? ` (${u.note})` : ''}; сверка по догадке не идёт — код правится в книге.</>
                          : <> — номера процедуры в начале записи не видно; образец: ЭА152-26.</>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {scopedSignals.length > 0 && <SignalCards signals={scopedSignals} />}
              {deptScope !== null && (data.signals?.length ?? 0) > 0 && scopedSignals.length === 0 && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  По выбранным управлениям адресных сигналов книги нет; сигналы уровня всей книги
                  (свод, переходящий реестр, справочник) показываются в срезе «все управления».
                </p>
              )}

              {data.notes.length > 0 && (
                <div className="space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {data.notes.map((n) => <p key={n}>{n}</p>)}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Лист книги есть, а раздела ответа нет — четвёртая пустота. Она про трубу
 * чтения, а не про книгу, и её слова обязаны отличаться от «в книге пусто»:
 * действие здесь другое — не открывать книгу, а перечитать её сервером.
 */
function PendingSheet({ name, onReload }: { name: string; onReload: () => void }) {
  return (
    <EmptyState
      title={`Лист «${name}» сервер пока не отдаёт`}
      description={`В книге этот лист есть, и в реестре он нужен — но в ответе сервера его раздела нет. Это незаконченная труба чтения, а не пустой лист: числа с него не потеряны, их просто ещё не читают.`}
      action={{ label: 'Прочитать книгу заново', onClick: onReload }}
    />
  );
}
