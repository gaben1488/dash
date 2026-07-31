/**
 * kbFor — мост METRIC_KB → «БЗ по наведению».
 * Рендер-тестов в харнесе нет (node env) — проверяем данные и контракт.
 */
import { describe, it, expect } from 'vitest';
import { METRIC_KB } from '@aemr/core';
import { kbFor } from './metric-kb';

describe('kbFor — известный ключ с полной записью', () => {
  it('exec_count_pct отдаёт четыре непустых поля', () => {
    const kb = kbFor('exec_count_pct');
    expect(kb).not.toBeNull();
    expect(kb!.what.length).toBeGreaterThan(0);
    expect(kb!.how.length).toBeGreaterThan(0);
    expect(kb!.source.length).toBeGreaterThan(0);
    expect(kb!.pitfalls).toBeDefined();
    expect(kb!.pitfalls!.length).toBeGreaterThan(0);
  });

  it('пример приклеен к «как считается» через перенос строки', () => {
    const kb = kbFor('exec_count_pct')!;
    expect(kb.how).toContain('\n');
    expect(kb.how).toContain(METRIC_KB.exec_count_pct.example!);
  });
});

describe('kbFor — null вместо пустого попапа', () => {
  it('неизвестный ключ → null', () => {
    expect(kbFor('__nonexistent__')).toBeNull();
  });

  it('legacy-запись без человекочитаемых блоков (amount_deviation) → null', () => {
    expect(kbFor('amount_deviation')).toBeNull();
  });

  it('метрики плиток отчёта покрыты полной БЗ — попап обязан жить', () => {
    const tileKeys = [
      'plan_count', 'fact_count', 'exec_count_pct', 'comp_exec_count_pct',
      'ep_exec_count_pct', 'plan_total', 'fact_total', 'economy_total',
      'competitive_count', 'comp_fact_count', 'ep_count', 'ep_fact_count',
      'pending_count', 'pending_total',
    ];
    for (const key of tileKeys) {
      expect(kbFor(key), key).not.toBeNull();
    }
  });
});

describe('kbFor — тексты для людей, не для разработчиков', () => {
  it('«Что это» всюду по-русски; внутренний ключ exec_count_pct не светится', () => {
    let covered = 0;
    for (const key of Object.keys(METRIC_KB)) {
      const kb = kbFor(key);
      if (!kb) continue;
      covered += 1;
      expect(kb.what, key).toMatch(/[А-Яа-яЁё]/);
      const visible = [kb.what, kb.how, kb.source, kb.pitfalls ?? ''].join(' ');
      expect(visible, key).not.toContain('exec_count_pct');
    }
    // Петля не должна быть вакуумной: полных записей в БЗ больше одной.
    expect(covered).toBeGreaterThan(1);
  });
});
