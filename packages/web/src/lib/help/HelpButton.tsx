// ── Знак вопроса, открывающий справку.
//
//    Кнопка держит собственное состояние панели, поэтому её можно поставить
//    куда угодно одной строкой и ничего не прокидывать сверху.
//
//    Место по канону — правый край шапки, рядом с переключателем темы. Врезка
//    в `components/Header.tsx` (блок `.nav-tools`, где живут тема и сброс
//    фильтров) выглядит так:
//
//        import { HelpButton } from '../lib/help/HelpButton';
//        …
//        <div className="nav-tools">
//          <HelpButton />
//          <button type="button" onClick={toggleTheme} …
//
//    Класс по умолчанию — `hf-icon-btn`, то есть тот же, что у соседних
//    инструментов шапки: кнопка встаёт в ряд без дополнительной вёрстки.

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { HelpPanel } from './HelpPanel';

interface Props {
  /** Переопределение оформления: по умолчанию — кнопка-инструмент шапки. */
  className?: string;
  /**
   * Подпись рядом со знаком. Без неё кнопка остаётся значком — так она
   * задумана для шапки, где место дорого; с подписью её ставят на странице,
   * где читатель ещё не знает, что этот значок вообще есть.
   */
  label?: string;
}

export function HelpButton({ className, label }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? 'hf-icon-btn'}
        title="Как читать этот дэш"
        // Подпись есть — она и служит именем кнопки; дублировать её в
        // aria-label значит заставить диктора прочитать название дважды.
        aria-label={label ? undefined : 'Справка: как читать этот дэш'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <HelpCircle size={label ? 14 : 11} aria-hidden="true" />
        {label && <span>{label}</span>}
      </button>
      <HelpPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
