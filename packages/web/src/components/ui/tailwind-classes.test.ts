// ── Страж: классы, которые Tailwind третьей ветки молча не создаёт.
//
//    ПОВОД (найдено 19.08.2026 глазами, не тестом). В примитивах стояло
//    `duration-[var(--dur-fast)]` и `ease-[var(--ease-standard)]` — запись,
//    которая выглядит правильной и проходит и проверку типов, и все тесты
//    разметки. Сборщик стилей при этом писал в журнал:
//
//      warn - The class `duration-[var(--dur-fast)]` is ambiguous and
//             matches multiple utilities.
//
//    и НЕ создавал правило вовсе. Причина: `duration-` в третьей ветке
//    отвечает сразу за две вещи — длительность перехода и длительность
//    проявления; по значению `var(...)` сборщик не может решить, какая из
//    них имелась в виду, и в таком случае он не гадает, а пропускает.
//    То же с `ease-`.
//
//    Чем это плохо на деле: словарь движения продукта (три длительности и
//    две кривые) не доезжал до браузера ни в одном месте. Все переходы шли
//    умолчанием Tailwind — 150 миллисекунд и своя кривая. Ошибка не видна
//    ни на экране (переход есть, просто чужой), ни в тестах разметки
//    (класс в строке классов присутствует), ни в проверке типов. Ровно тот
//    случай, ради которого харнесс требует смотреть результат глазами.
//
//    ЛЕЧЕНИЕ: запись через произвольное свойство, у которой двусмысленности
//    нет по устройству:
//      было:  duration-[var(--dur-fast)]  ease-[var(--ease-standard)]
//      стало: [transition-duration:var(--dur-fast)]
//             [transition-timing-function:var(--ease-standard)]
//
//    Этот страж не даёт записи вернуться. Он читает исходники с диска, а не
//    проверяет разметку: ошибка живёт в тексте класса, а не в поведении
//    компонента, и поймать её можно только чтением.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..');

/**
 * Файлы, о которых известно и которые правит другая волна.
 *
 * Перечень обязан только сокращаться. Новая запись сюда — это не
 * исключение, а долг: класс не создаётся, движение идёт умолчанием.
 */
const KNOWN_DEBT: readonly string[] = [
  // Занят волной «Контроль»; правка передана координатору 19.08.2026.
  'pages/Quality.tsx',
];

/** Двусмысленные записи, которые сборщик стилей пропускает молча. */
const AMBIGUOUS: readonly { pattern: RegExp; instead: string }[] = [
  {
    pattern: /\bduration-\[var\(--/,
    instead: '[transition-duration:var(--dur-…)]',
  },
  {
    pattern: /\bease-\[var\(--/,
    instead: '[transition-timing-function:var(--ease-…)]',
  },
];

function collectSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSources(full, found);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

describe('Классы, которые Tailwind третьей ветки не создаёт', () => {
  it('в разметке нет двусмысленных записей длительности и кривой', () => {
    const offenders: string[] = [];

    for (const file of collectSources(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (KNOWN_DEBT.includes(rel)) continue;
      const text = readFileSync(file, 'utf8');
      for (const { pattern, instead } of AMBIGUOUS) {
        if (pattern.test(text)) {
          offenders.push(`${rel}: запись пропускается сборщиком, вместо неё — ${instead}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('в разметке нет тёмного фона без светлой пары', () => {
    // Тот же класс ошибки, что и в CSS, но живущий в разметке.
    //
    // Разбирается СТРОКА КЛАССОВ целиком, а не строка файла: светлый
    // и тёмный классы сплошь и рядом стоят на разных строках, и построчная
    // проверка даёт сотни ложных срабатываний (проверено: 591 против 0).
    // Комментарии выбрасываются: объяснение «было так-то» цитирует старый
    // класс и иначе само себя обвиняет.
    const offenders: string[] = [];
    for (const file of collectSources(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (KNOWN_DEBT.includes(rel)) continue;
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const [, single, double, backtick] of text.matchAll(
        /'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g,
      )) {
        const classes = single ?? double ?? backtick ?? '';
        if (!classes.includes('dark:bg-')) continue;
        // Маскируем тёмные, чтобы они не считались своей же парой.
        const masked = classes.replace(/dark:bg-/g, 'dark:XX-');
        if (!/(?<![\w:])bg-/.test(masked)) {
          offenders.push(`${rel}: ${classes.trim().slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('перечень известного долга только сокращается', () => {
    // Число зафиксировано намеренно: рост перечня — это молча сломанное
    // движение, и он обязан быть замечен ревью, а не проехать мимо.
    expect(KNOWN_DEBT.length).toBeLessThanOrEqual(1);
  });
});

describe('Фон, объявлённый только для тёмной темы', () => {
  // ПОВОД (замечено владельцем 19.08.2026): в тёмной теме у полосы
  // организаций, чипов, сегментов и подсказок есть подложки, а в светлой их
  // нет. Причина класса: тема писалась от тёмной, светлая добавлялась позже,
  // и правило формулировалось как «поверх светлого — тёмное», а базовый светлый
  // фон подразумевался сам собой.
  //
  // Правило: фон объявляется ОДИН раз и получает значение в обеих темах
  // через роль. Если в светлой теме фона по замыслу быть не должно — пишется
  // явное `transparent`, потому что молчание и решение выглядят одинаково.

  /** Правила CSS без комментариев: комментарий перед селектором прилипает
      к нему и даёт ложные срабатывания — на этом уже обожглись при замере. */
  function backgroundRules(): { dark: Set<string>; light: Set<string> } {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const hasBackground = /(?<![-\w])background(-color|-image)?\s*:|@apply[^;]*\bbg-/i;
    const dark = new Set<string>();
    const light = new Set<string>();
    for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const whole = selector.trim().split(/\s+/).join(' ');
      if (!whole || whole.startsWith('@') || !hasBackground.test(body)) continue;
      for (const part of whole.split(',')) {
        const one = part.trim();
        if (!one || one.startsWith('@')) continue;
        if (one.startsWith('.dark ')) dark.add(one.slice(6).trim());
        else light.add(one);
      }
    }
    return { dark, light };
  }

  it('каждому тёмному фону есть светлая пара', () => {
    const { dark, light } = backgroundRules();
    const orphans = [...dark].filter((selector) => !light.has(selector)).sort();
    expect(orphans).toEqual([]);
  });

  it('замер вообще что-то находит — иначе страж проверяет пустоту', () => {
    // Без этой проверки сломанный разбор дал бы пустой список и вечно зелёный
    // тест — самая тихая из возможных поломок стража.
    const { dark, light } = backgroundRules();
    expect(dark.size).toBeGreaterThan(30);
    expect(light.size).toBeGreaterThan(30);
  });
});
