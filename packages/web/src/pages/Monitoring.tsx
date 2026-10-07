/** Рабочее место процедур: канонический реестр, действия и адресные источники. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Drawer } from '../components/ui/drawer';
import { ProcedureCard } from '../components/monitoring/ProcedureCard';
import { WorkQueue } from '../components/monitoring/WorkQueue';
import { TripleCheck } from '../components/monitoring/TripleCheck';
import { MonitoringPerimeterProvider } from '../components/monitoring/PerimeterProvider';
import { humanizeRequestError } from '../api';
import { useStore } from '../store';
import { deptScopeOf, inDeptScope } from '../lib/selectors/dept-isolation';
import { useOrgScope } from '../lib/selectors/org-scope';
import { scopeProcedures, scopeSignals } from '../lib/monitoring/dept-scope';
import {
  fetchMonitoring,
  type JournalRow, type LineageChain, type MonitoringPayload, type RegistryProcedure,
} from '../lib/monitoring/contract';
import {
  fetchMonitoringMatchView, type MatchViewPayload,
} from '../lib/monitoring/analytics-contract';
import { buildMatchIndex } from '../lib/monitoring/match-rows';
import {
  fetchMonitoringTriple, type TripleState,
} from '../lib/monitoring/triple-contract';
import { ALL_DEPTS_MODE, WORK_MODE, deptSheetName, modeById, type SheetMode } from '../lib/monitoring/modes';
import {
  applySlices, emptySlices, hasAnySlice, sortProcedures,
  type SliceState, type SortDir, type SortKey,
} from '../lib/monitoring/slices';
import { portraitFrom } from '../lib/monitoring/portrait';
import { addressKey, indexByAddress } from '../lib/monitoring/signal-answer';
import { buildDrill } from '../lib/drill';
import { fmtReadAt, fmtRub, pluralCount, procedureCodeLabel } from '../lib/monitoring/format';
import { buildMonitoringCsv } from '../lib/monitoring/csv';
import { CARD, CONTROL } from '../components/monitoring/surfaces';

export function MonitoringPage() {
  const [data, setData] = useState<MonitoringPayload | null>(null);
  const [match, setMatch] = useState<MatchViewPayload | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  // Сверка трёх источников едет отдельным запросом и отдельной судьбой: её
  // состояние — не «данные или null», а один из исходов, среди которых три
  // РАЗНЫЕ пустоты (расхождений нет / книга не прочитана / сопоставлять
  // нечего). Схлопнуть их в null значило бы соврать читателю о поступке.
  // Само null означает здесь одно: ответа ещё нет, и раздел не рисуется вовсе —
  // «идёт чтение» и «читать нечего» тоже разные новости.
  const [triple, setTriple] = useState<TripleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modeId, setModeId] = useState<string>(WORK_MODE.id);
  const modeInitialized = useRef(false);
  const loadSequence = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<RegistryProcedure | null>(null);
  const [cardHistory, setCardHistory] = useState<RegistryProcedure[]>([]);
  const [navigationNote, setNavigationNote] = useState<string | null>(null);
  const [slices, setSlices] = useState<SliceState>(emptySlices);
  const [sortKey, setSortKey] = useState<SortKey>('row');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [openCode, setOpenCode] = useState<string | null>(null);

  const load = useCallback((refresh = false) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    fetchMonitoring(refresh)
      .then((resp) => {
        if (sequence !== loadSequence.current) return;
        if (resp.source.schema === 'canonical' && !resp.source.sheetsRead.includes('Рабочий реестр процедур')) {
          throw new Error('Основной реестр не прочитан; предыдущие данные сохранены.');
        }
        setData(resp);
        if (!modeInitialized.current) {
          setModeId(resp.source.schema === 'canonical' ? WORK_MODE.id : ALL_DEPTS_MODE.id);
          modeInitialized.current = true;
        }
      })
      .catch((e: unknown) => { if (sequence === loadSequence.current) setError(humanizeRequestError(e)); })
      .finally(() => { if (sequence === loadSequence.current) setLoading(false); });
    // Сверка с книгами управлений едет отдельным запросом и отдельной судьбой:
    // её роут может быть ещё не поднят, и это не повод не показать реестр.
    // Читается она ТОЙ ЖЕ читалкой, что и панель сверки в аналитике: вторая,
    // своя, ждала формы `{rows, outcomes}`, которой живой роут никогда не
    // отдавал, — и полоса сверки в карточке КАЖДОЙ строки молча писала
    // «сверка не подключена» при работающем сервере. Один сигнал — один дом.
    setMatchError(null);
    void fetchMonitoringMatchView(refresh).then((value) => { if (sequence === loadSequence.current) setMatch(value); }).catch((e: unknown) => { if (sequence === loadSequence.current) { setMatch(null); setMatchError(humanizeRequestError(e)); } });
    // Тройная сверка сама разводит свои исходы и не бросает: у неё нет
    // состояния «ошибка вкладки» — только состояние собственного раздела.
    void fetchMonitoringTriple(refresh).then((value) => { if (sequence === loadSequence.current) setTriple(value); });
  }, []);

  useEffect(() => { load(); return () => { loadSequence.current += 1; }; }, [load]);

  const mode = modeById(modeId);

  // Изоляция по управлению (канон п.127): выбранное в шапке управление сужает
  // и реестр процедур, и сигналы книги — чужие листы в срез не попадают.
  // Периметр периода/года у книги по-прежнему свой: книга читается целиком.
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const navigateTo = useStore((s) => s.navigateTo);
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
  const codeLabel = useCallback((code: string) => data?.procedures.find((p) => p.code === code)?.sourceCode ?? code, [data]);
  const scopedSignals = useMemo(
    () => scopeSignals(data?.signals ?? [], deptScope, data?.procedures ?? []),
    [data, deptScope],
  );

  // Режимов отдельных листов управлений больше нет (п.128-1): строки реестра
  // сужает периметр шапки, а не кнопка внутри вкладки.
  const modeRows = procedures;

  const filtered = useMemo(() => applySlices(modeRows, slices), [modeRows, slices]);
  const sorted = useMemo(() => sortProcedures(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const portrait = useMemo(() => portraitFrom(filtered), [filtered]);

  /** Счётчик на кнопке «Реестр» — сколько строк даёт периметр после разрезов. */
  const modeCounts = useMemo(() => ({ all: filtered.length, work: data?.work?.active.filter((i) => filtered.some((p) => p.sheet === i.procedure.sheet && p.row === i.procedure.row)).length ?? 0 }), [filtered, data]);

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

  const filteredJournal = useMemo(() => {
    if (!data?.journal) return null;
    const codes = new Set(filtered.map((p) => p.code).filter((code) => code !== null));
    const addresses = new Set(filtered.map((p) => `${p.sheet}:${p.row}`));
    return { ...data.journal,
      rows: data.journal.rows.filter((r) => r.code !== null ? codes.has(r.code) : addresses.has(`Рабочий реестр процедур:${r.row}`)),
      lineage: data.journal.lineage.filter((chain) => chain.codes.some((code) => codes.has(code))) };
  }, [data, filtered]);

  const journalByCode = useMemo(() => {
    const map = new Map<string, JournalRow>();
    for (const r of data?.journal?.rows ?? []) {
      if (r.code !== null && !map.has(r.code)) map.set(r.code, r);
    }
    return map;
  }, [data]);

  /**
   * Четвёртый указатель — «лист + строка → процедура». Он превращает адрес
   * сигнала из мёртвого текста в ответ: под адресом читатель видит, ЧТО в этой
   * строке записано, и попадает в неё кнопкой, не уходя со вкладки (требование
   * владельца «по каждому сигналу виден ответ»). Строится по ВСЕЙ книге, а не
   * по срезу: сигналы уже срезаны `scopeSignals`, и повторный срез здесь лишь
   * прятал бы содержимое строк, адреса которых читателю показаны.
   */
  const rowsByAddress = useMemo(
    () => indexByAddress(data?.procedures ?? []),
    [data],
  );

  /**
   * Пятый указатель — «код процедуры → встречная сторона книги управления».
   * Несёт не только пару, но и СОСТОЯНИЕ сверки: какие книги прочитаны и на
   * какой момент. Без состояния отсутствие пары в карточке строки читается
   * одинаково при неподнятом роуте, непрочитанных книгах и честно не найденной
   * строке — три разные новости с тремя разными поступками (п.36).
   */
  const matchIndex = useMemo(() => buildMatchIndex(match), [match]);

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

  const openProcedure = useCallback((p: RegistryProcedure) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNavigationNote(null);
    setCardHistory([]);
    setSelected(p);
  }, []);

  const onOpenCode = useCallback((code: string) => {
    if (selected?.code === code) return;
    const matches = procedures.filter((p) => p.code === code);
    if (matches.length !== 1) {
      setNavigationNote(matches.length > 1
        ? 'Код встречается в нескольких строках. Откройте нужную строку в реестре.'
        : 'Связанная процедура отсутствует в выбранных управлениях. Измените фильтр управления для её просмотра.');
      return;
    }
    if (selected === null) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNavigationNote(null);
    if (selected !== null) setCardHistory((history) => [...history, selected]);
    setSelected(matches[0]);
  }, [procedures, selected]);

  // Код заново разрешается в текущий адрес после обновления/сортировки источника.
  const selectedProcedure = selected === null ? null : selected.code !== null
    ? procedures.filter((p) => p.code === selected.code).length === 1
      ? procedures.find((p) => p.code === selected.code) ?? null : null
    : procedures.find((p) => p.sheet === selected.sheet && p.row === selected.row && p.code === null && p.subject === selected.subject) ?? null;

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
    // Паспорт периметра раздаётся сверху: каждое число вкладки объявляет, за
    // какой год, период, органы и срез оно посчитано и на какой момент книга
    // прочитана (канон п.58). Момент — момент чтения ЭТОГО ответа, а не общий
    // `lastRefreshed` продукта: книга читается своим запросом.
    <MonitoringPerimeterProvider readAt={data?.source.readAt ?? null}>
    <div className="space-y-4">
      {/* ── Шапка вкладки: название по п.101а, компактно в один блок (п.128-2) ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">
            Мониторинг · Реестр процедур определения поставщика
          </h1>
          <p className="mt-0.5 max-w-3xl text-[11px] text-zinc-500 dark:text-zinc-400">
            {data?.source.bookName ?? 'План-реестр процедур определения поставщика'}. Действия, результаты,
            суммы и связи берутся из рабочего реестра. Деньги — <span className="font-medium">в рублях</span>.
            Выбранные управления сужают процедуры; период выбирается в разрезах ниже.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BookPeriodBadge label={readAtLabel} note="книга читается целиком, без периода из шапки" />
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className={`inline-flex items-center gap-1 ${CONTROL} px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/40`}
          >
            <RotateCcw size={12} aria-hidden="true" /> Прочитать книгу заново
          </button>
        </div>
      </div>

      {loading && data === null ? (
        <div className="space-y-4" role="status" aria-live="polite">
          <span className="sr-only">Читаем книгу «Ежедневный мониторинг»</span>
          <SkeletonKPIRow count={6} />
          <SkeletonTable rows={12} />
        </div>
      ) : data === null ? (
        <EmptyState
          tone="problem"
          title="Рабочая книга не прочитана"
          description="Реестр собрать не из чего: сервер не отдал ни одного листа книги. Это отказ чтения, а не «в книге пусто» — числа не потеряны, их просто неоткуда взять прямо сейчас."
          {...(error !== null ? { detail: error } : {})}
          action={{ label: 'Прочитать ещё раз', onClick: () => load(true) }}
        />
      ) : (
        <>
          {loading && <p role="status" className="text-sm text-zinc-500">Обновляем книгу; показаны данные последнего успешного чтения.</p>}
          {error !== null && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{error}. Сохранены данные последнего успешного чтения: {readAtLabel}.</p>}
          {navigationNote && selected === null && <p role="alert" className="text-sm text-amber-700">{navigationNote}</p>}
          {/* Сигналы полосе отдаются СРЕЗАННЫЕ — те же, чьи карточки читатель
              увидит ниже (п.127). Иначе полоса обещала бы двенадцать сигналов
              там, где экран показывает три. */}
          <BookStatusStrip
            data={data}
            rowsTotal={procedures.length}
            scopedSignals={scopedSignals}
            onReload={() => load(true)}
          />

          {procedures.length === 0 ? (
            <EmptyState
              title="На прочитанных листах книги нет ни одной строки процедуры"
              description="Листы управлений прочитаны, но строк с данными в них не нашлось. Это пустота самой книги, а не отказ чтения: если процедуры ожидались — стоит открыть книгу-источник."
              action={{ label: 'Прочитать ещё раз', onClick: () => load(true) }}
            />
          ) : (
            <>
              {/* ── Один ряд управления вкладкой: режимы · поиск · разрезы (п.128-2) ── */}
              {mode.kind === 'directory' ? <SheetModeTabs activeId={modeId} onSelect={(m: SheetMode) => setModeId(m.id)} pendingIds={pendingIds} counts={modeCounts} /> : <SliceBar
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
              />}

              {/* Подсказка режима — только у листов с собственной формой:
                  у реестра ту же роль выполняет портрет со скоупом. */}
              {mode.kind !== 'registry' && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{mode.hint}</p>
              )}

              {/* Районные листы при выбранном управлении режутся только решением
                  владельца — пока показываются целиком, и об этом сказано словами. */}
              {deptScope !== null && mode.kind === 'directory' && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  В шапке выбрано управление, но лист «{mode.sheet ?? mode.label}» — районный и
                  показан целиком: срез по управлению к нему не применяется, справочник показывает организации всего округа. Процедурные разрезы здесь не применяются.
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

              {(mode.kind === 'registry' || mode.kind === 'svod') && (
                <PortraitNumbers portrait={portrait} scopeLabel={scopeLabel} readAtLabel={readAtLabel} />
              )}

              {data.source.schema === 'canonical' && (mode.kind === 'registry' || mode.kind === 'svod') && <div className="flex flex-wrap items-center gap-3 text-sm">
                <label>Представление <select aria-label="Представление реестра" value={slices.view ?? 'all'}
                  onChange={(event) => setSlices((prev) => ({ ...prev, view: event.target.value as SliceState['view'] }))}
                  className={`${CONTROL} ml-2 p-2`}>
                  <option value="all">Все процедуры{deptScope !== null ? ' выбранных управлений' : ''}</option>
                  <option value="withoutContract">Без контракта</option>
                  <option value="joint">Совместные</option>
                  <option value="successful">Успешно завершённые процедуры</option>
                </select></label>
                {slices.view === 'withoutContract' && <p className="text-zinc-500">Нет заявок, отмены и передачи наследникам — по результатам источника. Процедуры в работе показаны в своей очереди.</p>}
                {slices.view === 'successful' && <p className="text-zinc-500">Результат «Состоялась»; исполнение контракта этим не подтверждается.</p>}
              </div>}

              {mode.kind === 'registry' && <div className="flex flex-wrap items-center gap-3 text-sm">
                <button type="button" disabled={sorted.length === 0} className={`${CONTROL} px-3 py-2 disabled:opacity-50`}
                  onClick={() => {
                    const url = URL.createObjectURL(new Blob([buildMonitoringCsv(sorted, data.source, scopeLabel)], { type: 'text/csv;charset=utf-8' }));
                    const link = document.createElement('a');
                    link.href = url; link.download = 'Реестр процедур.csv'; link.click(); URL.revokeObjectURL(url);
                  }}>Скачать текущий отбор · {sorted.length} строк</button>
                <p className="text-zinc-600 dark:text-zinc-300">CSV для Excel и Р7-Офис: весь отбор в текущем порядке, суммы с копейками, адреса источника и момент чтения.</p>
              </div>}

              {/* ── Содержимое режима ── */}
              {mode.kind === 'work' && <WorkQueue queue={data.work} procedures={filtered} readAtLabel={readAtLabel} onOpen={openProcedure} />}

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
                      matchIndex={matchIndex}
                      readAtLabel={readAtLabel}
                      sourceLabel={`рабочий реестр процедур · ${scopeLabel}`}
                      onOpenProcedure={openProcedure}
                      bookUrl={data.source.schema === 'canonical' ? data.source.bookUrl : null}
                      onOpenCode={onOpenCode}
                      openCode={openCode}
                      onCloseOpenCode={() => setOpenCode(null)}
                    />
                    {sheetTotals !== null && !hasAnySlice(slices) && <SheetTotalsRow row={sheetTotals} />}
                  </>
                )
              )}

              {mode.kind === 'svod' && <details className={`${CARD} p-4`}>
                <summary className="cursor-pointer text-sm font-semibold">Сверка книги · весь округ</summary>
                <p className="my-3 text-sm text-zinc-500">Районный свод показан целиком. Управления и разрезы выше к этой сверке не применяются; портрет выше описывает выбранные процедуры.</p>
                {data.svod === null ? <PendingSheet name="Сводный аналитический лист" onReload={() => load(true)} />
                  : data.svod.rows.length === 0 ? <ReadButEmptySheet name="Сводный аналитический лист" onReload={() => load(true)} />
                    : <SvodTable svod={data.svod} readAtLabel={readAtLabel} />}
              </details>}

              {mode.kind === 'journal' && (
                data.journal === null
                  ? <PendingSheet name="Рабочий реестр процедур" onReload={() => load(true)} />
                  : data.journal.rows.length === 0
                    ? <ReadButEmptySheet name="Рабочий реестр процедур" onReload={() => load(true)} />
                    : <JournalTable journal={filteredJournal ?? data.journal} readAtLabel={readAtLabel} onOpenCode={onOpenCode} codeLabel={codeLabel} />
              )}

              {mode.kind === 'directory' && (
                data.directory !== null && data.directory.rows.length === 0
                  ? <ReadButEmptySheet name="Справочник заказчиков" onReload={() => load(true)} />
                  : data.directory !== null
                  ? (
                    <DirectoryTable
                      directory={data.directory}
                      readAtLabel={readAtLabel}
                      sourceSheetName={data.source.schema === 'canonical' ? 'Справочник заказчиков' : 'Перечень ГРБС'}
                      sourceBookName={data.source.bookName}
                      onPickCustomer={(name) => {
                        setModeId(ALL_DEPTS_MODE.id);
                        setSlices({ ...emptySlices(), customer: name });
                      }}
                    />
                  )
                  : <PendingSheet name="Справочник заказчиков" onReload={() => load(true)} />
              )}

              {mode.kind === 'ancestors' && (
                <AncestorSheets ancestors={data.ancestors} readAtLabel={readAtLabel} />
              )}

              {/* ── Сверка трёх источников (владелец 21.08.2026) ──────────
                  Стоит НАД аналитикой намеренно: это проверка данных, а не
                  вывод из них, и читать её надо до того, как поверишь числам
                  ниже. Раздел живёт своим запросом и своими пустотами — отказ
                  сверки не отнимает у вкладки реестр. */}
              {triple !== null && data.source.schema !== 'canonical' && (
                <TripleCheck
                  state={triple}
                  deptScope={deptScope}
                  scopeLabel={scopeLabel}
                  onReload={() => load(true)}
                  onOpenCode={onOpenCode}
                />
              )}

              {/* ── Аналитика книги — ниже реестра (канон п.101а, спека §3–§4).
                  Секция остаётся смонтированной при смене режима (класс hidden),
                  чтобы не перечитывать аналитику при каждом переключении листа. ── */}
              <div className={mode.kind === 'svod' ? 'space-y-3' : 'hidden'}>
                {/* Прежняя янтарная строка «аналитика ниже — районная» отсюда
                    убрана намеренно: одна фраза обещала поведение сразу девяти
                    блокам (болезнь A1 карты «Аналитики»), а теперь то же самое
                    говорит ПАСПОРТ КАЖДОГО блока — «фильтр управлений к этому
                    числу не применяется — оно посчитано по всему району».
                    Один сигнал живёт в одном доме, и дом у него теперь у самого
                    числа, а не над секцией. */}
                <MonitoringAnalyticsSection
                  procedures={data.procedures}
                  registryReadAt={data.source.readAt}
                  sharedMatch={match}
                  sharedMatchError={matchError}
                  onReloadMatch={() => load(true)}
                  onPickDiscountBucket={(bucketKey) => {
                    // Клик по столбу гистограммы — разрез реестра той же
                    // корзиной (п.119: от числа к строкам-основаниям).
                    // Корзину считает ядро с обеих сторон, разойтись нечему.
                    setModeId(ALL_DEPTS_MODE.id);
                    setSlices((prev) => ({ ...prev, reductionBucket: bucketKey }));
                    setOpenCode(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onPickSupplier={(inn, name) => {
                    // ИНН — надёжный ключ разреза; там, где книга его не
                    // проставила, отбор идёт поиском по написанию имени, и это
                    // ЧЕСТНО ХУЖЕ: одно общество, записанное дважды, разойдётся.
                    // Обе ветки ведут в один и тот же реестр выше — читатель не
                    // уходит со вкладки и видит основания числа целиком.
                    setModeId(ALL_DEPTS_MODE.id);
                    setSlices(inn === null
                      ? { ...emptySlices(), query: name }
                      : { ...emptySlices(), winnerInn: inn });
                    setOpenCode(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onPickDept={(dept) => {
                    setModeId(ALL_DEPTS_MODE.id);
                    // Изоляция п.127 включается ГЛОБАЛЬНЫМ фильтром шапки, а не
                    // местным разрезом вкладки: у управления один дом отбора на
                    // всё приложение, и второй здесь означал бы два разных
                    // ответа на вопрос «какое управление я сейчас смотрю».
                    // Цель перехода собирает `buildDrill` (М14) — здесь ось
                    // одна, но правило «цель строится из точки целиком, и ни
                    // одна ось не теряется молча» держится тем же домом.
                    const target = buildDrill({ dept }, 'monitoring');
                    if (target.filters.department !== undefined) {
                      navigateTo('monitoring', { department: target.filters.department });
                    }
                    setOpenCode(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}

                  // ── Двери разрезов витрины «где деньги · где риск · где затык» ──
                  //
                  // Все они ведут в ОДИН И ТОТ ЖЕ реестр выше, а не в отдельные
                  // экраны: читатель не уходит со вкладки и видит основания
                  // числа там, где привык (п.119). Единственное исключение —
                  // судьба процедуры: её строки живут на переходящем реестре, и
                  // дверь честно переключает режим листа.
                  //
                  // Пометки книги «25-26» отдаются целиком, а не выжимкой: разбор
                  // рукописной пометки в класс делает ядро, и вторая копия этого
                  // разбора на клиенте рано или поздно разошлась бы с первой.
                  journalRows={data.journal?.rows}

                  onPickCustomer={(customer) => {
                    // Заказчик отбирается тем же написанием, каким витрина его
                    // сложила. Нормализация здесь была бы вредна: число обещало
                    // строки одного написания, и привести к другому их числу
                    // значит обмануть в момент клика.
                    setModeId(ALL_DEPTS_MODE.id);
                    setSlices({ ...emptySlices(), customer });
                    setOpenCode(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onPickZeroReduction={() => {
                    // Корзину «снижения не было» считает ядро с обеих сторон —
                    // и в гистограмме, и в разрезе реестра, — разойтись нечему.
                    setModeId(ALL_DEPTS_MODE.id);
                    setSlices({ ...emptySlices(), reductionBucket: 'zero' });
                    setOpenCode(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onPickMethod={(method) => {
                    setModeId(ALL_DEPTS_MODE.id);
                    setSlices({ ...emptySlices(), method });
                    setOpenCode(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onPickYear={(procedureYear) => {
                    // Год берётся из кода процедуры, а не из даты, — и разрез
                    // реестра сравнивает ровно тот же суффикс.
                    setModeId(ALL_DEPTS_MODE.id);
                    setSlices({ ...emptySlices(), procedureYear });
                    setOpenCode(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onPickJoint={() => {
                    // Совместные строки книга отмечает способом «совместный
                    // аукцион»; заказчик-признак «Совместный …» ловится тем же
                    // разрезом только частично, и это честно хуже — но общей
                    // колонки «совместная закупка» в книге нет.
                    setModeId(ALL_DEPTS_MODE.id);
                    setSlices({ ...emptySlices(), method: 'ЭАС' });
                    setOpenCode(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onPickFate={(sample) => {
                    // Единственная дверь, меняющая лист: судьба процедуры
                    // записана в переходящем реестре, и показывать её строки на
                    // листе управления было бы подлогом — там этой колонки нет.
                    setModeId('journal');
                    setSlices({ ...emptySlices(), query: sample });
                    setOpenCode(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              </div>

              {/* ── Нераспознанные коды: сигнал с адресами, не потеря ── */}
              {data.unparsedCodes.length > 0 && (
                <details className={`${CARD} px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300`}>
                  <summary className="cursor-pointer font-medium">
                    Код процедуры не разобран у{' '}
                    {pluralCount(data.unparsedCodes.length, 'строки', 'строк', 'строк')} — по каждой
                    сказано, что записано и на что это похоже
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {data.unparsedCodes.map((u) => {
                      // Ответ на месте и здесь: адрес без содержимого строки —
                      // это задание «найди сам», а не сигнал (требование
                      // владельца «какая строка, что в ней, почему»).
                      const row = rowsByAddress.get(addressKey(u.sheet, u.row)) ?? null;
                      return (
                      <li key={`${u.sheet}:${u.row}`} className="tabular-nums">
                        Лист «{u.sheet}», строка {u.row}: «{u.text}»
                        {row !== null && (
                          <span className="text-zinc-500 dark:text-zinc-400">
                            {' '}— в строке: {row.customer}
                            {row.subject !== '' && `, ${row.subject}`}
                            {row.nmck !== null && `, НМЦК ${fmtRub(row.nmck)} руб.`}
                          </span>
                        )}
                        {u.guess !== null
                          ? <> — похоже на <span className="font-mono font-medium">{u.guess}</span>{u.note !== null ? ` (${u.note})` : ''}; сверка по догадке не идёт — код правится в книге.</>
                          : <> — номера процедуры в начале записи не видно; образец: ЭА152-26.</>}
                      </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {scopedSignals.length > 0 && (
                <SignalCards
                  signals={scopedSignals}
                  byAddress={rowsByAddress}
                  readAtLabel={readAtLabel}
                  scopeLabel={scopeLabel}
                  onOpenCode={onOpenCode}
                />
              )}
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
      <Drawer open={selected !== null} onOpenChange={(open) => { if (!open) { setSelected(null); setCardHistory([]); setNavigationNote(null); } }}
        title={selectedProcedure ? procedureCodeLabel(selectedProcedure) ?? 'Карточка процедуры' : 'Карточка процедуры'}
        description="Действие, данные и источники. Закрытие возвращает к прежнему списку."
        className="!max-h-[100dvh] h-[100dvh] !rounded-none sm:left-auto sm:w-[min(56rem,90vw)]"
        onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}>
        {cardHistory.length > 0 && <button type="button" className="mb-3 text-sm text-sky-700 underline" onClick={() => {
          setSelected(cardHistory[cardHistory.length - 1]); setCardHistory((history) => history.slice(0, -1)); setNavigationNote(null);
        }}>Назад к предыдущей процедуре</button>}
        {navigationNote && <p role="alert" className="mb-3 text-sm text-amber-700">{navigationNote}</p>}
        {selectedProcedure ? <ProcedureCard p={selectedProcedure}
          bookUrl={data?.source.schema === 'canonical' ? data.source.bookUrl : null}
          lineage={selectedProcedure.code ? lineageByCode.get(selectedProcedure.code) : null}
          journalRow={selectedProcedure.code ? journalByCode.get(selectedProcedure.code) : null}
          match={selectedProcedure.code ? matchIndex?.byCode.get(selectedProcedure.code) : null}
          matchIndex={matchIndex} onOpenCode={onOpenCode} codeLabel={codeLabel} />
          : <p className="text-sm">Строка не найдена однозначно в текущем снимке и выбранных управлениях. Закройте карточку и выберите её заново.</p>}
      </Drawer>
    </div>
    </MonitoringPerimeterProvider>
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

/**
 * ПЯТАЯ ПУСТОТА, И ОНА НЕ ЧЕТВЁРТАЯ. Лист прочитан, раздел ответа пришёл — а
 * строк в нём ноль. До этого маппер схлопывал такой ответ в «раздела нет», и
 * читатель шёл чинить трубу чтения там, где чинить нечего: чтение прошло,
 * и его результат — «на листе пусто». Действие здесь другое: не перечитывать
 * сервером, а открыть книгу и посмотреть, ждали ли мы там строк вообще.
 */
function ReadButEmptySheet({ name, onReload }: { name: string; onReload: () => void }) {
  return (
    <EmptyState
      title={`Лист «${name}» прочитан, но строк в нём нет`}
      description={'Сервер этот лист отдал — в его разделе ответа ноль строк. Это пустота самого листа, а не отказ чтения и не незаконченная труба: если строки на нём ожидались, смотреть надо книгу-источник, а не повторное чтение.'}
      action={{ label: 'Прочитать книгу заново', onClick: onReload }}
    />
  );
}
