/**
 * Case guide within the existing Issues page. This does not create another
 * issue database, score or screen. A step opens real evidence / existing
 * registry or requests a read; it NEVER claims a source edit or verified fix.
 */
import { useState } from 'react';
import { ArrowRight, BookOpen, ClipboardCheck, ExternalLink, RefreshCw, X } from 'lucide-react';
import type { ControlCase, ControlGuideStepId } from '@aemr/shared';
import { buildControlCaseGuide, productLabel } from '@aemr/shared';
import clsx from 'clsx';
import { CARD, RULE_HEAD, TILE } from './surfaces';

interface Props {
  item: ControlCase;
  onClose: () => void;
  onOpenEvidence: (issueId: string) => void;
  onOpenRegistry: (dept: string) => void;
  onReread: () => void;
}

const ORDER: ControlGuideStepId[] = ['understand', 'evidence', 'action', 'recheck'];

export function ControlCaseGuide({ item, onClose, onOpenEvidence, onOpenRegistry, onReread }: Props) {
  const [selectedStep, setSelectedStep] = useState<ControlGuideStepId>('understand');
  const [rereadRequested, setRereadRequested] = useState(false);
  const guide = buildControlCaseGuide(item, item.departmentId ? productLabel(item.departmentId) : undefined);
  const stepIndex = ORDER.indexOf(selectedStep);
  const active = guide.steps[stepIndex];
  const canOpenRegistry = Boolean(item.departmentId);

  const showNext = () => setSelectedStep(ORDER[Math.min(stepIndex + 1, ORDER.length - 1)]);

  return (
    <section aria-label="Разобрать вопрос контроля" className={clsx(CARD, 'rounded-xl shadow-sm overflow-hidden')}>
      <div className={clsx('flex items-start gap-3 p-4 border-b', RULE_HEAD)}>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Вопрос контроля · текущий снимок</p>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-1">{item.label}</h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">{guide.sourceAddress}</p>
        </div>
        <button onClick={onClose} type="button" aria-label="Закрыть разбор вопроса"
          className="rounded-lg p-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 focus-visible:outline focus-visible:outline-2">
          <X size={15} />
        </button>
      </div>

      <div className="px-4 pt-3">
        <div role="group" aria-label="Шаги разбора" className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {guide.steps.map((step, i) => (
            <button key={step.id} type="button"
              aria-pressed={step.id === selectedStep}
              aria-controls="control-guide-step-panel"
              id={`control-guide-step-${step.id}`}
              onClick={() => setSelectedStep(step.id)}
              className={clsx(
                'px-2.5 py-2.5 rounded-lg text-xs text-left border transition-colors focus-visible:outline focus-visible:outline-2',
                step.id === selectedStep
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-transparent font-semibold'
                  : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-white/[0.05] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10',
              )}>
              <span className="block text-[10px] opacity-75">{`0${i + 1}`}</span>
              {step.title}
            </button>
          ))}
        </div>
      </div>

      <div id="control-guide-step-panel" role="tabpanel" aria-labelledby={`control-guide-step-${active.id}`}
        className="p-4" tabIndex={0}>
        <div className={clsx(TILE, 'p-4')}>
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{active.title}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-2 leading-relaxed">{active.description}</p>

          {active.id === 'understand' && (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-3">
              {item.verifiedImpact
                ? 'Этот тип наблюдения подтверждён проверкой. Первопричина и ответственный ещё могут требовать установления.'
                : 'Последствия предполагаются, но конкретный финансовый эффект не подтверждён. Серьёзность цвета не доказывает ущерб.'}
            </p>
          )}

          {active.id === 'evidence' && (
            <div className="mt-3 space-y-3">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Сохранено {item.observationCount} исходных наблюдений. Один вопрос не удаляет и не переписывает их историю.
              </p>
              <button type="button" onClick={() => onOpenEvidence(item.issueIds[0])}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline">
                <BookOpen size={13} /> Открыть исходные замечания <ArrowRight size={13} />
              </button>
              <details className="text-[11px] text-zinc-600 dark:text-zinc-300">
                <summary className="cursor-pointer select-none">Технические идентификаторы наблюдений</summary>
                <ul className="mt-2 space-y-1 pl-3">
                  {item.issueIds.map((id) => <li key={id} className="font-mono break-all">{id}</li>)}
                </ul>
              </details>
            </div>
          )}

          {active.id === 'action' && (
            <div className="mt-3 space-y-3">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Кому адресовать: {guide.whoCanHelp}. Ответственный за исправление не определяется автоматически по имени листа.
              </p>
              <p className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                Изменение денежного значения, срока или правового основания требует подтверждённого решения. Автоматической записи нет.
              </p>
              {canOpenRegistry && (
                <button type="button" onClick={() => onOpenRegistry(item.departmentId!)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90">
                  <ExternalLink size={13} /> Открыть управление в Реестре
                </button>
              )}
              {!canOpenRegistry && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Адрес управления не установлен; автоматический переход в чужую книгу запрещён.
                </p>
              )}
            </div>
          )}

          {active.id === 'recheck' && (
            <div className="mt-3 space-y-3">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Статус «исправлено» или исчезновение предупреждения при недоступном источнике ещё не подтверждают исправление.
                Нужны первоисточник, та же проверка и пересчёт зависимых итогов.
              </p>
              <button type="button" onClick={() => { setRereadRequested(true); onReread(); }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/10">
                <RefreshCw size={13} /> Запросить новое чтение книг
              </button>
              {rereadRequested && (
                <p role="status" className="text-[11px] text-amber-700 dark:text-amber-300">
                  Чтение запрошено. Пока не получен независимый результат, дело не считается подтверждённо закрытым.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {item.workState === 'needs_reverification'
              ? 'Отмечено исправленным · требуется перепроверка'
              : item.workState === 'false_positive'
                ? 'Признано ложным · причина остаётся в истории'
                : 'Статус исходных наблюдений сохраняется в журнале'}
          </p>
          {stepIndex < ORDER.length - 1 && (
            <button type="button" onClick={showNext}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:underline">
              Дальше <ArrowRight size={13} />
            </button>
          )}
          {stepIndex === ORDER.length - 1 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              <ClipboardCheck size={13} /> Самозакрытие запрещено
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
