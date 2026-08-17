/**
 * «Комментарии против структуры» — отдельная секция страницы «Контроль»
 * (вкладка «Замечания»), подключающая слой аннотаций к экрану.
 *
 * КАНОНЫ (docs/superpowers/audits/2026-08-14-interview-register.md):
 *   - п.72(а) — сигнал по неактуальным комментариям: текст описывает
 *     этапность, противоречащую структурным колонкам. Это проверка
 *     СОГЛАСОВАННОСТИ текста со структурой, не чтение статуса (п.27 в силе);
 *   - п.78 — «просроченное обещание» включён в постоянную работу;
 *   - п.74(б) — посторонний текст в колонке номера процедуры не трётся молча;
 *   - п.53 — предъявление карточками диагноста: механизм / адрес / действие.
 *
 * С существующими замечаниями конвейера НЕ смешивается: у них свой словарь
 * проверок и жизненный цикл статусов, у аннотаций — свой словарь видов;
 * поэтому секция отдельная, а карточки — существующий DiagnosticCardList.
 *
 * Периметр (канон п.58а): все управления, все строки книг, момент чтения из
 * ответа сервера. Фильтры шапки сюда НЕ применяются — об этом сказано вслух
 * честной пометкой (образец — карточка «Управления»), а не лживым бейджем.
 */
import { useCallback, useEffect, useState } from 'react';
import { MessageSquareWarning, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { api, humanizeRequestError } from '../../api';
import { pluralRu } from '../../lib/economy-copy';
import { DiagnosticCardList } from '../DiagnosticCards';
import type { DiagnosticIssueLike } from '../../lib/diagnostics/mechanism-groups';

type AnnotationsResponse = Awaited<ReturnType<typeof api.getCommentAnnotations>>;

/**
 * Словарь видов несогласованности: русский заголовок-механизм, серьёзность и
 * общие для вида подсказка/действие (пер-строчный механизм и фрагмент текста
 * живут в раскрытом списке адресов карточки).
 */
const KIND_META: Record<string, { label: string; severity: string; kbHint: string; recommendation: string }> = {
  stage_marker_when_signed: {
    label: 'Этапность в комментарии при заключённом контракте',
    severity: 'warning',
    kbHint:
      'Текст комментария описывает стадию размещения процедуры (подача заявок, протокол, на подписании), '
      + 'а дата заключения в строке уже проставлена: комментарий написан до заключения и больше не отражает '
      + 'состояние закупки. Статус берётся только из структурной даты — свободный текст машинно не интерпретируется (канон п.27).',
    recommendation:
      'Владельцу книги: обновите комментарий в названной ячейке — опишите состояние после заключения '
      + 'контракта или удалите устаревшую этапность.',
  },
  past_promise_no_fact: {
    label: 'Просроченное обещание в комментарии',
    severity: 'warning',
    kbHint:
      'Комментарий обещает заключение или размещение к дате, которая уже прошла относительно момента чтения книг, '
      + 'а дата заключения не проставлена: либо обещание не исполнено, либо комментарий не обновлён после заключения (канон п.78).',
    recommendation:
      'Исполнителю: обновите комментарий — укажите актуальный срок; если контракт уже заключён, проставьте дату заключения.',
  },
  foreign_text_in_ag: {
    label: 'Посторонний текст в колонке номера процедуры',
    severity: 'info',
    kbHint:
      'Колонка номера процедуры — структурный ключ (канон п.74), основной мост к «Ежедневному мониторингу»: '
      + 'приписки рядом с номером и произвольный текст мешают связке строки. Такой текст не стирается молча — он поднимается этой карточкой.',
    recommendation:
      'Владельцу книги: оставьте в колонке только номер процедуры (например «ЭА152-26»), посторонний текст перенесите в примечание.',
  },
  stage_vs_monitoring: {
    label: 'Стадия в комментарии расходится с мониторингом',
    severity: 'warning',
    kbHint:
      'Текст комментария называет стадию, противоречащую книге «Ежедневный мониторинг». Правило включится вместе '
      + 'со связкой строк книг и мониторинга (п.72в).',
    recommendation: 'Исполнителю: сверьте комментарий со стадией процедуры в мониторинге и обновите его.',
  },
};

/** Момент чтения книг — по-русски, для подписи периметра. */
function ruMoment(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Аннотация ответа сервера → замечание для карточки диагноста. */
function toDiagnosticIssue(a: AnnotationsResponse['annotations'][number]): DiagnosticIssueLike {
  const meta = KIND_META[a.kind];
  const label = meta?.label ?? 'Несогласованность комментария со структурой';
  return {
    id: `${a.rowKey}:${a.cell}:${a.kind}`,
    severity: meta?.severity ?? 'info',
    // Заголовок «механизм: фрагмент»: группировка возьмёт механизм,
    // а фрагмент текста станет контекстом адреса в раскрытом списке.
    title: `${label}: «${a.excerpt}»`,
    description: a.mechanism,
    signal: a.kind,
    kbHint: meta?.kbHint,
    recommendation: meta?.recommendation,
    sheet: a.dept,
    cell: a.cell,
    row: a.sheetRow,
    rowSeq: a.rowSeq,
    departmentId: a.dept,
  };
}

export function CommentAnnotationsSection() {
  const [data, setData] = useState<AnnotationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.getCommentAnnotations()
      .then((res) => setData(res))
      .catch((err: unknown) => setError(humanizeRequestError(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const issues = (data?.annotations ?? []).map(toDiagnosticIssue);

  return (
    <section
      aria-label="Комментарии против структуры"
      className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <MessageSquareWarning size={16} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              Комментарии против структуры
              {data && data.total > 0 && (
                <span className="ml-2 text-zinc-500 dark:text-zinc-400 font-bold tabular-nums">{data.total}</span>
              )}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed max-w-3xl">
              Сверка свободного текста комментариев со структурными колонками строки: этапность при
              заключённом контракте, просроченные обещания, посторонний текст в колонке номера процедуры.
              Статус закупки из текста не выводится никогда (канон п.27) — проверяется только согласованность.
            </p>
          </div>
        </div>
        {/* Подпись собственного периметра (канон п.58а): бейдж выбранного
            периода здесь лгал бы — аннотации считаются по всем строкам книг. */}
        {data && (
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-300 tabular-nums">
              все управления · {data.rowsScanned} строк · {data.source === 'live' ? 'книги на' : 'снимок от'} {ruMoment(data.asOf)}
            </span>
            <span className="text-[9px] leading-tight text-amber-600 dark:text-amber-400 text-right max-w-[15rem]">
              фильтры шапки к этой секции не применяются
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-zinc-400 dark:text-zinc-500">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          Сверяем комментарии со структурой строк…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Сверка комментариев не прочитана — противоречия могут быть, но сейчас их не видно.
          </p>
          <p className="text-[10px] text-amber-700/70 dark:text-amber-400/60 mt-0.5">({error})</p>
          <button
            type="button"
            onClick={load}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-300 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <RotateCcw size={11} aria-hidden="true" /> Попробовать снова
          </button>
        </div>
      ) : issues.length === 0 ? (
        <div className="flex items-start gap-2 py-2">
          <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Противоречий не найдено: {data ? `${data.rowsScanned} ${pluralRu(data.rowsScanned, 'счётная строка', 'счётные строки', 'счётных строк')}` : 'строки книг'}{' '}
            прошли все три правила сверки. Появится противоречие — здесь встанет карточка с механизмом,
            адресом ячейки и действием; чтобы пересверить прямо сейчас, обновите данные кнопкой в шапке.
          </p>
        </div>
      ) : (
        <DiagnosticCardList issues={issues} />
      )}
    </section>
  );
}
