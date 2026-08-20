/**
 * Стражи честного счёта «новых замечаний» (issue-news.ts).
 *
 * Прецедент 20.08.2026 (прод): правка ОДНОЙ строки книги УКСиМП — лента
 * объявляет «новых замечаний 1986». Причина: счёт сравнивал ЧИСЛА замечаний,
 * а не состав, и любая просадка базы (упавший источник, фолбэк на старый
 * снимок) делала следующий здоровый пересчёт «лавиной новых».
 *
 * Обещания, которые охраняются:
 *   1. «Новое» = стабильный ключ ПОЯВИЛСЯ; неизменные замечания при полном
 *      пересчёте снимка новыми не считаются.
 *   2. Исчезнувший ключ (замечание закрыто правкой) новостей не рождает.
 *   3. Книга, чьё чтение в прошлый раз упало, при выздоровлении не выдаёт
 *      свои старые замечания за новые.
 *   4. Возврат в прошлое (фолбэк на сохранённый снимок) не рождает новостей
 *      и не сдвигает базу — следующая свежая сборка не объявляет лавину.
 *   5. Чистая книга, получившая ПЕРВОЕ замечание, объявляет именно его.
 */
import { describe, expect, it } from 'vitest';
import type { Issue } from '@aemr/shared';
import { diffIssueNews, issueBucket } from './issue-news.js';

function makeIssue(id: string, sheet?: string, severity: Issue['severity'] = 'warning'): Issue {
  return {
    id,
    severity,
    origin: 'bi_heuristic',
    category: 'signal:test',
    title: `Замечание ${id}`,
    description: 'страж-фикстура',
    sheet,
    status: 'open',
    detectedAt: '2026-08-20T00:00:00.000Z',
    detectedBy: 'test',
  };
}

/** Снимок для сравнения: замечания + какие книги наблюдались (строки-атомы). */
function makeSnapshot(createdAt: string, issues: Issue[], books: string[]) {
  const rowsByDept: Record<string, unknown[][]> = {};
  for (const book of books) rowsByDept[book] = [['строка']];
  return { createdAt, issues, rowsByDept };
}

/** Тысяча старых замечаний книги УКСиМП — фон, который НЕ должен объявляться. */
function manyIssues(book: string, n: number): Issue[] {
  return Array.from({ length: n }, (_, i) => makeIssue(`${book}-старое-${i}`, book));
}

describe('issueBucket', () => {
  it('книжные замечания — в корзину книги, остальные — в общий поток', () => {
    expect(issueBucket({ sheet: 'УЭР' })).toBe('УЭР');
    expect(issueBucket({ sheet: 'СВОД ТД-ПМ' })).toBe('');
    expect(issueBucket({ sheet: undefined })).toBe('');
  });
});

describe('diffIssueNews — честный счёт новых', () => {
  it('первая сборка за жизнь процесса новостей не объявляет', () => {
    const snap = makeSnapshot('2026-08-20T01:00:00.000Z', manyIssues('УЭР', 50), ['УЭР']);
    const { appeared, baseline } = diffIssueNews(undefined, snap);
    expect(appeared).toHaveLength(0);
    expect(baseline.idsByBucket.get('УЭР')?.size).toBe(50);
  });

  it('правка одной строки объявляет ОДНО новое замечание, а не все (прецедент «1986»)', () => {
    const old = manyIssues('УКСиМП', 1986);
    const first = diffIssueNews(
      undefined,
      makeSnapshot('2026-08-20T01:00:00.000Z', old, ['УКСиМП']),
    );
    // Полный пересчёт: те же 1986 ключей + один новый от правки строки.
    const second = diffIssueNews(
      first.baseline,
      makeSnapshot('2026-08-20T01:05:00.000Z', [...old, makeIssue('от-правки', 'УКСиМП', 'error')], ['УКСиМП']),
    );
    expect(second.appeared.map((i) => i.id)).toEqual(['от-правки']);
  });

  it('закрытое правкой замечание (ключ исчез) новостей не рождает', () => {
    const old = manyIssues('УЭР', 10);
    const first = diffIssueNews(undefined, makeSnapshot('2026-08-20T01:00:00.000Z', old, ['УЭР']));
    const second = diffIssueNews(
      first.baseline,
      makeSnapshot('2026-08-20T01:05:00.000Z', old.slice(1), ['УЭР']),
    );
    expect(second.appeared).toHaveLength(0);
    // Ключ действительно исчез из базы — повторное появление объявится честно.
    expect(second.baseline.idsByBucket.get('УЭР')?.has(old[0].id)).toBe(false);
  });

  it('выздоровевшая книга не выдаёт старые замечания за новые', () => {
    const uer = manyIssues('УЭР', 5);
    const uksimp = manyIssues('УКСиМП', 700);
    const healthy = diffIssueNews(
      undefined,
      makeSnapshot('2026-08-20T01:00:00.000Z', [...uer, ...uksimp], ['УЭР', 'УКСиМП']),
    );
    // Чтение УКСиМП упало: книги нет ни в строках, ни в замечаниях.
    const degraded = diffIssueNews(
      healthy.baseline,
      makeSnapshot('2026-08-20T01:05:00.000Z', uer, ['УЭР']),
    );
    expect(degraded.appeared).toHaveLength(0);
    // База по упавшей книге сохранена от последнего наблюдения.
    expect(degraded.baseline.idsByBucket.get('УКСиМП')?.size).toBe(700);
    // Книга выздоровела: её 700 замечаний — не новость.
    const recovered = diffIssueNews(
      degraded.baseline,
      makeSnapshot('2026-08-20T01:10:00.000Z', [...uer, ...uksimp], ['УЭР', 'УКСиМП']),
    );
    expect(recovered.appeared).toHaveLength(0);
  });

  it('книга, не наблюдавшаяся прошлой сборкой вовсе, лавину не объявляет', () => {
    const first = diffIssueNews(
      undefined,
      makeSnapshot('2026-08-20T01:00:00.000Z', manyIssues('УЭР', 3), ['УЭР']),
    );
    const withNewBook = diffIssueNews(
      first.baseline,
      makeSnapshot(
        '2026-08-20T01:05:00.000Z',
        [...manyIssues('УЭР', 3), ...manyIssues('УКСиМП', 400)],
        ['УЭР', 'УКСиМП'],
      ),
    );
    expect(withNewBook.appeared).toHaveLength(0);
  });

  it('возврат в прошлое (фолбэк на сохранённый снимок) — не новость и не сдвиг базы', () => {
    const now = manyIssues('УЭР', 100);
    const first = diffIssueNews(undefined, makeSnapshot('2026-08-20T01:00:00.000Z', now, ['УЭР']));
    // Сбой источника: отдан старый снимок из базы, в нём замечаний было 14.
    const fallback = diffIssueNews(
      first.baseline,
      makeSnapshot('2026-08-19T09:00:00.000Z', manyIssues('УЭР', 14), ['УЭР']),
    );
    expect(fallback.appeared).toHaveLength(0);
    expect(fallback.baseline).toBe(first.baseline);
    // Следующая здоровая сборка с теми же 100 ключами лавину НЕ объявляет.
    const healthyAgain = diffIssueNews(
      fallback.baseline,
      makeSnapshot('2026-08-20T01:10:00.000Z', now, ['УЭР']),
    );
    expect(healthyAgain.appeared).toHaveLength(0);
  });

  it('чистая книга, получившая первое замечание, объявляет именно его', () => {
    const first = diffIssueNews(
      undefined,
      makeSnapshot('2026-08-20T01:00:00.000Z', [], ['УЭР']),
    );
    const second = diffIssueNews(
      first.baseline,
      makeSnapshot('2026-08-20T01:05:00.000Z', [makeIssue('первое', 'УЭР', 'critical')], ['УЭР']),
    );
    expect(second.appeared.map((i) => i.id)).toEqual(['первое']);
  });

  it('замечания общего потока (СВОД, сбои чтения) сравнимы всегда', () => {
    const first = diffIssueNews(
      undefined,
      makeSnapshot('2026-08-20T01:00:00.000Z', [makeIssue('свод-1', 'СВОД ТД-ПМ')], ['УЭР']),
    );
    const second = diffIssueNews(
      first.baseline,
      makeSnapshot(
        '2026-08-20T01:05:00.000Z',
        [makeIssue('свод-1', 'СВОД ТД-ПМ'), makeIssue('свод-2', 'СВОД ТД-ПМ')],
        ['УЭР'],
      ),
    );
    expect(second.appeared.map((i) => i.id)).toEqual(['свод-2']);
  });
});
