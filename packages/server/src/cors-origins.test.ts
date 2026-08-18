/**
 * Список адресов, которым браузер разрешает обращаться к API.
 *
 * Реестр багов 09.07.2026, п.15 «CORS хардкодит только localhost-порты»:
 * два адреса локальной разработки были вписаны прямо в app.ts, и на боевом
 * сервере, где продукт открывают по доменному имени, разрешения не
 * существовало вовсе. Список переехал в переменную окружения
 * AEMR_CORS_ORIGINS; стражи ниже держат оба конца: адрес из окружения
 * доходит до сервера, а незаданная переменная не оставляет продукт
 * вообще без разрешений.
 */
import { describe, it, expect } from 'vitest';
import { parseCorsOrigins, DEV_CORS_ORIGINS } from './config.js';

describe('parseCorsOrigins', () => {
  it('берёт адреса из переменной окружения, а не из кода', () => {
    expect(parseCorsOrigins('https://dash-elizovo-uer.ru')).toEqual(['https://dash-elizovo-uer.ru']);
  });

  it('читает список через запятую и не спотыкается о пробелы', () => {
    expect(parseCorsOrigins(' https://dash-elizovo-uer.ru , https://stage.example ')).toEqual([
      'https://dash-elizovo-uer.ru',
      'https://stage.example',
    ]);
  });

  it('переменная не задана — остаются адреса разработки', () => {
    expect(parseCorsOrigins(undefined)).toEqual([...DEV_CORS_ORIGINS]);
  });

  it('пустая строка или одни запятые — это «не задали», а не «запретить всё»', () => {
    // Лишний пробел в конфигурации не должен выключать веб целиком.
    expect(parseCorsOrigins('')).toEqual([...DEV_CORS_ORIGINS]);
    expect(parseCorsOrigins('  ,  , ')).toEqual([...DEV_CORS_ORIGINS]);
  });

  it('адреса разработки остаются на месте — локальный запуск ничего не требует', () => {
    expect(DEV_CORS_ORIGINS).toContain('http://localhost:5173');
  });
});
