/**
 * KbHover — системная «БЗ по наведению» (Отчёт++, решение 2).
 *
 * Оборачивает любой показатель: наведение мыши и клавиатурный фокус
 * открывают попап с подписанными абзацами базы знаний. Radix Tooltip
 * выбран из-за встроенного открытия по фокусу — доступность без
 * самодельных обработчиков.
 *
 * Блок «Сейчас» (проп live) — подстановка ЖИВЫХ чисел в формулу того
 * самого показателя, на который навели: «86,6 % = 2 440 ÷ 2 819 × 100»
 * и адрес первички. Общая запись БЗ объясняет метрику вообще, этот блок —
 * конкретное число на экране. Он показывается даже там, где полной записи
 * в METRIC_KB ещё нет: живая формула ценнее пустоты. Пустой попап
 * по-прежнему запрещён — нет ни записи, ни подстановки, обёртки нет вовсе.
 *
 * Нижний ярус — «Происхождение» (канон п.104, 18.08.2026): из какого из пяти
 * источников показатель родом, как считает сам источник, совпадает ли наш
 * счёт и по какому адресу лежит первоисточник. Ярус общий для всех карточек
 * базы знаний, поэтому живёт отдельным компонентом `metric/MetricProvenance`
 * и вставлен и сюда, и в `ui/kb-tooltip`. Родословной достаточно, чтобы попап
 * открылся: она отвечает на вопрос «откуда это число вообще взялось» даже
 * там, где полной записи БЗ ещё нет.
 */
import type { ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Popover from '@radix-ui/react-popover';
import { productLabel } from '@aemr/shared';
import { kbFor } from '../../lib/kb/metric-kb';
import { useCoarsePointer } from '../../lib/coarse-pointer';
import { MetricProvenance } from '../metric/MetricProvenance';
import { DivergenceMark } from '../metric/DivergenceMark';
import { provenanceCard } from '../metric/metric-provenance-view';

export interface KbHoverProps {
  metricKey: string;
  /** Подстановка живых чисел в формулу этого показателя (блок «Сейчас»). */
  live?: string;
  /**
   * Заголовок попапа, если показатель называется на экране иначе, чем в
   * движковом словаре. Нужен там, где имя даёт первоисточник: столбцы листа
   * СВОД ТД-ПМ владелец переименовал 18.08.2026, и попап обязан открыться под
   * тем же словом, под которым читатель навёл. Ключ БЗ при этом остаётся
   * движковым — объясняется та же метрика.
   */
  title?: string;
  children: ReactNode;
}

function KbParagraph({ label, text, mono = false }: { label: string; text: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">
        {label}
      </div>
      {/* пример идёт вторым абзацем через \n — перенос обязан выжить */}
      <p
        className={`text-[12px] leading-relaxed whitespace-pre-line ${
          mono
            ? 'font-mono text-[11px] text-zinc-700 dark:text-zinc-200'
            : 'text-zinc-600 dark:text-zinc-300'
        }`}
      >
        {text}
      </p>
    </div>
  );
}

/** Классы триггера и панели — общие для hover- и тап-режима (п.73а). */
const TRIGGER_CLASS =
  'cursor-help underline decoration-dotted decoration-zinc-300 dark:decoration-zinc-600 underline-offset-2 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500';
const PANEL_CLASS =
  'z-50 w-[min(380px,calc(100vw-16px))] rounded-lg border border-zinc-200 dark:border-transparent bg-white dark:bg-zinc-800 shadow-lg px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto';

export function KbHover({ metricKey, live, title, children }: KbHoverProps) {
  const kb = kbFor(metricKey);
  const coarsePointer = useCoarsePointer();
  // Родословная показателя (канон п.104): откуда взялась ОБЯЗАННОСТЬ показывать
  // это число. Она достаточна сама по себе — у части показателей полной записи
  // в METRIC_KB ещё нет, а происхождение уже установлено, и молчать о нём
  // хуже, чем открыть попап из одного блока.
  const provenance = provenanceCard(metricKey);
  // Ни записи, ни подстановки, ни родословной — ведём себя так, будто обёртки не было.
  if (!kb && !live && !provenance) return <>{children}</>;

  const body = (
    <>
      {/* заголовок — из канон-словаря, как у SectionCard; имя первоисточника
          (подпись столбца листа) перебивает его, чтобы попап открывался под
          тем же словом, что стоит на экране */}
      <div className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">
        {title ?? productLabel(metricKey)}
      </div>
      {/* «Сейчас» идёт первым: читатель навёл на КОНКРЕТНОЕ число */}
      {live && <KbParagraph label="Сейчас на экране" text={live} mono />}
      {kb && <KbParagraph label="Что это" text={kb.what} />}
      {kb && <KbParagraph label="Как считается" text={kb.how} />}
      {kb && <KbParagraph label="Откуда" text={kb.source} />}
      {kb?.pitfalls && <KbParagraph label="Подводные камни" text={kb.pitfalls} />}
      {/* Нижний ярус — родословная: из какого документа показатель родом и
          совпадает ли наш счёт со счётом документа. Разделитель нужен только
          тогда, когда выше действительно что-то стоит. */}
      <MetricProvenance metricKey={metricKey} tone="themed" divider={Boolean(kb || live)} />
    </>
  );

  // Значок расхождения стоит РЯДОМ с числом, а не внутри попапа: читатель,
  // который не наведёт, всё равно увидит, что число считается не так, как в
  // источнике. У совпадающих показателей значка нет вовсе — фрагмент с null
  // не добавляет в разметку ничего.
  const mark = <DivergenceMark metricKey={metricKey} className="ml-0.5" />;

  // ── Координатное устройство: та же подсказка открывается тапом по метрике,
  //    тап мимо закрывает (Popover). Наведения на таче не существует. ──
  if (coarsePointer) {
    return (
      <>
        <Popover.Root>
          <Popover.Trigger asChild>
            <span tabIndex={0} className={TRIGGER_CLASS}>
              {children}
            </span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="start"
              sideOffset={6}
              collisionPadding={8}
              className={PANEL_CLASS}
            >
              {body}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {mark}
      </>
    );
  }

  return (
    <>
      <Tooltip.Provider delayDuration={250}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            {/* span вместо кнопки Radix: показатель — не действие;
                tabIndex даёт фокус с клавиатуры, Radix открывает по нему попап */}
            <span tabIndex={0} className={TRIGGER_CLASS}>
              {children}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="top"
              align="start"
              sideOffset={6}
              collisionPadding={8}
              className={PANEL_CLASS}
            >
              {body}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      {mark}
    </>
  );
}
