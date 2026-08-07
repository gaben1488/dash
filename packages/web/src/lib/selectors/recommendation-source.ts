import { CHECK_REGISTRY, productLabel } from '@aemr/shared';

/**
 * Откуда берётся текст рекомендации к замечанию — и почему её нельзя сочинять.
 *
 * Что было. Страница «Рекомендации» при отсутствии готового текста собирала
 * его сама по категории проверки. Сочинённые фразы утверждали то, чего продукт
 * не считал: «Снижение >25% — антидемпинг» печаталось для любого замечания об
 * экономии, не зная величины снижения; «не завершена в срок», «просрочена»
 * объявлялись без проверки дат. Заодно в текст утекала внутренняя разметка
 * листа — «обновите статус в колонке U», «проверьте даты (N/Q)»: буквы колонок
 * читателю ничего не говорят и в продуктовой речи запрещены (адрес ячейки
 * K1481 — другое дело, это место, а не жаргон).
 *
 * Что вместо. Рекомендация — часть проверки, а не украшение карточки. Её дом —
 * CHECK_REGISTRY (поле `recommendation`), конвейер переносит её в само
 * замечание. Здесь только выбор источника в честном порядке и признание
 * пустоты, когда текста нет ни там, ни там. Пустоту показываем словами
 * «у этой проверки нет готовой рекомендации» и даём место в книге — это правда,
 * в отличие от правдоподобного совета.
 */

/** Реестр проверок по id — для замечаний, где текст рекомендации не доехал. */
const CHECK_BY_ID = new Map(CHECK_REGISTRY.map((check) => [check.id, check]));

export type RecommendationOrigin =
  /** Текст пришёл вместе с замечанием (конвейер перенёс его из проверки). */
  | 'issue'
  /** Текста в замечании не было — взят из реестра проверок по её идентификатору. */
  | 'registry'
  /** Готового текста нет нигде: сочинять нельзя. */
  | 'none';

export interface ResolvedRecommendation {
  /** Канонический текст рекомендации; null — когда его нет. */
  text: string | null;
  origin: RecommendationOrigin;
  /**
   * Где смотреть в книге: «лист УО, ячейка K1481» либо «лист УО, строка 148».
   * Буква колонки допустима только внутри адреса ячейки. null — места нет.
   */
  where: string | null;
}

interface RecommendationInput {
  recommendation?: unknown;
  checkId?: unknown;
  category?: unknown;
  sheet?: unknown;
  departmentId?: unknown;
  cell?: unknown;
  row?: unknown;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Человеческий адрес места: лист по словарю продукта, ячейка/строка как есть. */
export function recommendationWhere(issue: RecommendationInput): string | null {
  const sheetRaw = nonEmptyString(issue.sheet) ?? nonEmptyString(issue.departmentId);
  const sheet = sheetRaw ? `лист ${productLabel(sheetRaw)}` : null;
  const cell = nonEmptyString(issue.cell);
  const row = typeof issue.row === 'number' && Number.isFinite(issue.row) ? issue.row : null;

  const spot = cell ? `ячейка ${cell}` : row !== null ? `строка ${row}` : null;
  if (sheet && spot) return `${sheet}, ${spot}`;
  return sheet ?? spot;
}

/** Рекомендация замечания: свой текст → текст проверки из реестра → честная пустота. */
export function resolveRecommendation(issue: RecommendationInput): ResolvedRecommendation {
  const where = recommendationWhere(issue);

  const own = nonEmptyString(issue.recommendation);
  if (own) return { text: own, origin: 'issue', where };

  // checkId — канонический идентификатор проверки; category у части замечаний
  // хранит id правила, совпадающий с ним, поэтому пробуем оба, но только по
  // точному ключу реестра: угадывать по префиксу значит опять сочинять.
  const byId = nonEmptyString(issue.checkId) ?? nonEmptyString(issue.category);
  const check = byId ? CHECK_BY_ID.get(byId) : undefined;
  const fromRegistry = check ? nonEmptyString(check.recommendation) : null;
  if (fromRegistry) return { text: fromRegistry, origin: 'registry', where };

  return { text: null, origin: 'none', where };
}
