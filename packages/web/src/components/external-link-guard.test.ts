/**
 * Страж внешних переходов.
 *
 * Реестр безопасности 05.06.2026, раздел LOW: кнопки «открыть ячейку в
 * Google-таблице» звали `window.open(url, '_blank')` без третьего довода.
 * Открытая так страница получает ссылку на окно продукта через `window.opener`
 * и может увести читателя с его же вкладки на подделку — а ключ доступа
 * продукт хранит в хранилище браузера, то есть цена подделки высока.
 *
 * Тест ищет по всему исходнику веба, а не только по трём известным местам:
 * следующая такая кнопка должна упасть здесь, а не остаться незамеченной.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Корень исходников веба: путь этого файла — web/src/components. */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.vite']);

function sources(dir: string = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe('переход во внешнюю вкладку', () => {
  it('каждый window.open отвязывает открытую страницу от окна продукта', () => {
    const offenders: string[] = [];

    for (const file of sources()) {
      const text = readFileSync(file, 'utf-8');
      // Довод с настройками окна — третий; берём вызов до конца строки.
      for (const line of text.split(/\r?\n/)) {
        if (!line.includes('window.open(')) continue;
        if (line.includes('noopener') && line.includes('noreferrer')) continue;
        offenders.push(`${relative(SRC, file)}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
