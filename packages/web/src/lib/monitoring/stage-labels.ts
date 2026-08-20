/**
 * Подписи стадий процедуры и тон их бейджей.
 *
 * Стадия считается ЧИСЛАМИ (цена и даты), а не текстом колонки «Победитель»
 * (канон п.27: свободный текст — не источник статусов). Здесь только слова и
 * цвет: счётная семантика живёт в ядре.
 *
 * Ступеней пять, и порядок — жизненный путь процедуры, а не алфавит: заявка
 * поступила в уполномоченный орган → процедура опубликована → торги прошли →
 * договор заключён; «без результата» стоит особняком, это не ступень пути, а
 * его обрыв.
 *
 * Незнакомая стадия НЕ прячется и не подменяется соседней: показывается её
 * ключ с честной пометкой. Ядро сейчас растит набор ступеней с четырёх до
 * пяти, и молчаливая подмена скрыла бы рассинхрон экрана с расчётом.
 */

/** Порядок ступеней на экране — путь процедуры. */
export const STAGE_ORDER: readonly string[] = [
  'application',
  'published',
  'bidding',
  'awarded',
  'no_result',
];

const STAGE_LABELS: Readonly<Record<string, string>> = {
  application: 'Заявка в уполномоченном органе',
  published: 'Объявлена, итога нет',
  bidding: 'Торги прошли',
  awarded: 'Состоялась',
  no_result: 'Без результата',
};

/** Короткая подпись для узких мест — кнопок разрезов и бейджа в таблице. */
const STAGE_SHORT: Readonly<Record<string, string>> = {
  application: 'Заявка',
  published: 'Объявлена',
  bidding: 'Торги прошли',
  awarded: 'Состоялась',
  no_result: 'Без результата',
};

/** Что стадия означает — одной фразой для подсказки и экранного диктора. */
const STAGE_MEANING: Readonly<Record<string, string>> = {
  application:
    'Заявка заказчика поступила в уполномоченный орган: ни цены аукциона, ни даты публикации в книге ещё нет.',
  published:
    'Процедура объявлена — дата публикации есть, итога нет. Ждём торгов либо внесения результата.',
  bidding:
    'Торги прошли: дата торгов в книге есть, но цена победителя ещё не внесена.',
  awarded:
    'Договор заключён: цена аукциона больше нуля, победитель назван.',
  no_result:
    'Торги прошли без результата: цена аукциона равна нулю. Это не пустота, а содержательный ноль — чаще всего «не состоялся, ноль заявок».',
};

/**
 * Тон бейджа. Цвет несут только данные: «без результата» янтарный не в укор
 * управлению — это состояние процедуры, требующее следующего шага.
 */
const STAGE_BADGE: Readonly<Record<string, string>> = {
  application: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-300',
  published: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  bidding: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  awarded: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  no_result: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
};

const UNKNOWN_BADGE = 'bg-zinc-100 text-zinc-500 dark:bg-zinc-700/50 dark:text-zinc-400';

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? `Стадия «${stage}» экрану незнакома`;
}

export function stageShort(stage: string): string {
  return STAGE_SHORT[stage] ?? stage;
}

export function stageMeaning(stage: string): string {
  return (
    STAGE_MEANING[stage]
    ?? 'Такой ступени экран не знает: расчёт стадий в ядре ушёл вперёд подписей. Строка показана как есть.'
  );
}

export function stageBadgeClass(stage: string): string {
  return STAGE_BADGE[stage] ?? UNKNOWN_BADGE;
}

/**
 * Ступени, которые реально встретились в ответе, в каноническом порядке, плюс
 * незнакомые — хвостом. Кнопки разрезов строятся по этому списку, а не по
 * жёсткой константе: иначе новая ступень ядра осталась бы без переключателя.
 */
export function stagesPresent(stages: Iterable<string>): string[] {
  const seen = new Set(stages);
  const known = STAGE_ORDER.filter((s) => seen.has(s));
  const unknown = [...seen].filter((s) => !STAGE_ORDER.includes(s)).sort();
  return [...known, ...unknown];
}

// ── Способ определения поставщика ────────────────────────────────────

/**
 * Расшифровка префикса кода. Разрез по способу нужен потому, что снижение по
 * электронному аукциону и по единственному поставщику — разные явления, и
 * складывать их в один средний процент бессмысленно.
 */
const METHOD_LABELS: Readonly<Record<string, string>> = {
  ЭА: 'электронный аукцион',
  ЭАС: 'совместный электронный аукцион',
  ЭЗК: 'запрос котировок в электронной форме',
  ЭЕП: 'закупка у единственного поставщика',
};

export function methodLabel(method: string | null): string {
  if (method === null) return 'способ не определён: код процедуры не разобран';
  return METHOD_LABELS[method] ?? `способ «${method}» в словаре книги не встречался`;
}

/** Известные способы в порядке убывания частоты в книге — для кнопок разреза. */
export const METHOD_ORDER: readonly string[] = ['ЭА', 'ЭЕП', 'ЭЗК', 'ЭАС'];
