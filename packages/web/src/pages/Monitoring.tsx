/**
 * «Мониторинг» — процедуры определения поставщика из книги «Ежедневный
 * мониторинг» (решение владельца 14.08, п.69в: отдельная вкладка, не сливать
 * с планом). Каркас; наполнение — волной по спеке
 * docs/superpowers/specs/2026-08-14-daily-monitoring-tab.md.
 */
export function MonitoringPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Мониторинг процедур</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-2xl">
        Реестр процедур определения поставщика из книги «Ежедневный мониторинг»:
        заявка → публикация → торги → итог. Раздел собирается — данные книги уже
        читаются, экран появится в ближайшем обновлении.
      </p>
    </div>
  );
}
