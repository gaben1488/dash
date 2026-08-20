/**
 * Страж двери к строкам-основаниям.
 *
 * Главное обещание: ключи словаря не расходятся с местами показа. Проверяется
 * с двух сторон — у каждой карточки доводки есть либо дверь, либо названная
 * причина её отсутствия; и наоборот, дверь не заведена для ключа, которого в
 * базе знаний нет (такая дверь никогда не откроется и врёт о покрытии).
 */
import { describe, expect, it } from 'vitest';
import { KB_UPLIFT, METRIC_KB } from '@aemr/core';
import { DISCIPLINE_ACTIONS } from '../../components/discipline/actions';
import { doorKeys, noDoorKeys, noDoorReason, rowsDoorFor } from './rows-door';

describe('дверь к строкам-основаниям', () => {
  it('у каждой карточки доводки есть дверь либо названная причина её отсутствия', () => {
    const silent: string[] = [];
    for (const key of Object.keys(KB_UPLIFT)) {
      if (!rowsDoorFor(key) && !noDoorReason(key)) silent.push(key);
    }
    expect(silent).toEqual([]);
  });

  it('дверь не заведена для ключа, которого нет в базе знаний', () => {
    const orphans = [...doorKeys(), ...noDoorKeys()].filter((k) => !METRIC_KB[k]);
    expect(orphans).toEqual([]);
  });

  it('ни одна дверь не ведёт «куда-нибудь»: подпись и страница заполнены', () => {
    for (const key of doorKeys()) {
      const door = rowsDoorFor(key);
      expect(door, key).toBeTruthy();
      expect(door!.label.trim().length, `${key}: пустая подпись`).toBeGreaterThan(0);
      expect(door!.page.length, `${key}: пустая страница`).toBeGreaterThan(0);
    }
  });

  it('причина отсутствия двери названа словами, а не пустотой', () => {
    for (const key of noDoorKeys()) {
      expect(noDoorReason(key)!.trim().length, key).toBeGreaterThan(20);
    }
  });

  it('признаки строк в дверях существуют на самом деле', () => {
    const known = new Set(DISCIPLINE_ACTIONS.map((d) => d.signal));
    const unknown: string[] = [];
    for (const key of doorKeys()) {
      for (const signal of rowsDoorFor(key)?.signals ?? []) {
        if (!known.has(signal)) unknown.push(`${key}: ${signal}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('неизвестный ключ двери не получает — молча и без выдумки', () => {
    expect(rowsDoorFor('нет_такого_ключа')).toBeNull();
    expect(noDoorReason('нет_такого_ключа')).toBeNull();
  });
});
