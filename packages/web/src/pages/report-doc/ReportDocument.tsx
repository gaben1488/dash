/**
 * ReportDocument — каркас страницы «Отчёт» как скролл-ДОКУМЕНТА
 * (бриф docs/superpowers/specs/2026-08-01-report-plus-plus.md, решение 1).
 *
 * Живёт РЯДОМ с pages/Report.tsx: маршрут пока не переключён (шаг 7 брифа),
 * старая страница не тронута. Данные — тот же GET /api/report, что и у
 * Report.tsx (эфир/архив через reportRequestParams), никакой своей арифметики.
 *
 * Скелет эталона: «Шапка» → «ПО КОНКУРЕНТНЫМ ПРОЦЕДУРАМ» (заглушка, шаг 3)
 * → «ЕДИНСТВЕННЫЙ ПОСТАВЩИК» (заглушка, шаг 4) → секции восьми ГРБС
 * (заглушки, шаг 5). Слева — липкое оглавление (на мобиле — сверху,
 * сворачиваемое). Тексты шапки — ровно как в lib/report/docx/text-blocks.ts.
 *
 * Дизайн — документная типографика по DESIGN.md: светлая тема основная,
 * тексты ≤72ch, секции разделяются заголовками (не рамками и не карточками),
 * межсекционные отступы крупнее внутрисекционных.
 */
import { useEffect, useMemo, useState } from 'react';
import { dayNumberOf } from '@aemr/shared';
import clsx from 'clsx';
import { api, type ReportResponse } from '../../api';
import { useStore } from '../../store';
import { buildFilterContext } from '../../lib/filter-context';
import { reportRequestParams, type ReportMode } from '../../lib/report/request';
import { fmtAsOfDate } from '../../lib/report/mappers';
import { TableOfContents, type TocSection } from './TableOfContents';
import { DocumentBody } from './DocumentBody';
import type { QuarterReports, ReportForExport } from '../../lib/report/docx/text-blocks';

/** Честная расшифровка ошибки загрузки (503 = снапшота ещё нет) — как в Report.tsx. */
function errorMessage(error: string): string {
  return error.includes('503')
    ? 'Данные не загружены: сервер ещё не получил снапшот книг. Обновите данные на Пульте и вернитесь.'
    : `Отчёт временно недоступен. ${error}`;
}

export function ReportDocumentPage() {
  // FilterContext из store — тот же вывод параметров запроса, что у Report.tsx
  const year = useStore((s) => s.year);
  const period = useStore((s) => s.period);
  const activeMonths = useStore((s) => s.activeMonths);
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const selectedSubordinates = useStore((s) => s.selectedSubordinates);
  const selectedActivities = useStore((s) => s.selectedActivities);
  const selectedMethods = useStore((s) => s.selectedMethods);
  const selectedBudgets = useStore((s) => s.selectedBudgets);
  const searchQuery = useStore((s) => s.searchQuery);
  const periodMode = useStore((s) => s.periodMode);
  const focusedWeekStart = useStore((s) => s.focusedWeekStart);
  const ctx = useMemo(
    () => buildFilterContext({
      year, period, activeMonths, selectedDepartments, selectedSubordinates,
      selectedActivities, selectedMethods, selectedBudgets, searchQuery,
      periodMode, focusedWeekStart,
    }),
    [year, period, activeMonths, selectedDepartments, selectedSubordinates,
      selectedActivities, selectedMethods, selectedBudgets, searchQuery,
      periodMode, focusedWeekStart],
  );

  // Режим просмотра: эфир по умолчанию (канон 27.07), архив — снимок недели.
  const [mode, setMode] = useState<ReportMode>('live');
  const request = useMemo(
    () => reportRequestParams(ctx, dayNumberOf(new Date())!, undefined, mode),
    [ctx, mode],
  );

  // Загрузка по образцу Report.tsx: useEffect + useState, без TanStack.
  // Четыре квартала того же среза: ручной отчёт печатает все кварталы,
  // одиночная проекция знает только отчётный (канон text-blocks).
  const [quarters, setQuarters] = useState<QuarterReports | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    api.getReport(request.year, request.quarter, request.asOf)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e: unknown) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [request.year, request.quarter, request.asOf]);

  // Кварталы грузятся после основного отчёта тем же годом/срезом.
  useEffect(() => {
    if (!report) return;
    let cancelled = false;
    setQuarters(null);
    Promise.all(([1, 2, 3, 4] as const).map((q) =>
      api.getReport(request.year, q, request.asOf),
    )).then(([q1, q2, q3, q4]) => {
      if (!cancelled) setQuarters({ 1: q1, 2: q2, 3: q3, 4: q4 } as QuarterReports);
    }).catch(() => { if (!cancelled) setQuarters(null); });
    return () => { cancelled = true; };
  }, [report, request.year, request.asOf]);


  // Дата среза — из ответа сервера (у продукта свой календарь), не new Date().
  const asOfDate = report ? fmtAsOfDate(report.period.asOfDay) : null;
  const isLive = report?.period.live ?? false;

  // Выгрузка в Word: страница и документ собираются из ОДНОГО mainReportBlocks,
  // поэтому «что видишь — то и скачиваешь» выполняется по построению.
  const [saving, setSaving] = useState<'main' | 'extra' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const onDownloadDocx = async (kind: 'main' | 'extra') => {
    if (!report || !quarters || asOfDate === null) return;
    setSaving(kind);
    setDownloadError(null);
    try {
      // Библиотека docx грузится по требованию: 400 КБ не должны висеть на
      // каждом открытии страницы ради кнопки, которую жмут раз в неделю.
      const [{ buildDocument, downloadDocx, reportFilename }, blocksMod] = await Promise.all([
        import('../../lib/report/docx/build-docx'),
        import('../../lib/report/docx/text-blocks'),
      ]);
      const isMain = kind === 'main';
      const blocks = isMain
        ? blocksMod.mainReportBlocks(report, quarters, asOfDate)
        : blocksMod.additionalReportBlocks(report, quarters, asOfDate);
      const title = isMain ? 'Отчёт по закупкам' : 'Дополнительно к отчету по закупкам';
      await downloadDocx(buildDocument(blocks, title), reportFilename(title, asOfDate));
    } catch (e: unknown) {
      setDownloadError(`Не удалось собрать документ: ${String(e)}`);
    } finally {
      setSaving(null);
    }
  };

  // Пункты оглавления = секции документа; ГРБС — с якорями #grbs-<dept>.
  const sections = useMemo<TocSection[]>(() => {
    if (!report) return [];
    return [
      { id: 'header', label: 'Шапка' },
      { id: 'competitive', label: 'По конкурентным процедурам' },
      { id: 'single-supplier', label: 'Единственный поставщик' },
      ...report.grbsBlocks.map((b) => ({ id: `grbs-${b.dept}`, label: b.dept })),
    ];
  }, [report]);

  if (error) {
    return (
      <div className="max-w-[72ch] py-8 text-sm text-zinc-500 dark:text-zinc-400">
        {errorMessage(error)}
      </div>
    );
  }
  if (!report) {
    return (
      <div className="max-w-[72ch] py-8 text-sm text-zinc-400 dark:text-zinc-500">
        Загрузка…
      </div>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-10">
      {/* Оглавление: на мобиле — сверху, сворачиваемое */}
      <details className="lg:hidden mb-6">
        <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Оглавление
        </summary>
        <div className="mt-3">
          <TableOfContents sections={sections} />
        </div>
      </details>

      {/* Оглавление: на десктопе — липкая колонка слева */}
      <aside className="hidden lg:block">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          <TableOfContents sections={sections} />
        </div>
      </aside>

      {/* Документ: секции разделяются заголовками и крупными отступами */}
      <article className="space-y-14 pb-16">
        {/* ── Шапка: тексты ровно как в text-blocks.ts выгрузки ── */}
        <section id="header" aria-labelledby="header-heading" className="scroll-mt-6">
          <h1
            id="header-heading"
            className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            ОТЧЕТ ПО ЗАКУПКАМ
          </h1>
          <div className="mt-3 max-w-[72ch] space-y-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            <p>срез на {asOfDate}</p>

            {/* Режим — управление и факт сервера одной строкой */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                role="group"
                aria-label="Режим просмотра"
                className="inline-flex items-baseline gap-2 text-sm"
              >
                <button
                  type="button"
                  onClick={() => setMode('live')}
                  aria-pressed={mode === 'live'}
                  title="Числа на текущий момент — как считает официальный лист СВОД."
                  className={clsx(
                    mode === 'live'
                      ? 'font-medium text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300',
                  )}
                >
                  В прямом эфире
                </button>
                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-600">·</span>
                <button
                  type="button"
                  onClick={() => setMode('archive')}
                  aria-pressed={mode === 'archive'}
                  title="Снимок недели: заключённое после даты среза в числа не входит."
                  className={clsx(
                    mode === 'archive'
                      ? 'font-medium text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300',
                  )}
                >
                  Архив недели
                </button>
              </span>
            </div>
            <p>
              {isLive
                ? 'Отчёт построен в режиме прямого эфира: числа на текущий момент, как считает официальный лист.'
                : `Отчёт построен по снимку недели на ${asOfDate}: заключённое после этой даты в числа не входит.`}
            </p>

            {/* Выгрузки: страница и файл собираются из одного источника состава */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void onDownloadDocx('main')}
                disabled={!quarters || saving !== null}
                title="Основной отчёт в формате Word — тот же состав, что на этой странице"
                className="rounded border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {saving === 'main' ? 'Готовится…' : 'Отчёт в Word'}
              </button>
              <button
                type="button"
                onClick={() => void onDownloadDocx('extra')}
                disabled={!quarters || saving !== null}
                title="Дополнительный (аналитический) отчёт в формате Word"
                className="rounded border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {saving === 'extra' ? 'Готовится…' : 'Допотчёт в Word'}
              </button>
              {!quarters && <span className="text-xs text-zinc-400">кварталы загружаются…</span>}
              {downloadError && (
                <span className="text-xs text-red-600 dark:text-red-400">{downloadError}</span>
              )}
            </div>

            {/* Ссылка на СВОД онлайн — либо честная плашка text-blocks */}
            <p>
              {report.svodOnlineUrl ? (
                <>
                  Ссылка на СВОД онлайн:{' '}
                  <a
                    href={report.svodOnlineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 underline decoration-zinc-300 underline-offset-2 hover:decoration-current dark:text-brand-400"
                  >
                    {report.svodOnlineUrl}
                  </a>
                </>
              ) : (
                'Ссылка на СВОД онлайн — не заполнено: книга СВОД на сервере не настроена.'
              )}
            </p>

            {/* Оговорка эталона — курсивом, слово в слово */}
            <p className="italic text-zinc-500 dark:text-zinc-400">
              (показатели в отчете и в своде могут незначительно отличаться в виду
              актуальности свода на дату открытия, а отчета на отчетную дату)
            </p>
          </div>
        </section>

        {/* Тело документа: состав 1:1 с .docx-выгрузкой — из единственного
            дома mainReportBlocks. Пока четыре квартала не загрузились,
            показывается честная плашка, а не пустые секции. */}
        {quarters ? (
          <DocumentBody
            report={report as unknown as ReportForExport}
            quarters={quarters}
            asOfDate={asOfDate ?? ''}
          />
        ) : (
          <p className="text-[13px] text-zinc-400 dark:text-zinc-500">
            Кварталы года загружаются — полный состав отчёта появится через секунду.
          </p>
        )}

      </article>
    </div>
  );
}
