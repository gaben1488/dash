// ── Раскрывающаяся панель «Как устроена сверка»: принцип, три уровня,
//    что с чем сравнивается, где в книге лежат официальные числа.
//
//    07.08.2026 — переплавка под читателя-руководителя. Было: панель писалась
//    языком таблицы — «COUNTIFS по col L + col O», «L=метод, N=дата плана,
//    AB=экономия МБ». Буква столбца без номера строки адресом не является:
//    она ничего не открывает и ничего не доказывает, а читателя отправляет
//    искать легенду. Стало: сравнение описано словами, а адреса остались
//    там, где они действительно адреса — в таблице привязок (строка 47,
//    ячейка U47), по которым официальное число открывается в книге.
//
//    Второе исправление — таблица привязок перестала быть рукописной. Она
//    расходилась с каноном: у УЭР значилась экономия «U46» при канонических
//    «U47» и лист «УЭР» вместо реально читаемого «ВСЕ». Теперь строки и
//    ячейки берутся из реестра управлений, и разойтись молча уже не могут.

import React from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { DEPARTMENT_REGISTRY, DEPARTMENT_ROWS, SUMMARY_ROWS } from '@aemr/shared';
import { CARD, RULE_DIVIDE, RULE_HEAD } from '../control/surfaces';

interface ReconMethodologyProps {
  open: boolean;
  onToggle: () => void;
}

/** Что означает показатель сверки и откуда он берётся — словами, без букв столбцов. */
const METRIC_EXPLANATIONS: { metric: string; meaning: string; origin: string }[] = [
  { metric: 'План, количество', meaning: 'Сколько закупок запланировано на период', origin: 'Число строк, у которых совпал способ закупки и квартал плановой даты' },
  { metric: 'Факт, количество', meaning: 'Сколько закупок фактически состоялось', origin: 'Число строк с проставленной датой заключения в том же периоде' },
  { metric: 'Отклонение, количество', meaning: 'Насколько факт разошёлся с планом', origin: 'Разница между фактом и планом в штуках' },
  { metric: 'Исполнение, %', meaning: 'Какая доля плана выполнена', origin: 'Факт, делённый на план; при нулевом плане доля не считается — это «нет плана», а не ноль' },
  { metric: 'План по бюджетам', meaning: 'Плановые деньги по федеральному, краевому и муниципальному источникам', origin: 'Суммы плановых граф по строкам того же среза' },
  { metric: 'План ИТОГО', meaning: 'Все плановые деньги периода', origin: 'Сумма трёх бюджетных источников плана' },
  { metric: 'Факт по бюджетам', meaning: 'Фактические деньги по тем же трём источникам', origin: 'Суммы фактовых граф по строкам среза' },
  { metric: 'Факт ИТОГО', meaning: 'Все фактические деньги периода', origin: 'Сумма трёх бюджетных источников факта' },
  { metric: 'Экономия ИТОГО', meaning: 'Снижение цены по итогам процедур за квартал', origin: 'Сумма графы экономии по строкам среза' },
];

/** Привязки управлений к листу СВОД ТД-ПМ — выводятся из реестра, не пишутся руками. */
const DEPT_ANCHORS = DEPARTMENT_REGISTRY.map((d) => {
  const rows = DEPARTMENT_ROWS[d.latinId];
  return {
    name: d.shortName,
    sheet: d.sheetName,
    kpQ1: d.svod.kpQ1,
    kpYear: d.svod.kpYear,
    epQ1: d.svod.epQ1,
    epYear: d.svod.epYear,
    economyKp: rows?.economyKpCell ?? null,
    economyEp: rows?.economyEpCell ?? null,
  };
});

/** Ячейка есть — показываем адрес; нет — говорим прямо, что привязки нет. */
function CellRef({ cell }: { cell: string | null }) {
  return cell
    ? <code className="font-mono">{cell}</code>
    : <span className="text-zinc-400 dark:text-zinc-500" title="Экономия по этому управлению отдельной ячейкой в листе не выведена — сверяется только расчётом">привязки нет</span>;
}

export function ReconMethodology({ open, onToggle }: ReconMethodologyProps) {
  return (
    <div className={`${CARD} rounded-xl shadow-sm dark:shadow-none`}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="recon-methodology-panel"
        className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500"
      >
        <span className="flex items-center gap-2"><Info size={16} className="text-blue-500" /> Как устроена сверка</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div id="recon-methodology-panel" className={`px-5 pb-5 text-xs text-zinc-600 dark:text-zinc-300 space-y-4 border-t ${RULE_HEAD} pt-4`}>
          <p>
            <strong>Смысл сверки</strong>: одно и то же считается двумя независимыми способами.
            Если способы сходятся — числу можно верить; если расходятся — либо в книге сломана
            формула, либо в строках беспорядок. Третьего не дано.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3">
              <div className="font-semibold text-blue-800 dark:text-blue-300">Официальное число</div>
              <div className="text-blue-700 dark:text-blue-400 mt-1 leading-relaxed">
                Берётся прямо из листа СВОД ТД-ПМ — так, как его посчитала сама книга своими
                формулами. Это то число, которое уходит в отчётность.
              </div>
            </div>
            <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-3">
              <div className="font-semibold text-indigo-800 dark:text-indigo-300">Наш пересчёт</div>
              <div className="text-indigo-700 dark:text-indigo-400 mt-1 leading-relaxed">
                Считается заново, строка за строкой, по листам управлений: способ закупки, сроки,
                плановые и фактические суммы. Формулы книги при этом не используются вовсе.
              </div>
            </div>
          </div>

          <p className="text-zinc-500 dark:text-zinc-400">
            Два сокращения, которые встречаются по всему экрану: <strong>КП</strong> — конкурентные
            процедуры (аукционы, конкурсы, запросы котировок), <strong>ЕП</strong> — закупки
            у единственного поставщика.
          </p>

          <p className="font-semibold text-zinc-700 dark:text-zinc-200">Три уровня сверки:</p>
          <ul className="list-disc pl-4 space-y-1.5">
            <li>
              <strong>По управлениям</strong> — годовые итоги плана и факта каждого управления.
              Расхождение до 1 % считается совпадением, от 1 до 5 % — несопоставимостью
              (скорее всего, срезы собраны по-разному), свыше 5 % — расхождением, которое надо разбирать.
            </li>
            <li>
              <strong>По показателям</strong> — каждое официальное число листа СВОД против своего
              пересчёта, по отдельности. Здесь видно, какой именно показатель сломан, и есть ссылка
              прямо на ячейку в книге.
            </li>
            <li>
              <strong>Помесячно</strong> — то же сравнение по листу «СВОД с месяцами»: план и факт
              конкурентных процедур и закупок у единственного поставщика в разрезе месяцев.
            </li>
          </ul>

          <p className="font-semibold text-zinc-700 dark:text-zinc-200 pt-1">Что именно сравнивается:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <caption className="sr-only">Показатели сверки: значение и способ получения</caption>
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Показатель</th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Что означает</th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Как получается в пересчёте</th>
                </tr>
              </thead>
              <tbody className={RULE_DIVIDE}>
                {METRIC_EXPLANATIONS.map((row) => (
                  <tr key={row.metric}>
                    <th scope="row" className="px-2 py-1 text-left font-medium text-zinc-700 dark:text-zinc-200">{row.metric}</th>
                    <td className="px-2 py-1">{row.meaning}</td>
                    <td className="px-2 py-1 text-zinc-500 dark:text-zinc-400">{row.origin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="font-semibold text-zinc-700 dark:text-zinc-200 pt-1">Где в книге лежат официальные числа:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <caption className="sr-only">Привязка управлений к строкам и ячейкам листа СВОД ТД-ПМ</caption>
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Управление</th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium" title="Лист книги управления, по которому идёт пересчёт">Лист пересчёта</th>
                  <th scope="col" className="px-2 py-1.5 text-center font-medium" title="Конкурентные процедуры, 1 квартал">КП, 1 кв</th>
                  <th scope="col" className="px-2 py-1.5 text-center font-medium" title="Конкурентные процедуры, год">КП, год</th>
                  <th scope="col" className="px-2 py-1.5 text-center font-medium" title="Закупки у единственного поставщика, 1 квартал">ЕП, 1 кв</th>
                  <th scope="col" className="px-2 py-1.5 text-center font-medium" title="Закупки у единственного поставщика, год">ЕП, год</th>
                  <th scope="col" className="px-2 py-1.5 text-center font-medium">Экономия КП</th>
                  <th scope="col" className="px-2 py-1.5 text-center font-medium">Экономия ЕП</th>
                </tr>
              </thead>
              <tbody className={RULE_DIVIDE}>
                {DEPT_ANCHORS.map((d) => (
                  <tr key={d.name}>
                    <th scope="row" className="px-2 py-1 text-left font-medium text-zinc-700 dark:text-zinc-200">{d.name}</th>
                    <td className="px-2 py-1 text-blue-600 dark:text-blue-400">{d.sheet}</td>
                    <td className="px-2 py-1 text-center font-mono">строка {d.kpQ1}</td>
                    <td className="px-2 py-1 text-center font-mono">строка {d.kpYear}</td>
                    <td className="px-2 py-1 text-center font-mono">строка {d.epQ1}</td>
                    <td className="px-2 py-1 text-center font-mono">строка {d.epYear}</td>
                    <td className="px-2 py-1 text-center"><CellRef cell={d.economyKp} /></td>
                    <td className="px-2 py-1 text-center"><CellRef cell={d.economyEp} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 pt-1 leading-relaxed">
            Итоги по району лежат в тех же столбцах листа СВОД ТД-ПМ выше управлений: конкурентные
            процедуры — строки {SUMMARY_ROWS.kpQ1} (1 кв) и {SUMMARY_ROWS.kpYear} (год), закупки
            у единственного поставщика — строки {SUMMARY_ROWS.epQ1} и {SUMMARY_ROWS.epYear}.
            Расхождение означает, что формулы книги считают не то же, что лежит в строках:
            это либо сломанная формула, либо беспорядок в данных — и то и другое требует разбора.
          </p>
        </div>
      )}
    </div>
  );
}
