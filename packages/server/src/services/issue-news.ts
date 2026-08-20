/**
 * Честный счёт «новых замечаний» между двумя сборками снимка.
 *
 * Прецедент 20.08.2026 (владелец, прод): правка ОДНОЙ строки книги УКСиМП —
 * лента объявляет «новых замечаний 1986». Причина: прежний счёт сравнивал
 * ЧИСЛА («стало 2000, было 14 → новых 1986»), а не состав. Любая просадка
 * базы сравнения — сборка на упавшем источнике, фолбэк на старый снимок из
 * базы — делала следующий здоровый пересчёт «лавиной новых», и лавина
 * приписывалась последней правке.
 *
 * Здесь сравнивается состав по стабильным ключам (issue-identity.ts):
 *   • «новое» = ключ появился: замечания с этим id в прошлой сборке не было;
 *   • «закрытое» = ключ исчез — исчезновение новостью не объявляется;
 *   • ключ стабилен при неизменной сути — состав id собирается из содержимого
 *     строки-якоря, а не из номера строки, момента или id снимка.
 *
 * Две защиты от ложной лавины:
 *   • книга, которую прошлая сборка НЕ наблюдала (чтение упало, книга исчезла
 *     из кэша), при выздоровлении не выдаёт свои старые замечания за новые:
 *     сравнивать их не с чем, а база по такой книге сохраняется от последнего
 *     наблюдения;
 *   • сборка-возврат в прошлое (фолбэк на сохранённый снимок не моложе базы)
 *     новостей не рождает и базу не сдвигает: прошлое — не новость.
 */
import { findDept } from '@aemr/shared';
import type { DataSnapshot, Issue } from '@aemr/shared';

/**
 * Корзина замечания: имя книги ГРБС для книжных замечаний, '' — общий поток
 * (СВОД, служебные листы, ошибки чтения). Наблюдаемость считается по корзинам:
 * книга могла не читаться в прошлый раз, общий поток наблюдается всегда.
 */
export function issueBucket(issue: Pick<Issue, 'sheet'>): string {
  const sheet = issue.sheet ?? '';
  return sheet !== '' && findDept(sheet) ? sheet : '';
}

/** База сравнения одной оси кэша (год или «все годы»). */
export interface IssueNewsBaseline {
  /** Момент сборки, из которой собрана база (createdAt снимка, ISO). */
  createdAt: string;
  /**
   * Стабильные id замечаний по корзинам. Наличие корзины означает «книга
   * наблюдалась» — пустое множество у наблюдавшейся чистой книги отличимо
   * от отсутствия корзины у книги, чьё чтение упало.
   */
  idsByBucket: Map<string, Set<string>>;
}

export interface IssueNewsDiff {
  /** Появившиеся замечания. Пусто у первой сборки и у возврата в прошлое. */
  appeared: Issue[];
  /** База для следующего сравнения. */
  baseline: IssueNewsBaseline;
}

type SnapshotForNews = Pick<DataSnapshot, 'issues' | 'createdAt' | 'rowsByDept'>;

/**
 * Сравнить сборку с базой прошлой сборки. Чистая функция: состояние (базу)
 * держит вызывающий — по одной на каждую ось кэша снимков.
 */
export function diffIssueNews(
  prev: IssueNewsBaseline | undefined,
  snapshot: SnapshotForNews,
): IssueNewsDiff {
  const issues = snapshot.issues ?? [];

  // Возврат в прошлое: фолбэк отдал снимок не моложе базы. Его состав — уже
  // объявленная история; ни новостей, ни сдвига базы.
  if (prev && snapshot.createdAt <= prev.createdAt) {
    return { appeared: [], baseline: prev };
  }

  // Какие книги наблюдала ЭТА сборка — по строкам-атомам снимка.
  const observed = new Set<string>(Object.keys(snapshot.rowsByDept ?? {}));

  const idsByBucket = new Map<string, Set<string>>();
  for (const issue of issues) {
    const bucket = issueBucket(issue);
    let set = idsByBucket.get(bucket);
    if (!set) {
      set = new Set();
      idsByBucket.set(bucket, set);
    }
    set.add(issue.id);
  }

  const appeared: Issue[] = [];
  if (prev) {
    for (const issue of issues) {
      const bucket = issueBucket(issue);
      const before = prev.idsByBucket.get(bucket);
      // Книга, которой прошлая сборка не видела, — её замечания не новость:
      // сравнить их не с чем, они могли жить там всё это время.
      if (bucket !== '' && before === undefined) continue;
      if (!before?.has(issue.id)) appeared.push(issue);
    }
  }

  // База следующего сравнения. Наблюдавшиеся корзины — по этой сборке
  // (в том числе пустым множеством: чистая книга наблюдалась). Корзина,
  // не наблюдавшаяся сейчас (упавшая книга), сохраняет прошлую базу:
  // выздоровление не должно объявить её старые замечания заново.
  const baselineIds = new Map<string, Set<string>>();
  const buckets = new Set<string>([
    '',
    ...observed,
    ...idsByBucket.keys(),
    ...(prev ? prev.idsByBucket.keys() : []),
  ]);
  for (const bucket of buckets) {
    const prevSet = prev?.idsByBucket.get(bucket);
    if (bucket === '' || observed.has(bucket) || prevSet === undefined) {
      baselineIds.set(bucket, idsByBucket.get(bucket) ?? new Set());
    } else {
      baselineIds.set(bucket, prevSet);
    }
  }

  return {
    appeared,
    baseline: { createdAt: snapshot.createdAt, idsByBucket: baselineIds },
  };
}
