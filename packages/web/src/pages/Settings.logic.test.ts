/**
 * Проверки на правила страницы «Система», которые легко потерять при правке
 * вёрстки. Все три относятся к обещаниям продукта, а не к деталям разметки.
 */
import { describe, it, expect } from 'vitest';
import { parseSourcesResponse, maskSecret, CELL_ADDRESS_RE } from './Settings';

describe('parseSourcesResponse: «сервер не сообщил» — не то же, что ноль', () => {
  it('rowCount отсутствует → null, а не 0 (иначе непрочитанная книга выглядит пустой)', () => {
    const [src] = parseSourcesResponse({ sources: [{ name: 'УЖКХ', status: 'warning' }] });
    expect(src.rows).toBeNull();
  });

  it('rowCount = 0 сохраняется как настоящий ноль', () => {
    const [src] = parseSourcesResponse({ sources: [{ name: 'УЖКХ', status: 'ok', rowCount: 0 }] });
    expect(src.rows).toBe(0);
  });

  it('причина отказа отделяется от подписи состояния и не тащит слово «Ошибка»', () => {
    const [src] = parseSourcesResponse({
      sources: [{ name: 'УЭР', status: 'error', statusLabel: 'Ошибка: Unable to parse range' }],
    });
    expect(src.status).toBe('error');
    expect(src.statusDetail).toBe('Unable to parse range');
  });

  it('«Активна» — это подпись состояния, а не причина: отдельной строкой не показывается', () => {
    const [src] = parseSourcesResponse({
      sources: [{ name: 'УЭР', status: 'ok', statusLabel: 'Активна' }],
    });
    expect(src.statusDetail).toBeNull();
  });

  it('пустой идентификатор книги превращается в null («не задан»), а не в пустую строку', () => {
    const [src] = parseSourcesResponse({ sources: [{ name: 'УЭР', status: 'unknown', spreadsheetId: '' }] });
    expect(src.spreadsheetId).toBeNull();
  });

  it('ответ без источников не роняет разбор', () => {
    expect(parseSourcesResponse(null)).toEqual([]);
    expect(parseSourcesResponse({})).toEqual([]);
  });
});

describe('maskSecret: закрытый ключ не показывается целиком ни при каких условиях', () => {
  it('длинный ключ отдаёт только начало и конец', () => {
    const key = `-----BEGIN PRIVATE KEY-----${'A'.repeat(400)}-----END PRIVATE KEY-----`;
    const masked = maskSecret(key);
    expect(masked).not.toContain('A'.repeat(50));
    expect(masked.length).toBeLessThan(40);
    expect(masked).toContain('…');
  });

  it('короткая строка закрывается полностью — по ней ключ не восстановить', () => {
    expect(maskSecret('short-secret')).toMatch(/^•+$/);
  });
});

describe('CELL_ADDRESS_RE: правится адрес ячейки, а не «Лист!Ячейка»', () => {
  it('принимает адрес, который ждёт сервер', () => {
    expect(CELL_ADDRESS_RE.test('D14')).toBe(true);
    expect(CELL_ADDRESS_RE.test('AA255')).toBe(true);
  });

  it('отвергает адрес с именем листа — раньше такой уходил на сервер и молча отклонялся', () => {
    expect(CELL_ADDRESS_RE.test('СВОД ТД-ПМ!D14')).toBe(false);
    expect(CELL_ADDRESS_RE.test('d14')).toBe(false);
    expect(CELL_ADDRESS_RE.test('14')).toBe(false);
  });
});
