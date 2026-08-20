import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-[var(--radius-card)] border px-3 py-1.5 ds-text-2xs shadow-[var(--elevation-3)]',
        // Фон, линия и чернила названы РОЛЬЮ и объявлены один раз. Было две
        // строки классов — отдельно светлая (белая заливка, серая линия) и
        // отдельно тёмная с цифрами zinc. Это ровно тот случай, из-за
        // которого светлая тема отставала: белый прямоугольник на кремовой
        // странице даёт 1,04 : 1, то есть края у подсказки нет вовсе.
        // Роль знает обе темы, поэтому второй строки больше не нужно.
        'border-[var(--line-strong)] bg-[var(--surface-overlay)] text-[var(--ink)]',
        'animate-in fade-in-0 zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
        'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
