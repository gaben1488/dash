/** Карточка канонической процедуры: действие, сроки, деньги, участники и источники. */
import { AlertTriangle, ArrowRight, Copy, Link2 } from 'lucide-react';
import type {
  JournalRow, LineageChain, RegistryProcedure,
} from '../../lib/monitoring/contract';
import type { MatchIndex, RowMatch } from '../../lib/monitoring/match-rows';
import { procedureDefects } from '../../lib/monitoring/slices';
import {
  fmtDate, fmtDays, fmtPct, fmtRubExact, rowAddress, sourceCellUrl, fmtReadAt, procedureCodeLabel,
} from '../../lib/monitoring/format';
import { methodLabel, stageBadgeClass, stageLabel, stageMeaning } from '../../lib/monitoring/stage-labels';
import { RULE_SECTION, TILE } from './surfaces';

function Band({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
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
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-zinc-500 dark:text-zinc-400 shrink-0">{label}</span>
      <span className={`tabular-nums text-right ${color}`}>{value}</span>
    </div>
  );
}

/** Ступень пути: дата и сколько дней прошло от предыдущей. */
function Step({ label, date, days }: { label: string; date: string | null; days: number | null }) {
  const negative = days !== null && days < 0;
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
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
  bookUrl?: string | null;
  p: RegistryProcedure;
  /** Цепочка переобъявлений с листа «25-26»; null — родословной нет. */
  lineage?: LineageChain | null;
  /** Строка того же кода на листе «25-26» — судьба и победитель оттуда. */
  journalRow?: JournalRow | null;
  /** Встречная сторона книги управления по коду этой строки; null — пары нет. */
  match?: RowMatch | null;
  /**
   * Состояние самой сверки: какие книги управлений прочитаны и на какой
   * момент. Без него отсутствие пары читается одинаково в трёх разных случаях
   * («роут не поднят», «книги не прочитаны», «строки с кодом нет») — а это три
   * разные новости с тремя разными действиями (п.36).
   */
  matchIndex?: MatchIndex | null;
  /** Нажатие на код в родословной — открыть соседнюю процедуру. */
  onOpenCode?: (code: string) => void;
  codeLabel?: (code: string) => string;
}

export function ProcedureCard({
  p, lineage, journalRow, match, matchIndex, onOpenCode, bookUrl, codeLabel = (code) => code,
}: ProcedureCardProps) {
  const defects = procedureDefects(p);
  const d = p.durations;
  const sourceLink = (cell: string, label: string) => {
    const href = sourceCellUrl(bookUrl, p.sheet, cell);
    return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline dark:text-sky-300">{label}</a> : null;
  };

  return (
    <div className={`${TILE} p-3 sm:p-4 space-y-4`}>
      {/* ── Шапка карточки: код, способ, стадия, адрес в книге ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100"
              title={p.code === null ? p.codeNote ?? undefined : undefined}
            >
              {procedureCodeLabel(p) ?? (p.codeNote !== null && p.codeNote.includes('похоже на') ? 'код с опечаткой' : 'без кода')}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {methodLabel(p.method)}
            </span>
            {p.joint && (
              <span className="rounded px-1.5 py-0.5 text-xs bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                совместная закупка
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 max-w-3xl">{p.subject}</p>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            {rowAddress(p.sheet, p.row, p.ppNum)} · заказчик: {p.customer || 'в книге не назван'}
          </p>
          {/* Диагноз кода — видимым текстом, не только подсказкой при наведении
              (скриншот владельца 20.08.2026: «код с опечаткой» без объяснения
              читался как потеря данных). Догадка показана, сверка по ней не идёт. */}
          {p.code === null && (
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-amber-700 dark:text-amber-400">
              {p.codeNote ?? 'Номера процедуры в начале записи не видно; образец: ЭА152-26.'}{' '}
              Пока код не исправлен в самой книге, связь этой строки с книгами управлений и
              переходящим реестром не строится — сверка по догадке не идёт.
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-sm ${stageBadgeClass(p.stage)}`}
          title={stageMeaning(p.stage)}
        >
          {stageLabel(p.stage)}
        </span>
      </div>

      <section aria-label="Следующее действие" className={`${RULE_SECTION} pt-3 space-y-2 text-sm`}>
        <h4 className="font-semibold">Что требуется сделать</h4>
        <p className="whitespace-pre-wrap break-words">{p.requiredAction || 'Требуемое действие в источнике не указано.'}</p>
        {p.qualityNote && <p className="whitespace-pre-wrap break-words text-amber-700 dark:text-amber-300">{p.qualityNote}</p>}
        <div className="flex flex-wrap gap-4">
          {sourceLink(`A${p.row}`, 'Открыть строку в книге')}
          {sourceLink(`X${p.row}`, 'Действие в источнике')}
          {sourceLink(`Y${p.row}`, 'Замечания в источнике')}
        </div>
        {p.result && <p>Результат: {p.result}</p>}
        {p.protocolFlag && <p>Флаг протокола: {p.protocolFlag}</p>}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Band title="Путь процедуры">
          <Step label="Заявка в УО" date={p.applicationDate} days={null} />
          <Step label="Публикация" date={p.publicationDate} days={d.toPublication} />
          <Step label="Окончание подачи" date={p.deadlineDate} days={d.toDeadline} />
          <Step label="Подведение итогов" date={p.auctionDate} days={d.toAuction} />
          <p className="pt-1 text-xs text-zinc-400 dark:text-zinc-500">
            {d.total !== null
              ? `Весь путь — ${fmtDays(d.total)} от заявки до подведения итогов.`
              : 'Весь путь не измерить: одной из крайних дат в книге нет.'}
          </p>
        </Band>

        <Band title="Деньги, руб.">
          {p.factsEligible === false && p.stage === 'awarded' && (
            <p className="text-xs text-amber-700 dark:text-amber-300">Дата итогов ещё не наступила. Цена и экономия сохранены в книге, но пока не входят в денежный факт.</p>
          )}
          <Line label="НМЦК" value={fmtRubExact(p.nmck)} />
          <Line
            label="Цена по итогам"
            value={p.auctionPrice === 0
              ? <span title="Цена в книге равна нулю; результат указан отдельно">0,00</span>
              : fmtRubExact(p.auctionPrice)}
          />
          <Line
            label="Снижение"
            value={p.reductionRub === null
              ? '—'
              : `${fmtRubExact(p.reductionRub)} · ${fmtPct(p.reductionPct)}`}
            tone={p.reductionRub !== null && p.reductionRub > 0 ? 'good' : 'plain'}
          />
          <div className={`pt-1 ${RULE_SECTION}`}>
            <Line label="Экономия ВСЕГО (книга)" value={fmtRubExact(p.savingsTotal)} />
            <Line label="в том числе МБ" value={fmtRubExact(p.savingsMb)} />
            <Line label="КБ" value={fmtRubExact(p.savingsKb)} />
            <Line label="ФБ" value={fmtRubExact(p.savingsFb)} />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {p.controlAgrees === null
              ? 'Контроль «ВСЕГО = МБ+КБ+ФБ» не считается: разбивки в строке нет.'
              : p.controlAgrees
                ? 'Контроль сходится: ВСЕГО равно сумме МБ, КБ и ФБ.'
                : `Разбивка не собирается в ВСЕГО: разрыв ${fmtRubExact(p.controlGapRub)} руб.`}
            {p.selfCheck !== null && ` Источник в колонке проверки пишет «${p.selfCheck}».`}
          </p>
          {p.savingsManual && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Экономия внесена числом, а не формулой: связь с ценой на этой строке разорвана —
              при изменении НМЦК значение не пересчитается.
            </p>
          )}
        </Band>

        <Band title="Победитель">
          {p.winnerName !== null
            ? <p className="text-xs text-zinc-700 dark:text-zinc-200">{p.winnerName}</p>
            : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Наименование поставщика в ячейке не названо.
              </p>
            )}
          {p.winnerInn !== null && (
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(p.winnerInn ?? ''); }}
              title="Скопировать ИНН"
              className="inline-flex items-center gap-1 font-mono text-sm text-zinc-600 dark:text-zinc-300 hover:underline"
            >
              ИНН {p.winnerInn}
              <Copy size={10} aria-hidden="true" />
            </button>
          )}
          {p.innRepeated && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              ИНН записан в ячейке дважды — след копирования, на разбор не влияет.
            </p>
          )}
          {p.outcome !== null && (
            <p className="text-sm text-amber-700 dark:text-amber-400">Исход: {p.outcome}</p>
          )}
          {p.winner !== null && (
            <details className="text-xs text-zinc-400 dark:text-zinc-500">
              <summary className="cursor-pointer">ячейка книги как есть</summary>
              <p className="mt-1 whitespace-pre-line break-words text-zinc-500 dark:text-zinc-400">{p.winner}</p>
            </details>
          )}
          {journalRow?.fate != null && (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Результат и связи: {journalRow.fateRaw ?? journalRow.fate}
            </p>
          )}
          {p.comment !== null && (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Комментарий книги: {p.comment}</p>
          )}
        </Band>
      </div>

      {p.participants && p.participants.length > 0 && <section aria-label="Участники совместной закупки" className={`${RULE_SECTION} pt-3 space-y-2`}>
        <h4 className="text-sm font-semibold">Участники и доли · руб.</h4>
        <p className="text-sm text-zinc-500">Доли не увеличивают количество процедур. Пустая сумма означает отсутствие сведений.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left">
          <thead><tr>{['Управление и заказчик', 'НМЦК', 'Цена по итогам', 'Экономия', 'МБ', 'КБ', 'ФБ'].map((label) => <th key={label} className="p-2 font-medium">{label}</th>)}</tr></thead>
          <tbody>{p.participants.map((share) => <tr key={share.row}>
            <td className="p-2">{share.dept} · {share.customer} {sourceLink(`A${share.row}`, `Строка ${share.row}`)}</td>
            {[share.nmck, share.price, share.savings, share.savingsMb, share.savingsKb, share.savingsFb].map((value, i) => <td key={i} className="p-2 whitespace-nowrap tabular-nums">{fmtRubExact(value)}</td>)}
          </tr>)}</tbody>
        </table></div>
      </section>}

      {/* ── Родословная переобъявлений ── */}
      {lineage && lineage.codes.length > 1 && (
        <div className={`${RULE_SECTION} pt-3`}>
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Родословная процедуры
          </h4>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {lineage.codes.map((c, i) => (
              <span key={c} className="inline-flex items-center gap-1.5">
                {i > 0 && <ArrowRight size={11} className="text-zinc-400" aria-hidden="true" />}
                <button
                  type="button"
                  onClick={() => onOpenCode?.(c)}
                  className={`font-mono text-sm ${c === p.code
                    ? 'font-semibold text-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-600 dark:text-zinc-300 hover:underline'}`}
                >
                  {codeLabel(c)}
                </button>
              </span>
            ))}
          </div>
          {lineage.notes.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {lineage.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Показаны явные связи из источника; связь сама по себе не подтверждает повторное объявление.
          </p>
        </div>
      )}

      {/* ── Сверка со строкой книги ГРБС ── */}
      <div className={`${RULE_SECTION} pt-3`}>
        <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Сверка со строкой книги управления
        </h4>
        {matchIndex && <p className="mt-1 text-sm text-zinc-500">Отдельное чтение сверки: {fmtReadAt(matchIndex.readAt)}. Его время может отличаться от чтения реестра.</p>}
        {match ? (
          <div className="mt-1.5 space-y-1">
            <p className="text-sm text-zinc-600 dark:text-zinc-300 inline-flex items-start gap-1">
              <Link2 size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{match.summary}</span>
            </p>
            {match.kind === 'matched' && (
              <>
                <Line label="Начальная цена, книга, руб." value={fmtRubExact(match.nmck?.bookRub ?? null)} />
                <Line label="Начальная цена, мониторинг, руб." value={fmtRubExact(match.nmck?.monitoringRub ?? null)} />
                <Line
                  label="Факт книги, руб."
                  value={fmtRubExact(match.fact?.bookRub ?? null)}
                  tone={match.fact?.agrees === false ? 'warn' : 'plain'}
                />
                <Line label="Цена победителя, руб." value={fmtRubExact(match.fact?.monitoringRub ?? null)} />
              </>
            )}
            <ul className="space-y-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {match.verdicts.map((v) => <li key={v}>{v}</li>)}
            </ul>
            {/* Провенанс обеих сторон: адрес книги управления и адрес строки
                мониторинга. Без адресов вердикт остаётся мнением — проверить
                его читатель не может (требование владельца о числе и его
                источнике). */}
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Источник:{' '}
              {match.bookRowKey !== null ? `книга управления ${match.bookRowKey}` : 'книги управлений (колонка AG)'}
              {' ↔ '}
              {match.sheetRowKey ?? `${p.sheet} · строка ${p.row}`}
              {matchIndex !== null && matchIndex !== undefined
                && `; книги управлений в сверке: ${matchIndex.booksRead.join(', ') || 'ни одной'}`}
              . Книги управлений ведутся в тысячах — обе стороны приведены к рублям сервером.
            </p>
          </div>
        ) : (
          // ЧЕТЫРЕ РАЗНЫЕ ПРИЧИНЫ ОТСУТСТВИЯ ПАРЫ, И ОДНА НЕ ЗАМЕНЯЕТ ДРУГУЮ.
          // Прежний текст называл сразу две («либо сверка не подключена, либо
          // строки нет») — то есть не называл ни одной: действие у них разное.
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            {p.code === null
              ? 'Сверять нечем: код процедуры в строке не разобран, а связь с книгой управления строится по коду.'
              : matchIndex === null || matchIndex === undefined
                ? 'Сверка с книгами управлений сейчас не отвечает: это отказ чтения, а не отсутствие пары — числа книги не потеряны.'
                : matchIndex.booksRead.length === 0
                  ? 'Книги управлений не прочитаны — сверять было не с чем. Это состояние источника, а не расхождение: отсутствие пары здесь ничего не значит.'
                  : `Строки с этим кодом в прочитанных книгах управлений (${matchIndex.booksRead.join(', ')}) не нашлось: сверено ${matchIndex.bookRowsWithCode} строк с кодом в колонке AG.`}
          </p>
        )}

        {/* ── Внутренняя сверка «лист управления ↔ 25-26» ──
            Вторая запись той же процедуры живёт в самой книге, и расхождение
            между ними — не то же самое, что расхождение с книгой управления.
            Показывать их в одной строке значило бы смешать две разные сверки. */}
        {p.code !== null && matchIndex?.internalByCode.get(p.code) !== undefined && (() => {
          const d = matchIndex.internalByCode.get(p.code as string);
          if (d === undefined) return null;
          return (
            <div className="mt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Внутри книги: лист управления против «25-26»
              </p>
              <p className="mt-1 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
                {d.note}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Начальная цена расходится на {fmtRubExact(d.nmckDeltaRub)} руб., цена — на{' '}
                {fmtRubExact(d.priceDeltaRub)} руб.
                {d.joint && ' Строка помечена совместной: доли управлений против целого в журнале.'}
              </p>
            </div>
          );
        })()}
      </div>

      {/* ── Сигналы строки: карточки диагноста с адресами ── */}
      <div className={`${RULE_SECTION} pt-3`}>
        <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Сигналы строки
        </h4>
        {defects.length === 0 ? (
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            Машинных расхождений в этой строке не нашлось: числа сходятся, даты читаются,
            код разобран.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {defects.map((def) => (
              <li key={`${def.kind}:${def.address}:${def.note}`} className="flex items-start gap-1.5 text-sm">
                <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span className="text-zinc-600 dark:text-zinc-300">
                  {def.note}
                  {def.address !== '' && (
                    <span className="ml-1">{sourceLink(def.address.startsWith(`${p.sheet}!`) ? def.address.slice(p.sheet.length + 1) : '', def.address) ?? def.address}</span>
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
