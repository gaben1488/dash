/**
 * Страж СЛЕПКА канона оформления (`metadata-canon.ts`).
 *
 * Слепок — переписанные в сервер числа из `scripts/etalon-sync/canon.cjs`.
 * Переписаны они не от лени: каталога `scripts/` в образе службы нет вовсе
 * (deploy/Dockerfile.server копирует только три пакета), и прямой импорт
 * канона собрался бы у разработчика и упал бы на проде.
 *
 * Цена переписывания — риск разъехаться. Его и снимает этот страж: он требует
 * настоящий `canon.cjs` и сверяет КАЖДОЕ число слепка с оригиналом. Правка
 * канона без правки слепка падает здесь, а не молчит месяцами, выдавая дрейф
 * оформления за норму (или норму за дрейф).
 *
 * КАК ЧИНИТЬ ПАДЕНИЕ: посмотреть на числа в сообщении теста, вписать новые в
 * `metadata-canon.ts`, обновить `syncedAt`. Считать руками ничего не нужно.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { METADATA_CANON } from './metadata-canon.js';

interface CanonModule {
  goldenCF: (sheetId: number, opts?: { visualOnly?: boolean }) => unknown[];
  goldenProtections: (
    sheetId: number,
    editors: string[],
    opts?: { keepAD?: boolean },
  ) => Array<{ description: string; range: { startColumnIndex?: number; endColumnIndex?: number } }>;
  goldenValidation: (grbsValue: string | null) => Record<string, unknown>;
}

function loadCanon(): CanonModule {
  const require_ = createRequire(import.meta.url);
  return require_('../../../../scripts/etalon-sync/canon.cjs') as CanonModule;
}

describe('слепок канона оформления', () => {
  it('число правил условного форматирования совпадает с каноном', () => {
    const canon = loadCanon();
    expect(METADATA_CANON.conditionalFormatRules.full).toBe(canon.goldenCF(0).length);
    expect(METADATA_CANON.conditionalFormatRules.visualOnly).toBe(
      canon.goldenCF(0, { visualOnly: true }).length,
    );
  }, 30_000);

  it('формульные группы совпадают с защитами канона', () => {
    const canon = loadCanon();
    const letterToColumn = (letter: string): number => {
      let n = 0;
      for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
      return n - 1;
    };
    const fromCanon = canon
      .goldenProtections(0, ['a@b.c'])
      .filter((p) => p.description.startsWith('Формульн'))
      .map((p) => [p.range.startColumnIndex, p.range.endColumnIndex]);
    const fromSnapshot = METADATA_CANON.protectedColumnGroups.map((g) => [
      letterToColumn(g.from),
      letterToColumn(g.to) + 1,
    ]);
    expect(fromSnapshot).toEqual(fromCanon);
  }, 30_000);

  it('перечни колонок проверки данных совпадают с каноном', () => {
    const canon = loadCanon();
    // Имя ГРБС передаётся непустым: у колонки B проверка данных появляется
    // только вместе с именем управления (`B: grbsValue ? listOf(...) : null`),
    // а в живой книге оно есть всегда.
    const validation = canon.goldenValidation('УО АЕМР') as Record<string, unknown> & {
      _clear: string[];
    };
    const required = Object.keys(validation).filter(
      (key) => key !== '_clear' && validation[key] !== null,
    );
    expect([...METADATA_CANON.validationColumns]).toEqual(required);
    expect([...METADATA_CANON.validationCleared]).toEqual(validation._clear);
  }, 30_000);
});
