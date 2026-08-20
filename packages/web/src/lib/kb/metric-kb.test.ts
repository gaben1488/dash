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

  // Записи без блока «откуда данные» попап не открывают: рассказывать о
  // показателе, не умея назвать источник, — та же ложная уверенность, что и
  // пустой попап. После закрытия Д13 (08.08) таких записей осталось две —
  // ранг управления и его название: у них нет собственного источника, они
  // производные от порядка сортировки и реестра.
  it('запись без источника данных (dept_rank) → null', () => {
    expect(kbFor('dept_rank')).toBeNull();
  });

  it('после Д13 у бывших legacy-записей попап живёт', () => {
    // amount_deviation была главным примером «есть формула, нет объяснения».
    const card = kbFor('amount_deviation');
    expect(card).not.toBeNull();
    expect(card!.what.length).toBeGreaterThan(20);
    expect(card!.source.length).toBeGreaterThan(10);
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

describe('kbFor — поля карточки 2.0', () => {
  it('скоуп, расхождение, порог и действие доезжают до попапа', () => {
    const card = kbFor('scorecard_grade');
    expect(card).not.toBeNull();
    expect(card!.scope!.length).toBeGreaterThan(20);
    expect(card!.divergence!.length).toBeGreaterThan(20);
    expect(card!.thresholds).toContain('A');
    expect(card!.actions!.length).toBeGreaterThan(20);
  });

  it('запись без новых полей их и не отдаёт — пустых разделов не бывает', () => {
    // Ключ намеренно взят из тех, кого доводка не касалась.
    const card = kbFor('signal_high_economy');
    expect(card).not.toBeNull();
    expect(card!.scope).toBeUndefined();
    expect(card!.divergence).toBeUndefined();
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
