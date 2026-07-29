/**
 * Страж от формульной инъекции в живую книгу.
 *
 * Запись идёт с valueInputOption 'USER_ENTERED', то есть Google Sheets
 * трактует значение как ввод человека: строка «=IMPORTRANGE(...)» становится
 * живой формулой в правительственной таблице, а «=HYPERLINK(...)» — ссылкой
 * наружу. Защита в writeCellValue экранирует такие значения апострофом.
 *
 * Тест читает исходник через fs, а не вызывает функцию: у неё внутри живой
 * клиент Google API, поднимать который ради проверки одной строки — дороже,
 * чем проверить саму строку. Смысл стража — чтобы экранирование нельзя было
 * убрать «за ненадобностью»: субагент-аудитор 2026-06 находил этот путь
 * открытым, защиту добавили, а теста под неё не было — и следующая правка
 * сняла бы её молча.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'google-sheets.ts'), 'utf8');

/** Тело функции записи — искать защиту нужно именно в нём. */
function writeCellValueBody(): string {
  const start = SOURCE.indexOf('export async function writeCellValue');
  expect(start, 'функция writeCellValue не найдена — путь записи переехал').toBeGreaterThan(-1);
  const rest = SOURCE.slice(start);
  const end = rest.indexOf('\n}\n');
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe('writeCellValue — экранирование формул', () => {
  const body = writeCellValueBody();

  it('опасные первые символы проверяются перед записью', () => {
    // Классика формульной инъекции в таблицы: = + - @ (плюс табуляция и CR
    // в некоторых редакторах, но Sheets реагирует на эти четыре).
    expect(body).toMatch(/\/\^\[=\+\\?-@\]\//);
  });

  it('значение экранируется апострофом, а не отбрасывается молча', () => {
    // Апостроф в Sheets означает «это текст»: правка сохраняется целиком,
    // но формулой не становится. Отбросить значение было бы потерей данных.
    expect(body).toMatch(/`'\$\{[A-Za-z]+\}`/);
  });

  it('в запрос уходит проверенное значение, а не исходное', () => {
    // Ловушка регресса: экранирование посчитали, но записали value.
    expect(body).toMatch(/values:\s*\[\[\s*safeValue\s*\]\]/);
    expect(body).not.toMatch(/values:\s*\[\[\s*value\s*\]\]/);
  });

  it('режим ввода остаётся USER_ENTERED — значит защита обязательна', () => {
    // Если однажды перейдут на RAW, экранирование станет ненужным, и этот
    // тест обязан упасть, чтобы решение было осознанным, а не побочным.
    expect(body).toContain("valueInputOption: 'USER_ENTERED'");
  });
});
