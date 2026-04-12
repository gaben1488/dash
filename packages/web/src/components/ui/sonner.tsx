import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      position="bottom-right"
      richColors
      toastOptions={{
        classNames: {
          toast:
            'group border-zinc-200 bg-white text-zinc-950 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50',
          description: 'text-zinc-500 dark:text-zinc-400',
          actionButton:
            'bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900',
          cancelButton:
            'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
