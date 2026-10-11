/**
 * Conservative comparison of procurement descriptions. It never establishes
 * procurement identity, legal equivalence or permission to rewrite a source.
 * All conclusions are about the wording alone, with explicit abstention.
 */
export type RelationKind =
  | 'exact_text' | 'same_kind' | 'shared_topic'
  | 'material_difference' | 'contradiction' | 'different_action' | 'unknown';

export interface SubjectRelation {
  kind: RelationKind;
  /** Human-readable, source-grounded account; no inferred legal conclusions. */
  evidence: string[];
  /** True = unsafe to share a search label without review. Neither value permits editing source rows or merging procurements. */
  blocked: boolean;
}

const STOP = new Set([
  'и', 'по', 'с', 'со', 'в', 'на', 'для', 'от', 'из', 'к', 'за', 'о', 'об',
  'услуги', 'услуг', 'услугу', 'оказание', 'проведение', 'выполнение',
  'работ', 'работы', 'предоставление', 'приобретение', 'поставка', 'закупка',
]);

function textKey(value: string): string {
  return String(value ?? '')
    .toLowerCase().replace(/ё/gu, 'е')
    .replace(/[«»„“”"']/gu, ' ')
    .replace(/[.,;:!?()[\]{}]/gu, ' ')
    .replace(/[–—-]/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
}

function kindKey(value: string): string {
  return textKey(value)
    .replace(/(?<![а-яё])тко(?![а-яё])/gu, 'твердыми коммунальными отходами')
    .replace(/(?<![а-яё])канц\s*товар(?:ы|ов|ами)?(?![а-яё])/gu, 'канцелярских товаров')
    .replace(/^оказание услуг по /u, 'услуги по ')
    .replace(/^предоставление услуг по /u, 'услуги по ')
    .replace(/^(приобретение|закупка|поставка) /u, 'товары ');
}

function action(value: string): string | null {
  const t = textKey(value);
  // Predicate overrides the object description: designing repair work is not performing it.
  if (/^(?:разработка|проектирование|подготовка)(?=\s|$)/u.test(t)
      && /(?<![а-яё])(?:псд|проект|документац)/u.test(t)) return 'проектирование';
  if (/(?<![а-яё])(?:ремонт|ремонта|ремонту|ремонтные|ремонтных)(?![а-яё])/u.test(t)) return 'ремонт';
  if (/(?<![а-яё])(?:строительство|реконструкция|реконструкции)(?![а-яё])/u.test(t)) return 'строительство';
  if (/^(?:поставка|приобретение|закупка)(?=\s|$)/u.test(t)) return 'приобретение';
  if (/(?<![а-яё])(?:услуги|услуг|обслуживание|обслуживанию|заправка)(?![а-яё])/u.test(t)) return 'услуга';
  return null;
}

function amountOrDocumentNumbers(text: string): string[] {
  const norm = String(text).replace(/\d{2}\.\d{2}\.\d{4}/gu, m => m.replaceAll('.', ' '));
  return [...norm.matchAll(/\d+/gu)].map(x => x[0]);
}

function paymentPolarity(value: string): 'no' | 'yes' | null {
  const t = textKey(value);
  if (/(?<![а-яё])не\s+оплачен[а-я]*(?![а-яё])/u.test(t)
      || /(?<![а-яё])нет\s+оплаты(?![а-яё])/u.test(t)) return 'no';
  if (/(?<![а-яё])оплачен[а-я]*(?![а-яё])/u.test(t)) return 'yes';
  return null;
}

/**
 * Determines whether texts can share a search category, not whether their
 * procurement rows or actual outcomes are identical. It never edits cells.
 */
export function compareSubjectDescriptions(a: string, b: string): SubjectRelation {
  const left = textKey(a), right = textKey(b);
  if (!left || !right) {
    return { kind: 'unknown', blocked: true, evidence: ['Одно из описаний отсутствует'] };
  }
  if (left === right) {
    return { kind: 'exact_text', blocked: false, evidence: ['Совпадают все слова и числа после разбора набора'] };
  }

  const pa = paymentPolarity(a), pb = paymentPolarity(b);
  if (pa && pb && pa !== pb) {
    return { kind: 'contradiction', blocked: true, evidence: ['Одно утверждение отрицает оплату, другое утверждает её'] };
  }
  const numbersA = amountOrDocumentNumbers(a).join('|');
  const numbersB = amountOrDocumentNumbers(b).join('|');
  if (numbersA !== numbersB && (numbersA || numbersB)) {
    return {
      kind: 'material_difference', blocked: true,
      evidence: ['Отличаются числа, период, адресный номер или реквизиты; без первоисточника эквивалентность запрещена'],
    };
  }

  const modifiers: Array<[RegExp, string]> = [
    [/(?<![а-яё])капитальн[а-я]*(?![а-яё])/u, 'капитальный характер ремонта'],
    [/(?<![а-яё])текущ[а-я]*(?![а-яё])/u, 'текущий характер ремонта'],
    [/(?<![а-яё])восстановлени[а-я]*(?![а-яё])/u, 'восстановление как отдельный вид работ'],
    [/(?<![а-яё])демонтаж[а-я]*(?![а-яё])/u, 'демонтаж как отдельный вид работ'],
    [/(?<![а-яё])монтаж[а-я]*(?![а-яё])/u, 'монтаж как отдельный вид работ'],
  ];
  const difference = modifiers
    .filter(([re]) => re.test(left) !== re.test(right))
    .map(([, label]) => label);
  if (difference.length) {
    return { kind: 'material_difference', blocked: true, evidence: ['Отличается существенное уточнение: ' + difference.join(', ')] };
  }

  const aAction = action(a), bAction = action(b);
  if (aAction && bAction && aAction !== bAction) {
    return {
      kind: 'different_action', blocked: true,
      evidence: ['Разные действия: «' + aAction + '» / «' + bAction + '»'],
    };
  }

  if (kindKey(a) === kindKey(b) && (aAction || bAction)) {
    return {
      kind: 'same_kind', blocked: false,
      evidence: ['Один вид предмета при разной форме описания; отдельные закупки и их условия не отождествлены'],
    };
  }

  // Shared tokens explain why a suggestion surfaced, never certify identity.
  const terms = (text: string) => new Set(textKey(text).split(' ')
    .filter(word => word.length > 3 && !STOP.has(word)));
  const x = terms(a), y = terms(b);
  let common = 0;
  for (const word of x) if (y.has(word)) common++;
  const similarity = Math.min(x.size, y.size) > 0 ? common / Math.min(x.size, y.size) : 0;
  if (similarity >= 0.65 && common >= 2) {
    return {
      kind: 'shared_topic', blocked: true,
      evidence: ['Общие предметные слова (' + common + '), но существенная эквивалентность не доказана'],
    };
  }
  return {
    kind: 'unknown', blocked: true,
    evidence: ['Общая категория или тождество не подтверждены содержимым двух формулировок'],
  };
}
