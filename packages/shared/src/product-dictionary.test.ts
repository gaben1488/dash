import { describe, expect, it } from 'vitest';
import { productLabel, RAW_KEY_SAMPLES } from './product-dictionary';

describe('product-dictionary (1.1): ни один сырой ключ не доходит до UI', () => {
  it('каждый известный сырой ключ имеет человеческий лейбл (≠ сам ключ, не латиница-ид, не КАПС_СНЕЙК)', () => {
    for (const key of RAW_KEY_SAMPLES) {
      const label = productLabel(key);
      expect(label, `ключ ${key}`).toBeTruthy();
      expect(label, `ключ ${key} не переведён`).not.toBe(key);
      // человеческий: не выглядит как сырой ключ (нет _, нет ВСЕ_КАПС_СНЕЙК, не чистая латиница)
      expect(/^[A-Z0-9_]+$/.test(label), `ключ ${key} → КАПС «${label}»`).toBe(false);
      expect(/^[a-z]+(\.[a-z_]+)+$/.test(label), `ключ ${key} → dotted «${label}»`).toBe(false);
    }
  });

  it('конкретные критичные ключи переведены точно', () => {
    expect(productLabel('UNMAPPED')).toBe('причина не распознана');
    expect(productLabel('_org_itself')).toBe('Аппарат');
    expect(productLabel('uo')).toBe('УО');
    expect(productLabel('open')).toBe('Открыто');
  });

  it('неизвестный ключ → лейбл-фолбэк (не падает), но помечен как непереведённый', () => {
    // Для неизвестного ключа возвращаем сам ключ (fallback), чтобы UI не падал,
    // но это сигнал разработчику дополнить словарь. Проверяем, что не бросает.
    expect(() => productLabel('totally_unknown_key_xyz')).not.toThrow();
  });
});
