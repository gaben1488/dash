/**
 * «Дисциплина» — исход 3: закупочная дисциплина как СВОЙ результат управления.
 * Не упрёки, а список дел с эффектом в рублях и переходом на строки. Каркас;
 * наполнение — волной.
 */
export function DisciplinePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Дисциплина</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-2xl">
        Список действий с эффектом: что сделать, сколько это вернёт в план и
        какие строки закрывает. Раздел собирается — появится в ближайшем
        обновлении.
      </p>
    </div>
  );
}
