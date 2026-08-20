/**
 * Страж сравнения ключей за постоянное время.
 *
 * Реестр безопасности 05.06.2026, раздел LOW: в сравнении стоял ранний выход
 * по длине (`if (a.length !== b.length) return false`). Подбирающий ключ мог
 * измерять время ответа и узнать длину настоящего ключа, не зная ни одного его
 * знака, — а с известной длиной перебор становится осмысленным.
 *
 * Тест держит две вещи разом: поведение (чужой ключ отвергнут, свой принят,
 * ключ другой длины не роняет сервер) и отсутствие самого раннего выхода в
 * исходнике — иначе правку легко откатить, не уронив ни одной проверки.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { safeCompare } from './auth.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Исходник без комментариев. Запрет касается ИСПОЛНЯЕМОГО кода: строчные и
 * блочные пояснения вырезаются, чтобы цитата убранного приёма в объяснении
 * рядом с ним не выдавалась за сам приём.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('сравнение ключей доступа', () => {
  it('принимает совпадающий ключ и отвергает любой другой', () => {
    expect(safeCompare('secret-key', 'secret-key')).toBe(true);
    expect(safeCompare('secret-key', 'secret-kex')).toBe(false);
    expect(safeCompare('', '')).toBe(true);
  });

  it('не роняется на ключах разной длины — сравнение идёт по свёрткам', () => {
    // Прямой timingSafeEqual на буферах разной длины бросает исключение:
    // убрать ранний выход по длине и оставить сравнение сырых строк нельзя.
    expect(() => safeCompare('короткий', 'заметно-длиннее-настоящего')).not.toThrow();
    expect(safeCompare('короткий', 'заметно-длиннее-настоящего')).toBe(false);
    expect(safeCompare('a'.repeat(1000), 'a'.repeat(999))).toBe(false);
  });

  it('в исходнике нет раннего выхода по длине', () => {
    const source = readFileSync(join(HERE, 'auth.ts'), 'utf-8');
    // Пояснение над `safeCompare` называет убранный приём дословно — и страж
    // ловил собственное объяснение, требуя выкинуть из файла рассказ о том,
    // почему так делать нельзя. Смотрим на код, прозу не трогаем.
    expect(stripComments(source)).not.toMatch(/a\.length\s*!==\s*b\.length/);
    expect(source).toContain('createHash');
  });
});
