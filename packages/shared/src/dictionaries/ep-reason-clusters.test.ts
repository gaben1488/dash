/**
 * Канонизация обоснований ЕП: словарь обязан ловить РЕАЛЬНЫЕ формулировки ГРБС.
 *
 * Регрессия (профиль 8 ГРБС, 19.06.2026): кластер EP_NOT_WORTHWHILE создавался под
 * фразу «нецелесообразность проведения аукциона» (approx_count: 525), но его regex
 * `/нецеле(?:о|со)бразность/i` ловил только ОПЕЧАТКИ («нецелеобразность»,
 * «нецелесобразность») и промахивался мимо правильного написания — «нецелесообразность»
 * (с «соо»). 576 строк из 3614 уходили в UNMAPPED и порождали ложный сигнал
 * ep_reason (signals.ts:542) — 70% всей массы UNMAPPED.
 */
import { describe, it, expect } from 'vitest';
import { canonicalizeReasonEp } from './ep-reason-clusters.js';

const cluster = (s: unknown) => canonicalizeReasonEp(s).cluster;

describe('canonicalizeReasonEp — EP_NOT_WORTHWHILE', () => {
  it('ловит правильное написание — «нецелесообразность» (552 строки в проде)', () => {
    expect(cluster('нецелесообразность проведения аукциона')).toBe('EP_NOT_WORTHWHILE');
  });

  it('регистронезависим', () => {
    expect(cluster('Нецелесообразность проведения аукциона')).toBe('EP_NOT_WORTHWHILE');
  });

  it('ловит прилагательную форму', () => {
    expect(cluster('проведение аукциона нецелесообразно')).toBe('EP_NOT_WORTHWHILE');
  });

  it('по-прежнему ловит опечатки, ради которых regex и писался', () => {
    expect(cluster('нецелеобразность аукциона')).toBe('EP_NOT_WORTHWHILE');
    expect(cluster('нецелесобразность аукциона')).toBe('EP_NOT_WORTHWHILE');
  });
});

describe('canonicalizeReasonEp — границы', () => {
  it('пустые маркеры → EMPTY', () => {
    expect(cluster('')).toBe('EMPTY');
    expect(cluster('Х')).toBe('EMPTY');
    expect(cluster('—')).toBe('EMPTY');
    expect(cluster(null)).toBe('EMPTY');
  });

  it('монополист распознаётся', () => {
    expect(cluster('услуги монополиста')).toBe('EP_MONOPOLIST');
  });

  it('незнакомый свободный текст остаётся UNMAPPED, а не притягивается за уши', () => {
    expect(cluster('Заключение контракта с Издательством Просвещение')).toBe('UNMAPPED');
  });
});
