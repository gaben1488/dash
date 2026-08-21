// ── Панель справки «Как читать этот дэш».
//
//    Почему это накладная панель, а не отдельная страница: справку открывают
//    посреди работы, чтобы разобраться с тем, что сейчас на экране. Уводить
//    читателя со страницы ради двух абзацев значит потерять контекст, ради
//    которого он и полез в справку, — а потом заставить искать дорогу назад.
//
//    Панель закрывается тремя способами: клавишей Escape, кнопкой и щелчком
//    по затемнению. Ни один из них не должен требовать точного попадания
//    мышью — справка не ловушка.

import { useEffect, useRef } from 'react';
import { X, BookOpen } from 'lucide-react';
import { HELP_TITLE, HELP_SUBTITLE, HELP_SECTIONS } from './help-content';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function HelpPanel({ open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Куда вернуть фокус после закрытия: без этого клавиатурный читатель
    // после Escape оказывается в начале страницы и заново ищет своё место.
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      // Пока панель открыта, обход по Tab замкнут внутри неё: иначе фокус
      // уходит на фильтры под затемнением, где его не видно и куда нельзя
      // нажать мышью.
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-panel-title"
        onClick={event => event.stopPropagation()}
        className="my-8 w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-transparent dark:bg-zinc-900"
      >
        <div className="flex items-start gap-3 border-b border-zinc-100 px-6 py-5 dark:border-zinc-800">
          <BookOpen size={18} className="mt-0.5 flex-shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="help-panel-title" className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
              {HELP_TITLE}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{HELP_SUBTITLE}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Закрыть справку"
            className="flex-shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {HELP_SECTIONS.map(section => (
            <section key={section.id} aria-labelledby={`help-section-${section.id}`}>
              <h3
                id={`help-section-${section.id}`}
                className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200"
              >
                {section.title}
              </h3>
              {/* Ширина строки ограничена: длинная строка теряется глазом при
                  переходе на следующую, и справку бросают на середине. */}
              <div className="max-w-[68ch] space-y-2">
                {section.paragraphs.map((paragraph, index) => (
                  <p key={index} className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="border-t border-zinc-100 px-6 py-3 dark:border-zinc-800">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Закрыть — клавишей Escape, кнопкой или щелчком мимо панели.
          </p>
        </div>
      </div>
    </div>
  );
}
