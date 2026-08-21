/**
 * Сигналы книги карточками диагноста (канон п.53, спека §5).
 *
 * КАРТОЧКА ДИАГНОСТА — ЭТО ТРИ ВЕЩИ, И БЕЗ ЛЮБОЙ ИЗ НИХ ОНА БЕСПОЛЕЗНА:
 * механизм («отчего так вышло»), АДРЕС («где именно») и действие («что
 * сделать»). Сигнал без адреса заставляет читателя искать иголку в
 * трёхстах семидесяти строках и потому не будет разобран никогда.
 *
 * ТОН — МЕХАНИЗМ, НЕ УПРЁК (п.104). Красный цвет достаётся важности сигнала,
 * а не человеку, который заполнял книгу; в подписях нет ни «ошибки
 * заполнения», ни «нарушения».
 *
 * Адреса сворачиваются: тридцать адресов в развёрнутом виде хоронят под
 * собой остальные сигналы. Число сказано на кнопке, список — под ней.
 *
 * АДРЕС БЕЗ СТРОКИ — ПОЛОВИНА ОТВЕТА. Требование владельца дословно: «по
 * каждому сигналу виден ответ — какая строка, что в ней, почему», и виден он
 * ЗДЕСЬ, без ухода на другую вкладку. Поэтому под каждым адресом печатается
 * суть его строки: код процедуры, заказчик, предмет, НМЦК; кнопка «показать в
 * реестре» доводит читателя до самой строки таблицы. «Почему» карточка уже
 * несёт своим механизмом — три части ответа сходятся в одном месте.
 *
 * Ненаходка честна и разделена надвое (п.36): адрес чужой книги ГРБС или свода
 * ГОВОРИТ, что строки реестра за ним нет по природе, а адрес листа реестра без
 * строки — что строку срезал периметр или она ушла из книги. Это разные
 * новости, и выдавать их одной было бы враньём.
 */
import { AlertTriangle, ChevronDown, Info, Search } from 'lucide-react';
import { useState } from 'react';
import type { MonitoringSignal, RegistryProcedure } from '../../lib/monitoring/contract';
import { fmtCount, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { answerForAddress, type SignalAnswer } from '../../lib/monitoring/signal-answer';
import { stageLabel } from '../../lib/monitoring/stage-labels';
import { MonitoringPerimeterCaption } from './PerimeterProvider';
import { TILE } from './surfaces';

/** Порядок важности — сверху то, что меняет числа, снизу то, что мешает читать. */
const SEVERITY_ORDER = ['high', 'medium', 'low'];

const SEVERITY_LABEL: Record<string, string> = {
  high: 'Меняет числа',
  medium: 'Искажает разрезы',
  low: 'Мешает читать',
};

// Тон важности живёт в СВЕТЛОЙ теме тонкой цветной линией, а в тёмной гаснет
// вовсе (канон п.129). Красное и янтарное кольцо вокруг карточки на тёмном
// фоне и давало те «коричневые прямоугольники», на которые владелец указывал
// трижды; при этом кольцо ничего не сообщало сверх уже сказанного словами —
// важность названа заголовком группы («Меняет числа», «Искажает разрезы»,
// «Мешает читать») и повторена цветом значка. Разделение поверхностей берёт
// на себя светлота: карточка zinc-800/60 к странице zinc-950 — 1,158 : 1.
const SEVERITY_TONE: Record<string, string> = {
  high: 'border-red-200 dark:border-transparent',
  medium: 'border-amber-200 dark:border-transparent',
  low: 'border-zinc-200 dark:border-transparent',
};

/**
 * Ответ по одному адресу: что записано в строке, за которой стоит сигнал.
 * Строка называется целиком одной фразой — читателю нужен не «D34», а «ЭА152-26,
 * школа № 1, ремонт кровли, 1,2 млн» — и доводится кнопкой до таблицы реестра.
 */
function AddressAnswer({
  answer, onOpenCode,
}: { answer: SignalAnswer; onOpenCode?: (code: string) => void }) {
  const p: RegistryProcedure | null = answer.procedure;

  return (
    <li className={`${TILE} px-2 py-1.5`}>
      <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{answer.address}</p>

      {answer.kind === 'row' && p !== null && (
        <>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-700 dark:text-zinc-200">
            <span className="font-medium">{p.code ?? 'код не разобран'}</span>
            {' · '}{p.customer}
            {p.subject !== '' && <> · {p.subject}</>}
          </p>
          <p className="mt-0.5 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
            НМЦК {fmtRub(p.nmck)} руб. · {stageLabel(p.stage)}
            {p.winnerName !== null && <> · победитель {p.winnerName}</>}
          </p>
          {onOpenCode !== undefined && p.code !== null && (
            <button
              type="button"
              onClick={() => onOpenCode(p.code as string)}
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-zinc-600 dark:text-zinc-300 hover:underline"
            >
              <Search size={9} aria-hidden="true" /> показать эту строку в реестре
            </button>
          )}
        </>
      )}

      {answer.kind === 'not-registry' && (
        <p className="mt-0.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
          Этот адрес указывает не на строку реестра, а на встречную сторону — книгу управления,
          свод либо справочник учреждений. Строки процедуры за ним нет по природе адреса.
        </p>
      )}

      {answer.kind === 'row-missing' && (
        <p className="mt-0.5 text-[10px] leading-snug text-amber-700 dark:text-amber-400">
          Строки {answer.ref?.row} листа «{answer.ref?.sheet}» в показанном реестре нет: либо её
          срезал выбранный в шапке периметр, либо она ушла из книги между двумя чтениями.
        </p>
      )}
    </li>
  );
}

function SignalCard({
  s, byAddress, onOpenCode,
}: {
  s: MonitoringSignal;
  byAddress: ReadonlyMap<string, RegistryProcedure>;
  onOpenCode?: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = s.severity === 'high' ? AlertTriangle : Info;
  return (
    <li className={`rounded-xl border bg-white dark:bg-zinc-800/60 p-3 ${SEVERITY_TONE[s.severity] ?? SEVERITY_TONE.low}`}>
      <div className="flex items-start gap-2">
        <Icon
          size={13}
          aria-hidden="true"
          className={`mt-0.5 shrink-0 ${s.severity === 'high' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
            {s.title}
            <span className="ml-1.5 tabular-nums text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
              {pluralCount(s.count, 'случай', 'случая', 'случаев')}
            </span>
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">{s.mechanism}</p>
          {s.action !== '' && (
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200">
              <span className="text-zinc-400 dark:text-zinc-500">Что сделать: </span>{s.action}
            </p>
          )}
          {s.addresses.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 hover:underline"
              >
                <ChevronDown size={10} aria-hidden="true" className={open ? 'rotate-180' : ''} />
                {open
                  ? 'скрыть строки'
                  : `показать строки за сигналом (${fmtCount(s.addresses.length)})`}
              </button>
              {open && (
                <ul className="mt-1 space-y-1 max-h-72 overflow-y-auto pr-1">
                  {s.addresses.map((a) => (
                    <AddressAnswer
                      key={a}
                      answer={answerForAddress(a, byAddress)}
                      {...(onOpenCode !== undefined ? { onOpenCode } : {})}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export interface SignalCardsProps {
  signals: readonly MonitoringSignal[];
  /**
   * Указатель «лист + строка → процедура». Строится один раз на ответ сервера
   * страницей: у одного сигнала адресов бывают десятки, и собирать указатель
   * внутри карточки значило бы пересобирать его на каждое раскрытие.
   */
  byAddress: ReadonlyMap<string, RegistryProcedure>;
  /**
   * Момент чтения книги словами. Сигнал — такое же число экрана, как сумма:
   * он посчитан машинными проверками по СНИМКУ книги, и без момента читатель
   * не знает, о какой книге речь — сегодняшней или пятиминутной давности.
   */
  readAtLabel?: string;
  /** Срез, в котором сигналы посчитаны, словами (п.127). */
  scopeLabel?: string;
  /** Довести читателя до строки в таблице реестра. */
  onOpenCode?: (code: string) => void;
}

export function SignalCards({
  signals, byAddress, readAtLabel, scopeLabel, onOpenCode,
}: SignalCardsProps) {
  const groups = SEVERITY_ORDER
    .map((sev) => ({ sev, items: signals.filter((s) => s.severity === sev) }))
    .filter((g) => g.items.length > 0);
  const rest = signals.filter((s) => !SEVERITY_ORDER.includes(s.severity));
  if (rest.length > 0) groups.push({ sev: 'other', items: rest });

  return (
    <section aria-label="Сигналы книги" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            Сигналы книги — {pluralCount(signals.length, 'класс', 'класса', 'классов')}
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 max-w-3xl">
            Каждый сигнал — механизм расхождения и строки книги, по которым его видно: адрес,
            что в этой строке записано и кнопка до неё в реестре. Это не оценка работы отдела:
            почти все сигналы возникают от того, что книгу ведут руками в таблице без проверок
            ввода.
          </p>
        </div>
        {/* Провенанс сигнала: чем он посчитан, по какому срезу и на какой
            момент. До этого у сигналов не было ни источника, ни момента — из
            двух половин требования владельца не выполнялась ни одна. */}
        <div className="shrink-0 text-right">
          <p className="text-[10px] leading-tight text-zinc-400 dark:text-zinc-500 max-w-[18rem] break-words">
            Источник: машинные проверки по книге «Ежедневный мониторинг»
            {scopeLabel !== undefined && `; срез: ${scopeLabel}`}
            {readAtLabel !== undefined && `; ${readAtLabel}`}
          </p>
          <MonitoringPerimeterCaption scope="registry" className="max-w-[18rem]" />
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.sev}>
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {SEVERITY_LABEL[g.sev] ?? 'Прочее'}
          </p>
          <ul className="mt-1.5 grid gap-2 md:grid-cols-2">
            {g.items.map((s) => (
              <SignalCard
                key={s.id || s.title}
                s={s}
                byAddress={byAddress}
                {...(onOpenCode !== undefined ? { onOpenCode } : {})}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
