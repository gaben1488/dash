// ────────────────────────────────────────────────────────────────
// Разделы, загружаемые по требованию.
//
// Раньше все двенадцать страниц лежали в одном файле сборки: открывая «Пульт»,
// читатель скачивал вместе с ним и «Аналитику» с её графиками, и «Реестр» на
// тысячи строк, и «Систему». Здесь каждый тяжёлый раздел объявлен отдельным
// куском: он приезжает в тот момент, когда его открывают, и дальше остаётся в
// кэше браузера.
//
// «Пульт» намеренно НЕ ленивый — это стартовый экран, и откладывать его загрузку
// значило бы показать скелет вместо чисел на первом же кадре.
// ────────────────────────────────────────────────────────────────

import { lazy } from 'react';
import type { Page } from '../store';
import { SkeletonCard, SkeletonChart, SkeletonKPIRow, SkeletonTable } from '../components/Skeleton';
import { freshImport } from '../lib/fresh-import';

// freshImport: открытая до выката вкладка просит кусок сборки со старым хэшем,
// которого на сервере уже нет, — вместо белого экрана страница один раз
// перезагружается на новую версию (прод-прецедент 14.08, кнопка «Отчёт в Word»).
export const ReportPage = lazy(() =>
  freshImport(() => import('./Report')).then(m => ({ default: m.ReportPage })));
export const SvodView = lazy(() =>
  freshImport(() => import('./SvodView')).then(m => ({ default: m.SvodView })));
export const DataBrowserPage = lazy(() =>
  freshImport(() => import('./DataBrowser')).then(m => ({ default: m.DataBrowserPage })));
export const EconomyPage = lazy(() =>
  freshImport(() => import('./Economy')).then(m => ({ default: m.EconomyPage })));
export const Analytics = lazy(() =>
  freshImport(() => import('./Analytics')).then(m => ({ default: m.Analytics })));
export const QualityPage = lazy(() =>
  freshImport(() => import('./Quality')).then(m => ({ default: m.QualityPage })));
export const SettingsPage = lazy(() =>
  freshImport(() => import('./Settings')).then(m => ({ default: m.SettingsPage })));

/** Заголовок-заглушка: та же высота, что у настоящего заголовка раздела. */
function SkeletonHeading() {
  return (
    <div className="relative overflow-hidden">
      <div className="h-5 w-52 bg-zinc-200/80 dark:bg-zinc-700/60 rounded-md mb-2" />
      <div className="h-2.5 w-80 max-w-full bg-zinc-100 dark:bg-zinc-800/60 rounded-md" />
    </div>
  );
}

/**
 * Скелет ожидания раздела.
 *
 * Форма повторяет то, что появится на месте скелета: у «Аналитики» это графики,
 * у «Реестра» — таблица. Пустой прямоугольник или крутящийся кружок ничего не
 * обещают и заставляют перечитывать экран заново, когда он всё-таки собрался.
 * Никаких чисел здесь нет и быть не может — скелет показывает разметку, а не
 * правдоподобные значения.
 */
export function PageSkeleton({ page }: { page: Page }) {
  const shape = SHAPE_BY_PAGE[page] ?? 'cards';
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Раздел загружается</span>
      <SkeletonHeading />
      {shape === 'charts' && (
        <>
          <SkeletonKPIRow count={4} />
          <SkeletonChart />
          <SkeletonChart />
        </>
      )}
      {shape === 'table' && (
        <>
          <SkeletonKPIRow count={3} />
          <SkeletonTable rows={10} />
        </>
      )}
      {shape === 'document' && (
        <>
          <SkeletonTable rows={6} />
          <SkeletonTable rows={6} />
        </>
      )}
      {shape === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
    </div>
  );
}

type SkeletonShape = 'charts' | 'table' | 'document' | 'cards';

const SHAPE_BY_PAGE: Partial<Record<Page, SkeletonShape>> = {
  dashboard: 'charts',
  analytics: 'charts',
  economy: 'charts',
  data: 'table',
  svod: 'table',
  report: 'document',
  quality: 'cards',
  recon: 'cards',
  trust: 'cards',
  issues: 'cards',
  recs: 'cards',
  journal: 'cards',
  settings: 'cards',
};
