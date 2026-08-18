// @vitest-environment jsdom
/**
 * Стражи хука провенанса: три исхода запроса обязаны быть РАЗЛИЧИМЫ.
 *
 * «Нет данных» в этой теме — не одно состояние, а четыре разных ответа
 * читателю: запроса не было (нет ключа строки либо секция закрыта), ответа ещё
 * ждём, сервер отказал, ответ пришёл. Слить их в один null значит показать
 * отказ сервера как чистую историю плана — ровно та подмена, против которой
 * заведён провенанс (канон п.102).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { toRowSeq, useRowProvenance } from './useRowProvenance';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Ответ сервера с минимально нужными полями (форму стережёт контракт). */
const payload = { dept: 'УКСиМП', rowSeq: 94, events: [] };

function stubFetch(impl: (url: string) => Promise<Response> | Response) {
  const spy = vi.fn((input: RequestInfo | URL) => Promise.resolve(impl(String(input))));
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('toRowSeq — № п/п закупки', () => {
  it('читает номер во всех живых формах ячейки колонки A', () => {
    expect(toRowSeq(94)).toBe(94);
    expect(toRowSeq('94')).toBe(94);
    expect(toRowSeq('94.0')).toBe(94); // так Google отдаёт числовые ячейки
    expect(toRowSeq(' 94 ')).toBe(94);
  });

  it('отсутствие номера возвращает null, а не ноль', () => {
    expect(toRowSeq('')).toBeNull();
    expect(toRowSeq(null)).toBeNull();
    expect(toRowSeq('без номера')).toBeNull();
    expect(toRowSeq(0)).toBeNull();
  });
});

describe('useRowProvenance — честные состояния', () => {
  it('без № п/п запрос не уходит: искать историю не по чему', () => {
    const spy = stubFetch(() => new Response('{}'));
    const { result } = renderHook(() => useRowProvenance('УКСиМП', null));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.idle).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('закрытая секция не читает журнал книги зря', () => {
    const spy = stubFetch(() => new Response('{}'));
    renderHook(() => useRowProvenance('УКСиМП', 94, false));
    expect(spy).not.toHaveBeenCalled();
  });

  it('успешный ответ приходит в data, загрузка снимается', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const { result } = renderHook(() => useRowProvenance('УКСиМП', 94));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(spy.mock.calls[0][0]).toBe('/api/provenance/%D0%A3%D0%9A%D0%A1%D0%B8%D0%9C%D0%9F/94');
    expect(result.current.data).toMatchObject({ dept: 'УКСиМП', rowSeq: 94 });
    expect(result.current.error).toBeNull();
  });

  it('отказ сервера даёт русскую фразу, а не пустую историю', async () => {
    stubFetch(() => new Response('нет строки', { status: 404 }));
    const { result } = renderHook(() => useRowProvenance('УКСиМП', 999));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain('Данные не найдены на сервере');
  });

  /**
   * Роут отвечает по-русски и с подсказкой (канон п.98б: реестр называет номер
   * 155, а на этой строке листа стоит закупка № 534). Общий разбор ошибок
   * показал бы JSON-конверт и обрезал фразу ровно там, где начинается польза, —
   * поэтому фраза сервера обязана доходить до экрана целиком.
   */
  it('фразу сервера достаёт из конверта целиком, без JSON и обрезки', async () => {
    const message =
      'В книге УКСиМП нет закупки с № п/п 155 (искали по колонке A среди 534 строк-закупок). '
      + 'На строке листа 155 стоит закупка с № п/п 534 («Опрессовка системы»): '
      + 'возможно, нужен именно он.';
    stubFetch(() => new Response(
      JSON.stringify({ error: 'NotFound', message, statusCode: 404 }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    ));
    const { result } = renderHook(() => useRowProvenance('УКСиМП', 155));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(message);
    expect(result.current.error).not.toContain('{');
    expect(result.current.error).toContain('Опрессовка системы');
  });

  it('различает находку «строки нет» и временное молчание источника', async () => {
    stubFetch(() => new Response(
      JSON.stringify({ message: 'В книге УДТХ нет закупки с № п/п 999.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    ));
    const missing = renderHook(() => useRowProvenance('УДТХ', 999));
    await waitFor(() => expect(missing.result.current.loading).toBe(false));
    expect(missing.result.current.errorKind).toBe('missing');

    vi.unstubAllGlobals();
    stubFetch(() => new Response(
      JSON.stringify({ message: 'Строки книги УДТХ не прочитаны.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    ));
    const down = renderHook(() => useRowProvenance('УДТХ', 12));
    await waitFor(() => expect(down.result.current.loading).toBe(false));
    expect(down.result.current.errorKind).toBe('unavailable');
  });
});
