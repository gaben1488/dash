import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default:
          'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
        success:
          'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
        warning:
          'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
        error:
          'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
        critical:
          'bg-red-200 text-red-800 dark:bg-red-600/30 dark:text-red-200',
        info:
          'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
        significant:
          'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
        outline:
          'border border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
