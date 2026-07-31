/**
 * Тело документа из блоков text-blocks — ЕДИНСТВЕННОГО дома состава отчёта.
 *
 * Первая итерация Отчёта++: страница рендерит ровно те же утверждения, что
 * уходят в .docx (гарантия «страница = выгрузка» по построению, не тестом).
 * Заголовки секций получают якоря для оглавления. Следующий шаг — замена
 * текстовых абзацев на claim-строки с KbHover: состав уже на месте, интерактив
 * наращивается без смены источника чисел.
 */
import { useMemo } from 'react';
import { KbHover } from '../../components/contract/KbHover';
import {
  mainReportBlocks,
  type QuarterReports,
  type ReportForExport,
} from '../../lib/report/docx/text-blocks';

/** Якорь секции по её заголовку: ГРБС-заголовки уже несут «КОД — название». */
function anchorOf(headingText: string): string | undefined {
  // Строчные буквы обязательны: «УКСиМП» иначе остаётся без якоря,
  // и пункт оглавления ведёт в никуда.
  const m = headingText.match(/^([А-ЯЁ][А-ЯЁа-яё]{1,6}) — /);
  if (m) return `grbs-${m[1]}`;
  if (headingText.startsWith('ПО КОНКУРЕНТНЫМ')) return 'competitive';
  if (headingText.startsWith('ЕДИНСТВЕННЫЙ')) return 'single-supplier';
  return undefined;
}

export function DocumentBody(props: {
  report: ReportForExport;
  quarters: QuarterReports;
  asOfDate: string;
}) {
  const blocks = useMemo(() => {
    const all = mainReportBlocks(props.report, props.quarters, props.asOfDate);
    // Шапку документа («ОТЧЕТ ПО ЗАКУПКАМ», срез, ссылка, оговорка) рендерит
    // страница своей интерактивной версией (режим, кнопки Word) — из потока
    // блоков её выкидываем, иначе она печатается дважды. Тело начинается с
    // «ВСЕ ГРБС»; если строки нет (изменился состав) — показываем всё:
    // дубль шапки заметнее и честнее, чем молча отрезанное тело.
    const start = all.findIndex((b) => b.text === 'ВСЕ ГРБС');
    return start > 0 ? all.slice(start) : all;
  }, [props.report, props.quarters, props.asOfDate]);

  return (
    <div className="space-y-3 max-w-[72ch]">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          const id = anchorOf(b.text);
          return (
            <h2
              key={i}
              id={id}
              className="scroll-mt-4 pt-8 first:pt-0 text-[15px] font-semibold text-zinc-800 dark:text-zinc-100"
            >
              {b.text}
            </h2>
          );
        }
        if (b.kind === 'note') {
          return (
            <p key={i} className="italic text-[12px] text-zinc-500 dark:text-zinc-400">
              {b.text}
            </p>
          );
        }
        const paragraph = (
          <p key={i} className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300 tabular-nums">
            {richText(b.text)}
          </p>
        );
        // БЗ по наведению: абзац с ключом метрики оборачивается в попап
        // «Что это / Как считается / Откуда». Неполные записи kbFor гасит сам.
        return b.kb ? (
          <KbHover key={i} metricKey={b.kb}>
            {paragraph}
          </KbHover>
        ) : paragraph;
      })}
    </div>
  );
}

// ── Структурная подача поверх текста эталона («++»: то же, но лучше) ──
//
// Состав и формулировки остаются словами бумаги — единственный дом
// text-blocks не трогаем. Улучшается ПОДАЧА: бюджетные тройки из скобок
// становятся цветной мини-разметкой (семантика ФБ/КБ/МБ из DESIGN.md),
// а строки исполнения по ГРБС получают бар процента — глазом видно
// отстающих без чтения каждого числа.

/** «(ФБ – … тыс. руб., КБ – …, МБ – …)» → цветные метки вместо скобок. */
const TRIPLE_RE = /\(ФБ – ([\d\s ]+,\d{2}) тыс\. руб\., КБ – ([\d\s ]+,\d{2}) тыс\. руб\., МБ – ([\d\s ]+,\d{2}) тыс\. руб\.\)/;

/** «- УЭР – 40,00% (…)» — строка списка исполнения по ГРБС. */
const GRBS_LINE_RE = /^- ([А-ЯЁа-яё]{2,7}) – ([\d]+,[\d]{2})% (\(.+\))$/;

const BUDGET_COLOR: Record<string, string> = {
  ФБ: 'text-blue-600 dark:text-blue-400',
  КБ: 'text-emerald-600 dark:text-emerald-400',
  МБ: 'text-amber-600 dark:text-amber-500',
};

function BudgetTriple(props: { fb: string; kb: string; mb: string }) {
  const pair = (label: 'ФБ' | 'КБ' | 'МБ', value: string) => (
    <span className="whitespace-nowrap">
      <span className={`font-medium ${BUDGET_COLOR[label]}`}>{label}</span>
      {' '}{value}
    </span>
  );
  return (
    <span className="inline-flex flex-wrap gap-x-3 text-[12px] text-zinc-600 dark:text-zinc-400">
      {pair('ФБ', props.fb)}{pair('КБ', props.kb)}{pair('МБ', props.mb)}
      <span className="text-zinc-400 dark:text-zinc-500">тыс. руб</span>
    </span>
  );
}

function richText(text: string): React.ReactNode {
  // Строка исполнения ГРБС: имя, бар процента, хвост с числами.
  const grbs = text.match(GRBS_LINE_RE);
  if (grbs) {
    const p = Math.min(100, Number(grbs[2].replace(',', '.')));
    return (
      <span className="flex items-center gap-2">
        <a href={`#grbs-${grbs[1]}`} className="w-16 shrink-0 font-medium text-zinc-800 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400">
          {grbs[1]}
        </a>
        <span className="relative h-2 w-28 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <span
            className={`absolute inset-y-0 left-0 rounded-full ${p >= 100 ? 'bg-emerald-500' : p >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`}
            style={{ width: `${p}%` }}
          />
        </span>
        <span className="font-medium tabular-nums">{grbs[2]}%</span>
        <span className="text-[12px] text-zinc-500 dark:text-zinc-400">{grbs[3]}</span>
      </span>
    );
  }
  // Бюджетная тройка в скобках → цветная мини-разметка.
  const m = text.match(TRIPLE_RE);
  if (m && m.index !== undefined) {
    return (
      <>
        {text.slice(0, m.index)}
        <BudgetTriple fb={m[1]} kb={m[2]} mb={m[3]} />
        {text.slice(m.index + m[0].length)}
      </>
    );
  }
  return text;
}
