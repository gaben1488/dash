/**
 * MetricProvenance — нижний ярус карточки базы знаний: откуда взялась
 * ОБЯЗАННОСТЬ показывать это число (канон п.104, 18.08.2026).
 *
 * ЧЕМ ЭТОТ БЛОК ОТЛИЧАЕТСЯ ОТ СОСЕДНИХ. В попапе показателя уже живут два
 * яруса, и все три отвечают на разные вопросы:
 *   ① запись базы знаний — «что это число значит и как его считает движок»;
 *   ② «Первичка сейчас» (ProvenanceBlock в kb-tooltip) — «какая ячейка какой
 *      книги дала ИМЕННО ЭТО число в ИМЕННО ЭТОМ снимке»;
 *   ③ этот блок — «из какого документа показатель родом вообще и совпадает ли
 *      наш счёт со счётом документа».
 * Второй ярус живёт от снимка к снимку, третий не меняется от обновления
 * данных: это родословная, а не значение.
 *
 * ЕДИНЫЙ ДОМ. Блок вставлен в обе карточки БЗ — KbHover и KBTooltip, — поэтому
 * один жест (наведение на настольном, тап на телефоне) открывает родословную
 * везде, где показатель уже подписан. Отдельного экрана-справочника не
 * заводим: происхождение нужно там, где стоит число, а не в другом месте.
 *
 * ЧЕСТНАЯ ПУСТОТА. Нет записи в карте — блока нет вовсе. Пустая рамка с
 * подписью «происхождение не установлено» была бы шумом на каждом втором
 * числе и приучала бы читателя её не замечать.
 *
 * ЦВЕТ ТОЛЬКО ДАННЫМ. Янтарный горит ровно на одном классе — «считаем иначе,
 * чем источник». Остальные три класса нейтральные: «наша инициатива» — это
 * не беда, а честное признание, и красить его тревожным цветом значит врать
 * интонацией.
 */
import { AlertTriangle, GitBranch, MapPin } from 'lucide-react';
import clsx from 'clsx';
import { provenanceCard, type ProvenanceCard, type ProvenanceClass } from './metric-provenance-view';

/**
 * Панель, в которую вставлен блок, бывает двух родов, и цвета текста обязаны
 * читаться в обеих:
 *   • `themed` — панель KbHover: белая на свету, zinc-800 в темноте;
 *   • `dark`   — панель KBTooltip: всегда тёмное стекло zinc-900, даже когда
 *     страница светлая. Здесь `dark:`-варианты Tailwind не сработают, потому
 *     что тёмная тема панели не совпадает с темой документа.
 */
export type ProvenanceTone = 'themed' | 'dark';

/** Приглушённый текст пояснений. */
const MUTED: Readonly<Record<ProvenanceTone, string>> = {
  themed: 'text-zinc-600 dark:text-zinc-300',
  dark: 'text-zinc-300',
};

/** Подпись-рубрика над блоком. */
const CAPTION: Readonly<Record<ProvenanceTone, string>> = {
  themed: 'text-zinc-400 dark:text-zinc-500',
  dark: 'text-zinc-400',
};

/** Разделитель, отбивающий родословную от записи базы знаний. */
const DIVIDER: Readonly<Record<ProvenanceTone, string>> = {
  themed: 'border-zinc-200 dark:border-zinc-700',
  dark: 'border-white/[0.08]',
};

/** Имя источника — единственная жирная строка блока. */
const STRONG: Readonly<Record<ProvenanceTone, string>> = {
  themed: 'text-zinc-700 dark:text-zinc-200',
  dark: 'text-zinc-100',
};

/** Моноширинный адрес ячейки. */
const MONO: Readonly<Record<ProvenanceTone, string>> = {
  themed: 'text-zinc-700 dark:text-zinc-200',
  dark: 'text-zinc-200',
};

/** Цвет вердикта: тревожен только один класс из четырёх. */
const VERDICT_COLOR: Readonly<Record<ProvenanceClass, Record<ProvenanceTone, string>>> = {
  exact: { themed: 'text-emerald-700 dark:text-emerald-400', dark: 'text-emerald-300' },
  divergent: { themed: 'text-amber-700 dark:text-amber-400', dark: 'text-amber-300' },
  orphan: { themed: 'text-zinc-500 dark:text-zinc-400', dark: 'text-zinc-400' },
  gap: { themed: 'text-zinc-500 dark:text-zinc-400', dark: 'text-zinc-400' },
};

export interface MetricProvenanceProps {
  /** Ключ показателя в карте происхождения (`@aemr/shared`). */
  metricKey: string;
  /** Род панели-хозяина — см. ProvenanceTone. */
  tone?: ProvenanceTone;
  /** Верхний разделитель. Отключается, когда блок стоит первым в попапе. */
  divider?: boolean;
  className?: string;
}

/**
 * Тело блока без обёртки — вынесено, чтобы карточку можно было проверять
 * тестом, передав готовые данные, и чтобы будущий экран сводки происхождения
 * переиспользовал ту же вёрстку.
 */
export function MetricProvenanceBody({
  card,
  tone = 'themed',
}: {
  card: ProvenanceCard;
  tone?: ProvenanceTone;
}) {
  const divergent = card.kind === 'divergent';
  return (
    <div className="space-y-1.5" data-testid="metric-provenance" data-kind={card.kind}>
      {/* Источник — главный ответ на вопрос «откуда это вообще взялось» */}
      <div className={clsx('text-[11px] font-semibold leading-snug', STRONG[tone])}>
        {card.sourceLabel}
      </div>

      {/* Вердикт: совпадает / расходится / наша инициатива / пробел источника */}
      <div
        className={clsx(
          'flex items-start gap-1 text-[10px] leading-snug font-medium',
          VERDICT_COLOR[card.kind][tone],
        )}
        data-testid="provenance-verdict"
      >
        {divergent && <AlertTriangle size={10} className="shrink-0 mt-px" aria-hidden="true" />}
        <span>{card.verdict}</span>
      </div>

      {/* Как считает ИСТОЧНИК — дословно, без нашего пересказа (п.27) */}
      <p className={clsx('text-[10px] leading-relaxed whitespace-pre-line', MUTED[tone])}>
        {card.howSourceCounts}
      </p>

      {/* Адрес ячейки листа либо места в документе — если он известен точно */}
      {card.sheetRef && (
        <div className="flex items-start gap-1">
          <MapPin size={9} className={clsx('shrink-0 mt-[3px]', CAPTION[tone])} aria-hidden="true" />
          <span className={clsx('font-mono text-[10px] leading-snug break-words', MONO[tone])}>
            {card.sheetRef}
          </span>
        </div>
      )}

      {/* Оговорка: в чём расхождение либо чем оправдана инициатива */}
      {card.note && (
        <p
          className={clsx(
            'text-[10px] leading-relaxed whitespace-pre-line',
            divergent ? VERDICT_COLOR.divergent[tone] : MUTED[tone],
          )}
          data-testid="provenance-note"
        >
          {divergent ? `В чём разница: ${card.note}` : card.note}
        </p>
      )}
    </div>
  );
}

/**
 * Блок «Происхождение» для карточки показателя. Нет записи в карте — нет и
 * блока: см. «честная пустота» в шапке файла.
 */
export function MetricProvenance({
  metricKey,
  tone = 'themed',
  divider = true,
  className,
}: MetricProvenanceProps) {
  const card = provenanceCard(metricKey);
  if (!card) return null;

  return (
    <div
      className={clsx(divider && `mt-2 pt-2 border-t ${DIVIDER[tone]}`, className)}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <GitBranch size={9} className={clsx('shrink-0', CAPTION[tone])} aria-hidden="true" />
        <span
          className={clsx('text-[9px] font-semibold uppercase tracking-wider', CAPTION[tone])}
        >
          Происхождение
        </span>
      </div>
      <MetricProvenanceBody card={card} tone={tone} />
    </div>
  );
}
