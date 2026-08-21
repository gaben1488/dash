/**
 * Карточки диагноста (канон п.53 интервью 14.08.2026) — предъявление
 * замечаний классами, а не простынёй «строка N: предмет».
 *
 * Одна карточка = один механизм проверки:
 *   1) заголовок — механизм по-русски и число строк-виновниц;
 *   2) механизм простыми словами (kbHint реестра проверок);
 *   3) действие с адресатом (recommendation реестра);
 *   4) раскрываемый список адресов: лист + строка (+ предмет как контекст).
 *
 * Периметр карточек — снимок книг «на сейчас»: замечания не несут ни
 * периода, ни способа закупки (ось объявлена отсутствующей, см.
 * issueAxesWithoutData), поэтому лживый бейдж выбранного периода сюда
 * НЕ ставится — канон п.58(б) запрещает бейдж, которому числа не
 * подчиняются. Вместо него — честная подпись собственного периметра.
 */
import { useState } from 'react';
import { productLabel } from '@aemr/shared';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pluralRu } from '@/lib/economy-copy';
import {
  groupIssuesByMechanism,
  type DiagnosticIssueLike,
  type MechanismGroup,
} from '@/lib/diagnostics/mechanism-groups';

/** Русские подписи серьёзности; сырые ключи в UI недопустимы (D15). */
const SEVERITY_TEXT: Record<string, string> = {
  critical: 'Критическое',
  error: 'Ошибка',
  significant: 'Существенное',
  warning: 'Предупреждение',
  info: 'Информация',
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300',
  error: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300',
  significant: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300',
  warning: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  info: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
};

function severityText(severity: string): string {
  return SEVERITY_TEXT[severity] ?? 'Уровень не распознан';
}

function rowsWord(n: number): string {
  return pluralRu(n, 'строка', 'строки', 'строк');
}

/** Кириллическое имя листа/управления; латинский ключ на экран не выходит. */
function deptText(key: string): string {
  if (!key) return 'Без привязки к управлению';
  const label = productLabel(key);
  const untranslated = /[A-Za-z_]/.test(label) && !/[А-Яа-яЁё]/.test(label);
  return untranslated ? 'Без привязки к управлению' : label;
}

/** Сколько адресов рисуется в раскрытой карточке до свёртки «…и ещё N». */
const ADDRESS_DISPLAY_LIMIT = 30;

function DiagnosticCard({ group }: { group: MechanismGroup }) {
  const [open, setOpen] = useState(false);
  const listId = `diag-addresses-${group.key.replace(/[^\w-]/g, '_')}`;
  const shown = group.addresses.slice(0, ADDRESS_DISPLAY_LIMIT);
  const hidden = group.addresses.length - shown.length;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-transparent bg-white dark:bg-zinc-900">
      {/* Заголовок-механизм: раскрытие адресов — настоящая кнопка (клавиатура). */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={listId}
        className="w-full text-left px-4 py-3 flex items-start gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0', SEVERITY_BADGE[group.severity] ?? SEVERITY_BADGE.info)}>
              {severityText(group.severity)}
            </span>
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {group.label}
            </span>
            <span className="text-sm font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
              — {group.count} {rowsWord(group.count)}
            </span>
          </span>
          {group.kbHint && (
            <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
              {group.kbHint}
            </span>
          )}
          {group.recommendation && (
            <span className="block text-xs text-blue-700 dark:text-blue-300 mt-1 leading-relaxed">
              Что делать: {group.recommendation}
            </span>
          )}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn('shrink-0 mt-1 text-zinc-500 dark:text-zinc-400 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <ul id={listId} className="px-4 pb-3 space-y-1 border-t border-zinc-100 dark:border-zinc-800 pt-2">
          {shown.map((a, i) => (
            <li key={a.issueId ?? `${a.sheet}-${a.row}-${i}`} className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <span className="font-medium text-zinc-700 dark:text-zinc-200">{deptText(a.dept || a.sheet || '')}</span>
              {a.row != null && <>, строка <span className="tabular-nums font-medium">{a.row}</span></>}
              {/* Двойной адрес (п.98б): строки листа двигаются, позиционный
                  номер устаревает — «№ п/п» из колонки A находит строку
                  и после сдвига. */}
              {a.rowSeq && <> · № п/п <span className="tabular-nums font-medium">{a.rowSeq}</span></>}
              {a.cell && <>, ячейка <span className="font-mono text-[11px]">{a.cell}</span></>}
              {a.subject && <span className="text-zinc-500 dark:text-zinc-400"> — {a.subject}</span>}
            </li>
          ))}
          {hidden > 0 && (
            <li className="text-[11px] text-zinc-500 dark:text-zinc-400">
              …и ещё {hidden} {pluralRu(hidden, 'адрес', 'адреса', 'адресов')} — полный список на странице «Контроль».
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Список карточек диагноста из сырых замечаний. Порядок — худшая серьёзность
 * и крупные классы раньше: настоящие ошибки не тонут в шуме.
 */
export function DiagnosticCardList({ issues }: { issues: readonly DiagnosticIssueLike[] }) {
  const groups = groupIssuesByMechanism(issues, productLabel);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-2">
      {groups.map((g) => <DiagnosticCard key={g.key} group={g} />)}
    </div>
  );
}
