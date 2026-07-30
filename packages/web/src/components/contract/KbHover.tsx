/**
 * KbHover — системная «БЗ по наведению» (Отчёт++, решение 2).
 *
 * Оборачивает любой показатель: наведение мыши и клавиатурный фокус
 * открывают попап с четырьмя подписанными абзацами базы знаний.
 * Radix Tooltip выбран из-за встроенного открытия по фокусу —
 * доступность без самодельных обработчиков. Если у метрики нет полной
 * записи в БЗ, дети рендерятся как есть: пустой попап запрещён.
 */
import type { ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { productLabel } from '@aemr/shared';
import { kbFor } from '../../lib/kb/metric-kb';

export interface KbHoverProps {
  metricKey: string;
  children: ReactNode;
}

function KbParagraph({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">
        {label}
      </div>
      {/* пример идёт вторым абзацем через \n — перенос обязан выжить */}
      <p className="text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-300 whitespace-pre-line">
        {text}
      </p>
    </div>
  );
}

export function KbHover({ metricKey, children }: KbHoverProps) {
  const kb = kbFor(metricKey);
  // Нет полной БЗ — ведём себя как будто обёртки не было вовсе.
  if (!kb) return <>{children}</>;

  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          {/* span вместо кнопки Radix: показатель — не действие;
              tabIndex даёт фокус с клавиатуры, Radix открывает по нему попап */}
          <span
            tabIndex={0}
            className="cursor-help underline decoration-dotted decoration-zinc-300 dark:decoration-zinc-600 underline-offset-2 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            {children}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 max-w-[380px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg px-5 py-4 space-y-3"
          >
            {/* заголовок — строго из канон-словаря, как у SectionCard */}
            <div className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">
              {productLabel(metricKey)}
            </div>
            <KbParagraph label="Что это" text={kb.what} />
            <KbParagraph label="Как считается" text={kb.how} />
            <KbParagraph label="Откуда" text={kb.source} />
            {kb.pitfalls && <KbParagraph label="Подводные камни" text={kb.pitfalls} />}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
