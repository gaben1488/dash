/**
 * Карточка процедуры — раскрытие строки реестра (спека §6.1), не модальное
 * окно: читатель не теряет место в таблице и может открыть две строки подряд,
 * чтобы сравнить их глазами.
 *
 * Шесть полос в одном порядке на любом экране: путь → деньги → победитель →
 * родословная → сверка с книгой ГРБС → сигналы строки. Порядок не случайный —
 * он повторяет порядок вопросов, которые задают о закупке: когда объявили,
 * почём взяли, кто выиграл, сколько раз переобъявляли, сходится ли с планом
 * управления, и что в строке не так.
 *
 * ТОН — МЕХАНИЗМ, НЕ УПРЁК (п.104). «Экономия внесена вручную: формула
 * разорвана, при изменении НМЦК число не пересчитается» — так; «ошибка
 * заполнения» — нет. Ни одна подпись здесь не называет виновного.
 *
 * НОЛЬ В ЦЕНЕ — СОДЕРЖАНИЕ, А НЕ ПУСТОТА. Прочерк ставится там, где значения
 * нет; ноль пишется нулём и объясняется словами: торги прошли без результата.
 */
import { AlertTriangle, ArrowRight, Copy, Link2 } from 'lucide-react';
import type {
  JournalRow, LineageChain, MatchRow, RegistryProcedure,
} from '../../lib/monitoring/contract';
import { procedureDefects } from '../../lib/monitoring/slices';
import {
  fmtDate, fmtDays, fmtPct, fmtRubExact, rowAddress,
} from '../../lib/monitoring/format';
import { methodLabel, stageBadgeClass, stageLabel, stageMeaning } from '../../lib/monitoring/stage-labels';

function Band({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {title}
      </h4>
      <div className="mt-1.5 space-y-1">{children}</div>
    </div>
  );
}

/** Строка «подпись — значение»; значения нет — честный прочерк, не ноль. */
function Line({ label, value, tone = 'plain' }: {
  label: string;
  value: React.ReactNode;
  tone?: 'plain' | 'good' | 'warn';
}) {
  const color = tone === 'good'
    ? 'text-emerald-700 dark:text-emerald-400'
    : tone === 'warn'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-zinc-700 dark:text-zinc-200';
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-zinc-500 dark:text-zinc-400 shrink-0">{label}</span>
      <span className={`tabular-nums text-right ${color}`}>{value}</span>
    </div>
  );
}

/** Ступень пути: дата и сколько дней прошло от предыдущей. */
function Step({ label, date, days }: { label: string; date: string | null; days: number | null }) {
  const negative = days !== null && days < 0;
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="text-right">
        <span className="tabular-nums text-zinc-700 dark:text-zinc-200">{fmtDate(date)}</span>
        {days !== null && (
          <span
            className={`ml-1.5 tabular-nums ${negative ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500'}`}
            title={negative
              ? 'Вторая дата раньше первой: этап получился отрицательной длины — так записано в книге'
              : 'календарных дней от предыдущей ступени'}
          >
            {fmtDays(days)}
          </span>
        )}
      </span>
    </div>
  );
}

export interface ProcedureCardProps {
  p: RegistryProcedure;
  /** Цепочка переобъявлений с листа «25-26»; null — родословной нет. */
  lineage?: LineageChain | null;
  /** Строка того же кода на листе «25-26» — судьба и победитель оттуда. */
  journalRow?: JournalRow | null;
  /** Строка сверки с книгой ГРБС; null — сверка ещё не подключена. */
  match?: MatchRow | null;
  /** Нажатие на код в родословной — открыть соседнюю процедуру. */
  onOpenCode?: (code: string) => void;
}

export function ProcedureCard({ p, lineage, journalRow, match, onOpenCode }: ProcedureCardProps) {
  const defects = procedureDefects(p);
  const d = p.durations;

  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-700/50 p-3 sm:p-4 space-y-4">
      {/* ── Шапка карточки: код, способ, стадия, адрес в книге ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100"
              title={p.code === null ? p.codeNote ?? undefined : undefined}
            >
              {p.code ?? (p.codeNote !== null && p.codeNote.includes('похоже на') ? 'код с опечаткой' : 'без кода')}
            </span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {methodLabel(p.method)}
            </span>
            {p.joint && (
              <span className="rounded px-1.5 py-0.5 text-[10px] bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                совместная закупка
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 max-w-3xl">{p.subject}</p>
          <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
            {rowAddress(p.sheet, p.row, p.ppNum)} · заказчик: {p.customer || 'в книге не назван'}
          </p>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${stageBadgeClass(p.stage)}`}
          title={stageMeaning(p.stage)}
        >
          {stageLabel(p.stage)}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Band title="Путь процедуры">
          <Step label="Заявка в УО" date={p.applicationDate} days={null} />
          <Step label="Публикация" date={p.publicationDate} days={d.toPublication} />
          <Step label="Окончание подачи" date={p.deadlineDate} days={d.toDeadline} />
          <Step label="Торги" date={p.auctionDate} days={d.toAuction} />
          <p className="pt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
            {d.total !== null
              ? `Весь путь — ${fmtDays(d.total)} от заявки до торгов.`
              : 'Весь путь не измерить: одной из крайних дат в книге нет.'}
          </p>
        </Band>

        <Band title="Деньги, руб.">
          <Line label="НМЦК" value={fmtRubExact(p.nmck)} />
          <Line
            label="Цена аукциона"
            value={p.auctionPrice === 0
              ? <span title="Содержательный ноль: торги прошли без результата">0,00</span>
              : fmtRubExact(p.auctionPrice)}
          />
          <Line
            label="Снижение"
            value={p.reductionRub === null
              ? '—'
              : `${fmtRubExact(p.reductionRub)} · ${fmtPct(p.reductionPct)}`}
            tone={p.reductionRub !== null && p.reductionRub > 0 ? 'good' : 'plain'}
          />
          <div className="pt-1 border-t border-zinc-200/60 dark:border-zinc-700/50">
            <Line label="Экономия ВСЕГО (книга)" value={fmtRubExact(p.savingsTotal)} />
            <Line label="в том числе МБ" value={fmtRubExact(p.savingsMb)} />
            <Line label="КБ" value={fmtRubExact(p.savingsKb)} />
            <Line label="ФБ" value={fmtRubExact(p.savingsFb)} />
          </div>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
            {p.controlAgrees === null
              ? 'Контроль «ВСЕГО = МБ+КБ+ФБ» не считается: разбивки в строке нет.'
              : p.controlAgrees
                ? 'Контроль сходится: ВСЕГО равно сумме МБ, КБ и ФБ.'
                : `Разбивка не собирается в ВСЕГО: разрыв ${fmtRubExact(p.controlGapRub)} руб.`}
            {p.selfCheck !== null && ` Сама книга в колонке проверки пишет «${p.selfCheck}».`}
          </p>
          {p.savingsManual && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              Экономия внесена числом, а не формулой: связь с ценой на этой строке разорвана —
              при изменении НМЦК значение не пересчитается.
            </p>
          )}
        </Band>

        <Band title="Победитель">
          {p.winnerName !== null
            ? <p className="text-xs text-zinc-700 dark:text-zinc-200">{p.winnerName}</p>
            : (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Наименование поставщика в ячейке не названо.
              </p>
            )}
          {p.winnerInn !== null && (
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(p.winnerInn ?? ''); }}
              title="Скопировать ИНН"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-600 dark:text-zinc-300 hover:underline"
            >
              ИНН {p.winnerInn}
              <Copy size={10} aria-hidden="true" />
            </button>
          )}
          {p.innRepeated && (
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
              ИНН записан в ячейке дважды — след копирования, на разбор не влияет.
            </p>
          )}
          {p.outcome !== null && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">Исход: {p.outcome}</p>
          )}
          {p.winner !== null && (
            <details className="text-[10px] text-zinc-400 dark:text-zinc-500">
              <summary className="cursor-pointer">ячейка книги как есть</summary>
              <p className="mt-1 whitespace-pre-line break-words text-zinc-500 dark:text-zinc-400">{p.winner}</p>
            </details>
          )}
          {journalRow?.fate != null && (
            <p className="text-[11px] text-zinc-600 dark:text-zinc-300">
              Судьба по листу «25-26»: {journalRow.fate}
            </p>
          )}
          {p.comment !== null && (
            <p className="text-[11px] text-zinc-600 dark:text-zinc-300">Комментарий книги: {p.comment}</p>
          )}
        </Band>
      </div>

      {/* ── Родословная переобъявлений ── */}
      {lineage && lineage.codes.length > 1 && (
        <div className="border-t border-zinc-200/60 dark:border-zinc-700/50 pt-3">
          <h4 className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Родословная процедуры
          </h4>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {lineage.codes.map((c, i) => (
              <span key={c} className="inline-flex items-center gap-1.5">
                {i > 0 && <ArrowRight size={11} className="text-zinc-400" aria-hidden="true" />}
                <button
                  type="button"
                  onClick={() => onOpenCode?.(c)}
                  className={`font-mono text-[11px] ${c === p.code
                    ? 'font-semibold text-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-600 dark:text-zinc-300 hover:underline'}`}
                >
                  {c}
                </button>
              </span>
            ))}
          </div>
          {lineage.notes.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
              {lineage.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
            Каждое звено — отдельный заход на закупку: столько раз процедуру объявляли заново.
          </p>
        </div>
      )}

      {/* ── Сверка со строкой книги ГРБС ── */}
      <div className="border-t border-zinc-200/60 dark:border-zinc-700/50 pt-3">
        <h4 className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Сверка со строкой книги управления
        </h4>
        {match ? (
          <div className="mt-1.5 space-y-1">
            <p className="text-[11px] text-zinc-600 dark:text-zinc-300 inline-flex items-center gap-1">
              <Link2 size={11} aria-hidden="true" />
              {match.bookDept !== null && match.bookRow !== null
                ? `Книга ${match.bookDept}, строка ${match.bookRow}`
                : 'Пара в книгах управлений не найдена'}
            </p>
            <Line label="План книги, руб." value={fmtRubExact(match.planRub)} />
            <Line label="Факт книги, руб." value={fmtRubExact(match.factRub)} />
            <Line label="Дата договора" value={fmtDate(match.contractDate)} />
            {match.verdicts.length > 0 && (
              <ul className="space-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                {match.verdicts.map((v) => <li key={v}>{v}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {p.code === null
              ? 'Сверять нечем: код процедуры в строке не разобран, а связь с книгой управления строится по коду.'
              : 'Пары в книгах управлений по этому коду пока нет: либо сверка ещё не подключена на сервере, либо строки с таким кодом в книге управления не нашлось.'}
          </p>
        )}
      </div>

      {/* ── Сигналы строки: карточки диагноста с адресами ── */}
      <div className="border-t border-zinc-200/60 dark:border-zinc-700/50 pt-3">
        <h4 className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Сигналы строки
        </h4>
        {defects.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            Машинных расхождений в этой строке не нашлось: числа сходятся, даты читаются,
            код разобран.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {defects.map((def) => (
              <li key={`${def.kind}:${def.address}:${def.note}`} className="flex items-start gap-1.5 text-[11px]">
                <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span className="text-zinc-600 dark:text-zinc-300">
                  {def.note}
                  {def.address !== '' && (
                    <span className="ml-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{def.address}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
