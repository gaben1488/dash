// ── Раскрывающаяся панель «Методология единой сверки»: принцип, три уровня,
//    атрибуты метрик СВОД ТД-ПМ, маппинг управлений (статический справочник).
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

import React from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';

interface ReconMethodologyProps {
  open: boolean;
  onToggle: () => void;
}

export function ReconMethodology({ open, onToggle }: ReconMethodologyProps) {
  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
      >
        <span className="flex items-center gap-2"><Info size={16} className="text-blue-500" /> Методология единой сверки</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="px-5 pb-5 text-xs text-zinc-600 dark:text-zinc-300 space-y-4 border-t border-zinc-100 dark:border-zinc-700/50 pt-4">
          <p><strong>Принцип</strong>: Одна и та же методика агрегации применяется к двум источникам:</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <div className="font-semibold text-blue-800 dark:text-blue-300">СВОД ТД-ПМ (официальный)</div>
              <div className="text-blue-600 dark:text-blue-400 mt-1">Значения из ячеек СВОД ТД-ПМ — результат формул COUNTIFS/SUMIFS внутри Google Sheets. 216 метрик по 8 управлениям + сводные.</div>
            </div>
            <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
              <div className="font-semibold text-indigo-800 dark:text-indigo-300">Расчёт (row-by-row)</div>
              <div className="text-indigo-600 dark:text-indigo-400 mt-1">Независимый пересчёт по строкам из таблиц управлений. Колонки: L=метод, N=дата плана, Q=дата факта, H-K=бюджет плана, V-Y=бюджет факта, AB=экономия МБ.</div>
            </div>
          </div>

          <p className="font-semibold text-zinc-700 dark:text-zinc-200">Три уровня сверки:</p>
          <ul className="list-disc pl-4 space-y-1.5">
            <li><strong>По управлениям</strong> — агрегированное сравнение итоговых планов/фактов по каждому ГРБС. Порог: Δ &lt; 1% = совпадает, 1-5% = несопоставимо, &gt; 5% = расхождение.</li>
            <li><strong>По метрикам</strong> — сравнение каждой конкретной ячейки СВОД (D14, E14, G14...) с пересчитанным значением. Порог по умолчанию 1%.</li>
            <li><strong>Помесячно (СВОД с месяцами)</strong> — сравнение динамики по месяцам из листа «СВОД с месяцами» с row-by-row расчётом. Показывает КП/ЕП план/факт по каждому месяцу.</li>
          </ul>

          <p className="font-semibold text-zinc-700 dark:text-zinc-200 pt-1">Атрибуты метрик СВОД ТД-ПМ:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                  <th className="px-2 py-1.5 text-left font-medium">Колонка СВОД</th>
                  <th className="px-2 py-1.5 text-left font-medium">Атрибут</th>
                  <th className="px-2 py-1.5 text-left font-medium">Формула</th>
                  <th className="px-2 py-1.5 text-left font-medium">Колонки-источники</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                <tr><td className="px-2 py-1 font-mono">D</td><td className="px-2 py-1">План (кол-во)</td><td className="px-2 py-1">COUNTIFS по col L + col O</td><td className="px-2 py-1">L=метод, O=квартал плана</td></tr>
                <tr><td className="px-2 py-1 font-mono">E</td><td className="px-2 py-1">Факт (кол-во)</td><td className="px-2 py-1">COUNTIFS по col L + col Q</td><td className="px-2 py-1">L=метод, Q=дата факта</td></tr>
                <tr><td className="px-2 py-1 font-mono">F</td><td className="px-2 py-1">Отклонение</td><td className="px-2 py-1">=D−E</td><td className="px-2 py-1">Разница план − факт</td></tr>
                <tr><td className="px-2 py-1 font-mono">G</td><td className="px-2 py-1">Исполнение %</td><td className="px-2 py-1">=E/D</td><td className="px-2 py-1">Доля факта от плана</td></tr>
                <tr><td className="px-2 py-1 font-mono">H</td><td className="px-2 py-1">ФБ план</td><td className="px-2 py-1">SUMIFS по col H</td><td className="px-2 py-1">H=ФБ план (тыс. руб.)</td></tr>
                <tr><td className="px-2 py-1 font-mono">I</td><td className="px-2 py-1">КБ план</td><td className="px-2 py-1">SUMIFS по col I</td><td className="px-2 py-1">I=КБ план (тыс. руб.)</td></tr>
                <tr><td className="px-2 py-1 font-mono">J</td><td className="px-2 py-1">МБ план</td><td className="px-2 py-1">SUMIFS по col J</td><td className="px-2 py-1">J=МБ план (тыс. руб.)</td></tr>
                <tr><td className="px-2 py-1 font-mono">K</td><td className="px-2 py-1">Итого план</td><td className="px-2 py-1">=H+I+J</td><td className="px-2 py-1">Сумма ФБ+КБ+МБ</td></tr>
                <tr><td className="px-2 py-1 font-mono">L</td><td className="px-2 py-1">ФБ факт</td><td className="px-2 py-1">SUMIFS по col V</td><td className="px-2 py-1">V=ФБ факт (тыс. руб.)</td></tr>
                <tr><td className="px-2 py-1 font-mono">M</td><td className="px-2 py-1">КБ факт</td><td className="px-2 py-1">SUMIFS по col W</td><td className="px-2 py-1">W=КБ факт (тыс. руб.)</td></tr>
                <tr><td className="px-2 py-1 font-mono">N</td><td className="px-2 py-1">МБ факт</td><td className="px-2 py-1">SUMIFS по col X</td><td className="px-2 py-1">X=МБ факт (тыс. руб.)</td></tr>
                <tr><td className="px-2 py-1 font-mono">O</td><td className="px-2 py-1">Итого факт</td><td className="px-2 py-1">=L+M+N</td><td className="px-2 py-1">Сумма ФБ+КБ+МБ факт</td></tr>
                <tr><td className="px-2 py-1 font-mono">U</td><td className="px-2 py-1">Экономия итого за квартал</td><td className="px-2 py-1">SUMIFS по col AB</td><td className="px-2 py-1">AB=экономия МБ (тыс. руб.)</td></tr>
              </tbody>
            </table>
          </div>

          <p className="font-semibold text-zinc-700 dark:text-zinc-200 pt-1">Маппинг управлений в СВОД ТД-ПМ:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                  <th className="px-2 py-1.5 text-left font-medium">Управление</th>
                  <th className="px-2 py-1.5 text-left font-medium">Лист</th>
                  <th className="px-2 py-1.5 text-center font-medium">КП 1 кв</th>
                  <th className="px-2 py-1.5 text-center font-medium">КП Год</th>
                  <th className="px-2 py-1.5 text-center font-medium">ЕП 1 кв</th>
                  <th className="px-2 py-1.5 text-center font-medium">ЕП Год</th>
                  <th className="px-2 py-1.5 text-center font-medium">Экон. КП</th>
                  <th className="px-2 py-1.5 text-center font-medium">Экон. ЕП</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {[
                  ['УЭР',    'УЭР',   42,  47,  53,  58, 'U46', 'U57'],
                  ['УИО',    'УИО',   72,  77,  83,  88, '—',   '—'],
                  ['УАГЗО',  'УАГЗО', 102, 107, 113, 118, '—',  '—'],
                  ['УФБП',   'УФБП',  132, 137, 143, 148, '—',  'U147'],
                  ['УД',     'ВСЕ',   163, 168, 175, 180, 'U167','U179'],
                  ['УДТХ',   'УДТХ',  195, 200, 206, 211, 'U199','U210'],
                  ['УКСиМП', 'ВСЕ',   225, 230, 236, 241, 'U229','U240'],
                  ['УО',     'ВСЕ',   255, 260, 266, 271, 'U259','U270'],
                ].map(([name, sheet, kpQ1, kpY, epQ1, epY, ecoKP, ecoEP]) => (
                  <tr key={name as string}>
                    <td className="px-2 py-1 font-medium">{name}</td>
                    <td className="px-2 py-1 font-mono text-blue-500">{sheet}</td>
                    <td className="px-2 py-1 text-center font-mono">стр.{kpQ1}</td>
                    <td className="px-2 py-1 text-center font-mono">стр.{kpY}</td>
                    <td className="px-2 py-1 text-center font-mono">стр.{epQ1}</td>
                    <td className="px-2 py-1 text-center font-mono">стр.{epY}</td>
                    <td className="px-2 py-1 text-center font-mono">{ecoKP}</td>
                    <td className="px-2 py-1 text-center font-mono">{ecoEP}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 pt-1">
            Расхождение означает что формулы СВОД считают не то же что строковые данные — это сигнал проблемы данных или сломанной формулы. Сводные строки: КП 1 кв=стр.9, КП Год=стр.14, ЕП 1 кв=стр.21, ЕП Год=стр.26.
          </p>
        </div>
      )}
    </div>
  );
}
