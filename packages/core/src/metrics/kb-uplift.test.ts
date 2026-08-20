/**
 * Стражи доводки базы знаний.
 *
 * Первый страж отвечает за обещание карточки 2.0: у каждой НОВОЙ карточки
 * заполнены механизм, формула, источник, скоуп и действие. Карточка с пустым
 * разделом обещает объяснение и не даёт его — это хуже её отсутствия.
 *
 * Второй страж бережёт вливание: заплатка к существующему ключу не должна
 * стирать поля, которых сама не несёт.
 */
import { describe, expect, it } from 'vitest';
import { KB_UPLIFT, applyKbUplift, type KbUpliftEntry } from './kb-uplift.js';
import { METRIC_KB } from './registry.js';
import type { KBEntryData } from './types.js';

/** Ключи, которых в реестре до вливания не было, — с них спрос полный. */
function isNewCard(key: string): boolean {
  return !PRE_EXISTING.has(key);
}

// Реестр на момент чтения этого файла уже влит, поэтому «был ли ключ раньше»
// определяется списком заплаток: заплатка объявляется явно, чтобы страж не
// путал дописанное с новым.
const PATCH_KEYS: readonly string[] = [
  'trust_overall',
  'plan_count', 'fact_count', 'plan_total', 'fact_total',
  'deviation', 'amount_deviation', 'execution_pct', 'exec_count_pct', 'economy_total',
];
const PRE_EXISTING = new Set(PATCH_KEYS);

describe('доводка базы знаний до карточки 2.0', () => {
  it('у каждой новой карточки заполнены механизм, скоуп и действие', () => {
    const holes: string[] = [];
    for (const [key, entry] of Object.entries(KB_UPLIFT)) {
      if (!isNewCard(key)) continue;
      const required: Array<[string, string | undefined]> = [
        ['механизм', entry.whatIs],
        ['как считается', entry.howCalc],
        ['источник', entry.dataSource],
        ['скоуп и момент', entry.scopeMoment],
        ['что делать', entry.actions],
        ['формула (краткая)', entry.formula],
        ['путь движка (краткий)', entry.source],
      ];
      for (const [name, value] of required) {
        if (!value || !value.trim()) holes.push(`${key}: пусто «${name}»`);
      }
    }
    expect(holes).toEqual([]);
  });

  it('ни одно заполненное поле не пусто на вид', () => {
    const blanks: string[] = [];
    for (const [key, entry] of Object.entries(KB_UPLIFT)) {
      for (const [field, value] of Object.entries(entry)) {
        if (typeof value === 'string' && value.trim() === '') blanks.push(`${key}.${field}`);
      }
    }
    expect(blanks).toEqual([]);
  });

  it('подпись карточки — по-русски, без внутренних ключей', () => {
    const latin: string[] = [];
    for (const [key, entry] of Object.entries(KB_UPLIFT)) {
      // Буквы грейда A–D — часть предметного языка продукта, не латиница
      // ключей: подпись «Грейд управления» их не содержит, а вот ключ вида
      // `scorecard_grade` в подписи был бы дефектом.
      if (/[a-z]{3,}/.test(entry.label)) latin.push(`${key}: ${entry.label}`);
    }
    expect(latin).toEqual([]);
  });

  it('заплатка ложится на существующую карточку, а не создаёт полупустую', () => {
    // Опечатка в ключе заплатки завела бы в реестре карточку из четырёх полей:
    // подпись, порог, скоуп и действие — без механизма и источника. Проверяем
    // по итогу вливания: у заплатанного ключа механизм и источник на месте, а
    // значит они пришли из базовой записи.
    for (const key of PATCH_KEYS) {
      const entry = METRIC_KB[key];
      expect(entry, `заплатка ${key} не нашла базовой карточки`).toBeTruthy();
      expect(entry?.whatIs, `${key}: механизм потерян`).toBeTruthy();
      expect(entry?.dataSource, `${key}: источник потерян`).toBeTruthy();
    }
  });

  it('после вливания у каждой карточки доводки есть скоуп и действие', () => {
    const holes: string[] = [];
    for (const key of Object.keys(KB_UPLIFT)) {
      const entry = METRIC_KB[key];
      if (!entry?.scopeMoment) holes.push(`${key}: нет скоупа`);
      if (!entry?.actions) holes.push(`${key}: нет действия`);
      if (!entry?.whatIs) holes.push(`${key}: нет механизма`);
    }
    expect(holes).toEqual([]);
  });

  it('карточки доводки доехали до общего реестра', () => {
    for (const key of Object.keys(KB_UPLIFT)) {
      expect(METRIC_KB[key], `ключ ${key} не влит в реестр`).toBeTruthy();
    }
  });

  it('заплатка не стирает полей существующей карточки', () => {
    const base: Record<string, KBEntryData> = {
      demo: {
        label: 'Демонстрационная',
        formula: 'было',
        source: 'было',
        unit: 'count',
        category: 'quality',
        whatIs: 'прежний механизм',
      },
    };
    const patch: Record<string, KbUpliftEntry> = {
      demo: { label: 'Демонстрационная', unit: 'count', category: 'quality', actions: 'новое действие' },
    };
    // Тот же проход вливания, но на своём словаре: подменять экспорт нельзя,
    // а проверить правило слияния нужно.
    for (const [key, p] of Object.entries(patch)) {
      base[key] = { ...(base[key] ?? {}), ...p } as KBEntryData;
    }
    expect(base.demo.whatIs).toBe('прежний механизм');
    expect(base.demo.formula).toBe('было');
    expect(base.demo.actions).toBe('новое действие');
  });

  it('вливание идемпотентно: повторный проход ничего не портит', () => {
    const before = JSON.stringify(METRIC_KB.scorecard_grade);
    applyKbUplift(METRIC_KB);
    expect(JSON.stringify(METRIC_KB.scorecard_grade)).toBe(before);
  });
});
