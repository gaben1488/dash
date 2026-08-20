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
 * Периметр. Сверка идёт по всем строкам всех книг, момент чтения — из ответа
 * сервера; фильтры периода и способа из шапки к секции не применяются (канон
 * п.58а — бейдж периода здесь лгал бы). Выбранное управление, напротив,
 * ПРИМЕНЯЕТСЯ (канон п.127, 20.08.2026): в срезе управления секция показывает
 * только его карточки — чужие противоречия в чужой срез не лезут.
 *
 * Режим подведов (приказ владельца 20.08.2026). Разбивки по подведомственным
 * учреждениям здесь нет, и это ответ, а не пропуск: карточка адресует ЯЧЕЙКУ
 * комментария, а имя учреждения живёт в самой строке — оно видно при переходе
 * в Реестр по адресу карточки. Секция говорит это словами.
 *
 * Облик (канон п.129). Поверхность — общая карточка продукта; отдельных
 * обводок у плашек и подписей нет, их отделяет светлота ролей.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquareWarning, CheckCircle2, Loader2, RotateCcw, Users } from 'lucide-react';
import { productLabel } from '@aemr/shared';
import { api, humanizeRequestError } from '../../api';
import { useStore } from '../../store';
import { toCanonicalDeptId } from '../../lib/dept-key';
import { deptScopeOf, filterByDeptScope } from '../../lib/selectors/dept-isolation';
import { useOrgScope } from '../../lib/selectors/org-scope';
import { pluralRu } from '../../lib/economy-copy';
import { Card, CardHeader } from '../ui/card';
import { DiagnosticCardList } from '../DiagnosticCards';
import type { DiagnosticIssueLike } from '../../lib/diagnostics/mechanism-groups';

type AnnotationsResponse = Awaited<ReturnType<typeof api.getCommentAnnotations>>;

/**
 * Словарь видов несогласованности: русский заголовок-механизм, серьёзность и
 * общие для вида подсказка/действие (пер-строчный механизм и фрагмент текста
 * живут в раскрытом списке адресов карточки).
 */
const KIND_META: Record<string, { label: string; severity: string; kbHint: string; recommendation: string }> = {
  // Информационный род с 21.08.2026 (решение владельца 20.08, дословно:
  // «скорее хороший или важный сигнал, не замечание»). Этапность в
  // комментарии нередко объясняет, почему поставщик другой: процедура не
  // состоялась, протокол признал заявку единственной. Тон справки и синий
  // бейдж «Информация» вместо жёлтого предупреждения.
  stage_marker_when_signed: {
    label: 'Этапность в комментарии при заключённом контракте',
    severity: 'info',
    kbHint:
      'Текст комментария описывает стадию размещения процедуры (подача заявок, протокол, на подписании), '
      + 'а дата заключения в строке уже проставлена. Это не ошибка: этапность может объяснять смену '
      + 'поставщика — например, аукцион не состоялся и договор заключили с единственным участником. '
      + 'Статус закупки всё равно берётся только из структурной даты, свободный текст машинно не '
      + 'интерпретируется (канон п.27) — карточка лишь показывает расхождение текста и даты.',
    recommendation:
      'Владельцу книги: сверьте, актуален ли текст в названной ячейке. Он объясняет историю закупки — '
      + 'оставьте как есть; описывает только состояние до заключения — допишите итог.',
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
  promise_after_fact: {
    label: 'Обещание в комментарии при уже заключённом контракте',
    severity: 'warning',
    kbHint:
      'Комментарий обещает событие в будущем, а дата заключения в строке уже стоит: текст написан до заключения '
      + 'и не обновлён. Читатель книги видит устаревшую картину.',
    recommendation: 'Владельцу книги: обновите комментарий — опишите состояние после заключения контракта.',
  },
  denial_when_signed: {
    label: 'Комментарий отрицает закупку при заключённом контракте',
    severity: 'warning',
    kbHint:
      'Текст комментария говорит «не будет / не состоится / отменена», а дата заключения проставлена. Законный ход '
      + '«аукцион не состоялся → контракт с единственным участником» правило пропускает — карточка встаёт только на настоящие противоречия.',
    recommendation: 'Владельцу книги: сверьте комментарий с фактом заключения и оставьте то, что соответствует действительности.',
  },
  execution_claim_no_fact: {
    label: 'Комментарий говорит об исполнении, а фактических сумм нет',
    severity: 'warning',
    kbHint:
      'Комментарий утверждает оплату или исполнение, а фактические суммы в строке пусты: либо деньги не внесены '
      + 'в книгу, либо комментарий опережает события. Обороты вида «качество исполнения» правило отличает от утверждений об оплате.',
    recommendation: 'Владельцу книги: если оплата прошла — внесите фактические суммы; если нет — поправьте комментарий.',
  },
  missing_procedure_ref: {
    label: 'Конкурентная строка без номера процедуры',
    severity: 'warning',
    kbHint:
      'Способ закупки конкурентный, а в комментарии УЭР нет номера процедуры вида «ЭА152-26». Номер — единственный '
      + 'ключ связки строки с книгой «Ежедневный мониторинг»: без него сверить НМЦК и цену торгов невозможно (канон п.74, п.101а).',
    recommendation: 'Специалисту УЭР: проставьте номер процедуры в каноническом виде — без пробелов и приписок.',
  },
  ep_reason_on_competitive: {
    label: 'ЕП-обоснование при конкурентном способе',
    severity: 'warning',
    kbHint:
      'Способ строки — конкурентный (ЭА/ЭЗК/ЭАС/ЭК), а колонка M «обоснование выбора способа (в случае ЕП)» несёт текст '
      + 'про единственного поставщика или ссылку на ст.93. Способ и обоснование спорят: либо способ устарел после смены, '
      + 'либо текст попал не в ту колонку. Живой пример — строка № п/п 2346 в книге УО («ЭА» + «Закупка с ЕП предусматривает '
      + 'заключение по наименьшей цене»); у малых закупок через электронную площадку (ч.12 ст.93) формально верен способ ЕП.',
    recommendation:
      'Владельцу книги: сверьте способ (L) с обоснованием (M) и оставьте соответствующее действительности; '
      + 'закупка по ч.12 ст.93 — это способ ЕП.',
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

  // Изоляция по управлению (канон п.127): аннотация несёт канонический ид
  // книги (a.dept) — в срезе управления показываются только свои карточки.
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const deptScope = useMemo(() => deptScopeOf(selectedDepartments), [selectedDepartments]);
  const scopedAnnotations = useMemo(
    () => filterByDeptScope(data?.annotations ?? [], deptScope, (a) => a.dept),
    [data, deptScope],
  );
  const issues = scopedAnnotations.map(toDiagnosticIssue);
  const scopeLabel = deptScope === null
    ? 'все управления'
    : [...selectedDepartments].map((d) => productLabel(toCanonicalDeptId(d))).join(', ');

  // Режим подведов: разбивать сверку по учреждениям нечем — карточка адресует
  // ячейку комментария, имя учреждения живёт в строке. Говорим это словами.
  const orgScope = useOrgScope();
  const orgNote = orgScope.mode === 'withSubs'
    ? (orgScope.hasSubs
      ? 'Карточки не разложены по подведомственным учреждениям: сверка адресует ячейку '
        + 'комментария, а учреждение указано в самой строке — оно видно по адресу карточки '
        + 'при переходе в Реестр.'
      : 'У этого управления подведомственных учреждений нет: все карточки ниже — по книге '
        + 'самого аппарата.')
    : orgScope.mode === 'grbs'
      ? 'Выбран режим «только ГРБС»: сверка всё равно идёт по всей книге управления — '
        + 'отделить комментарии подведов от комментариев аппарата в ней нечем.'
      : null;

  return (
    <section aria-label="Комментарии против структуры">
      <Card className="space-y-[var(--space-3)]">
        <CardHeader
          className="mb-0"
          title={
            <span className="inline-flex items-center gap-1.5">
              <MessageSquareWarning
                size={14}
                aria-hidden="true"
                style={{ color: 'var(--data-warn)' }}
              />
              Комментарии против структуры
              {data && issues.length > 0 && (
                <span className="tabular-nums text-[var(--ink-muted)]">{issues.length}</span>
              )}
            </span>
          }
          // Подпись собственного периметра (канон п.58а): бейдж выбранного
          // периода здесь лгал бы — сверка идёт по всем строкам книг.
          // Выбранное управление, напротив, применяется (канон п.127).
          scope={data
            ? `${scopeLabel} · сверено ${data.rowsScanned} ${pluralRu(data.rowsScanned, 'строка', 'строки', 'строк')} всех книг · ${data.source === 'live' ? 'книги на' : 'снимок от'} ${ruMoment(data.asOf)}`
            : undefined}
          note="Сверка свободного текста комментариев со структурными колонками строки: этапность при заключённом контракте, просроченные обещания, посторонний текст в колонке номера процедуры. Статус закупки из текста не выводится никогда (канон п.27) — проверяется только согласованность."
        />

        {data && (
          <p className="ds-text-3xs text-[var(--ink-faint)]">
            Период и способ из шапки к сверке не применяются; выбор управления — действует.
          </p>
        )}

        {loading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 py-4 ds-text-xs text-[var(--ink-faint)]"
          >
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            Сверяем комментарии со структурой строк…
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-[var(--radius-card)] px-3 py-2.5 ds-text-xs"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--data-warn) 10%, transparent)',
              color: 'var(--data-warn)',
            }}
          >
            <p>Сверка комментариев не прочитана — противоречия могут быть, но сейчас их не видно.</p>
            <p className="mt-0.5 ds-text-3xs opacity-80">({error})</p>
            <button
              type="button"
              onClick={load}
              className="mt-1.5 inline-flex items-center gap-1 rounded ds-text-2xs font-[var(--weight-medium)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <RotateCcw size={11} aria-hidden="true" /> Попробовать снова
            </button>
          </div>
        ) : issues.length === 0 ? (
          <div className="flex items-start gap-2 py-2">
            <CheckCircle2
              size={16}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
              style={{ color: 'var(--data-good)' }}
            />
            <p className="ds-prose ds-text-xs text-[var(--ink-muted)]">
              {deptScope !== null && (data?.total ?? 0) > 0
                ? `По выбранным управлениям (${scopeLabel}) противоречий не найдено; ` +
                  `${data?.total} ${pluralRu(data?.total ?? 0, 'карточка других управлений', 'карточки других управлений', 'карточек других управлений')} ` +
                  'видны в срезе «все управления».'
                : <>Противоречий не найдено: {data ? `${data.rowsScanned} ${pluralRu(data.rowsScanned, 'счётная строка', 'счётные строки', 'счётных строк')}` : 'строки книг'}{' '}
                  прошли все три правила сверки. Появится противоречие — здесь встанет карточка с механизмом,
                  адресом ячейки и действием; чтобы пересверить прямо сейчас, обновите данные кнопкой в шапке.</>}
            </p>
          </div>
        ) : (
          <DiagnosticCardList issues={issues} />
        )}

        {/* Ответ режима подведов — словами, а не пустым местом. */}
        {orgNote && !loading && !error && (
          <div className="flex items-start gap-2 ds-text-3xs text-[var(--ink-faint)]">
            <Users size={12} className="mt-px shrink-0" aria-hidden="true" />
            <p className="max-w-3xl">{orgNote}</p>
          </div>
        )}
      </Card>
    </section>
  );
}
