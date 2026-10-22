// ── Стражи механизма «один дом порога».
//
//    Проверяется не «пороги хорошие», а проверяемое: у каждого порога есть
//    смысл и источник, наше решение названо нашим и объяснено, число из
//    реестра совпадает с числом из константы, а одна величина не носит двух
//    порогов в одной области.

import { describe, expect, it } from 'vitest';
import {
  LAW_44FZ_THRESHOLDS,
  THRESHOLDS,
} from './constants.js';
import {
  THRESHOLD_IDS,
  THRESHOLD_REGISTRY,
  formatThreshold,
  ownThresholds,
  threshold,
  thresholdValue,
  thresholdAt,
  freezeThresholds,
  legalThresholdsVerifiedForContext,
  capturedThresholdValue,
  INTERNAL_EP_SHARE_BY_ROLE,
  EP_ROLE_THRESHOLD_IDS,
  thresholdsByDomain,
  thresholdsBySource,
} from './threshold-registry.js';

describe('каждый порог имеет смысл и источник', () => {
  it('смысл записан фразой, а не отговоркой', () => {
    for (const id of THRESHOLD_IDS) {
      const entry = THRESHOLD_REGISTRY[id]!;
      expect(entry.means.length, `${id}: смысл слишком короток`).toBeGreaterThan(20);
      // Фраза, а не ярлык: смысл обязан быть предложением с точкой.
      expect(entry.means.trim().endsWith('.'), `${id}: смысл не предложение`).toBe(true);
    }
  });

  it('имя порога читаемо человеком', () => {
    for (const id of THRESHOLD_IDS) {
      const entry = THRESHOLD_REGISTRY[id]!;
      expect(entry.label.length, `${id}: имя пустое`).toBeGreaterThan(5);
      // Кириллица: имя для разговора, а не технический ключ.
      expect(/[А-Яа-я]/.test(entry.label), `${id}: имя не по-русски`).toBe(true);
    }
  });

  it('значение — конечное число, а не «примерно»', () => {
    for (const id of THRESHOLD_IDS) {
      const entry = THRESHOLD_REGISTRY[id]!;
      expect(Number.isFinite(entry.value), `${id}: значение не число`).toBe(true);
      expect(entry.value, `${id}: отрицательный порог`).toBeGreaterThan(0);
    }
  });

  it('единица соответствует значению: доля не больше единицы, процент не больше ста', () => {
    for (const id of THRESHOLD_IDS) {
      const entry = THRESHOLD_REGISTRY[id]!;
      if (entry.unit === 'ratio') {
        expect(entry.value, `${id}: доля вне 0..1`).toBeLessThanOrEqual(1);
      }
      if (entry.unit === 'percent') {
        expect(entry.value, `${id}: процент выше ста`).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('наше решение названо нашим и объяснено', () => {
  it('порог с источником own несёт обоснование', () => {
    for (const id of ownThresholds()) {
      const entry = THRESHOLD_REGISTRY[id]!;
      expect(entry.note, `${id}: наше решение молчит об основании`).toBeTruthy();
      expect(entry.note!.length, `${id}: обоснование слишком короткое`).toBeGreaterThan(40);
    }
  });

  it('порог из закона указывает статью', () => {
    for (const id of thresholdsBySource('law44')) {
      const entry = THRESHOLD_REGISTRY[id]!;
      expect(entry.sourceRef, `${id}: закон без адреса статьи`).toBeTruthy();
      expect(/44-ФЗ|ст\.|Предел/.test(entry.sourceRef!), `${id}: адрес не похож на норму`).toBe(true);
    }
  });

  it('реестр знает пороги без родословной и не прячет их', () => {
    // Список нужен ровно затем, чтобы владелец видел, сколько чисел продукт
    // придумал сам. Пустым он быть не обязан — молчащим не имеет права.
    expect(ownThresholds().length).toBeGreaterThan(0);
    expect(ownThresholds()).toContain('issues.criticalAlarmCount');
    expect(ownThresholds()).toContain('competition.epShareNormMaxPct');
  });
});

describe('один дом числа: реестр не заводит вторую копию', () => {
  it('пороги доверия равны константам', () => {
    expect(thresholdValue('trust.gradeA')).toBe(THRESHOLDS.TRUST.A);
    expect(thresholdValue('trust.gradeB')).toBe(THRESHOLDS.TRUST.B);
    expect(thresholdValue('trust.gradeC')).toBe(THRESHOLDS.TRUST.C);
    expect(thresholdValue('trust.gradeD')).toBe(THRESHOLDS.TRUST.D);
  });

  it('допуск сверки равен константе', () => {
    expect(thresholdValue('recon.tolerancePct')).toBe(THRESHOLDS.DELTA.TOLERANCE_PERCENT);
  });

  it('антидемпинговый порог — та же четверть, что в нормах закона', () => {
    expect(thresholdValue('economy.highSharePct')).toBe(
      LAW_44FZ_THRESHOLDS.antiDumpingSavingsShare * 100,
    );
  });

  it('денежные пределы закона равны константам', () => {
    expect(thresholdValue('law.epSmallSingleContract')).toBe(
      LAW_44FZ_THRESHOLDS.epSmallPurchaseSingleContractLimitThousandRub,
    );
    expect(thresholdValue('law.quotationPurchaseLimit')).toBe(
      LAW_44FZ_THRESHOLDS.quotationPurchaseLimitThousandRub,
    );
  });

  it('порог исполнения по управлению совпадает с тем, что красит вкладку «Свод»', () => {
    // THRESHOLDS.EXECUTION ведётся долей, реестр — процентом.
    expect(thresholdValue('execution.deptGood')).toBe(THRESHOLDS.EXECUTION.GOOD * 100);
    expect(thresholdValue('execution.deptMid')).toBe(THRESHOLDS.EXECUTION.WARNING * 100);
    expect(thresholdValue('execution.watch')).toBe(THRESHOLDS.EXECUTION.CRITICAL * 100);
  });
});

describe('одна величина — один порог', () => {
  it('в одной области нет двух наших порогов с одним значением и одной единицей', () => {
    // Норм закона правило не касается намеренно. Закон повторяет одно и то же
    // число под разными основаниями сам: разовый предел мелкой закупки (ст.93
    // ч.1 п.4) и разовый предел закупки образования и культуры (п.5) равны
    // шестистам тысячам, и свести их в одну запись значило бы утверждать, что
    // основание одно. Там повторяется закон, а не мы. Правило стережёт ровно
    // наш произвол: две придуманные черты для одной величины.
    const seen = new Map<string, string>();
    for (const id of THRESHOLD_IDS) {
      const entry = THRESHOLD_REGISTRY[id]!;
      if (entry.source === 'law44') continue;
      const key = `${entry.domain}|${entry.value}|${entry.unit}`;
      const twin = seen.get(key);
      expect(twin, `${id} и ${twin}: одно число дважды в области «${entry.domain}»`).toBeUndefined();
      seen.set(key, id);
    }
  });

  it('имя порога называет область, к которой он относится', () => {
    for (const id of THRESHOLD_IDS) {
      expect(id.includes('.'), `${id}: имя без области`).toBe(true);
    }
  });
});

describe('обращение к реестру', () => {
  it('неизвестное имя — ошибка на месте, а не тихий undefined', () => {
    expect(() => thresholdValue('нет.такого')).toThrow();
    expect(threshold('нет.такого')).toBeUndefined();
  });

  it('область собирает свои пороги', () => {
    expect(thresholdsByDomain('execution')).toContain('execution.good');
    expect(thresholdsByDomain('law').length).toBeGreaterThan(5);
  });

  it('число печатается с единицей', () => {
    expect(formatThreshold('economy.highSharePct')).toBe('25 %');
    expect(formatThreshold('law.epSmallSingleContract')).toBe('600 тыс. руб.');
    // Доля закона печатается процентом — так её читает человек.
    expect(formatThreshold('law.epSmallAnnualShare')).toBe('10 %');
    expect(formatThreshold('нет.такого')).toBe('—');
  });
});


describe('dated threshold evidence', () => {
  it('uses 10m before October 2026 and 20m during the temporary 279-FZ interval (thousandRub)', () => {
    const september = thresholdAt('law.quotationPurchaseLimit', '2026-09-30');
    expect(september).toMatchObject({ value: 10_000, status: 'verified', edition: '44fz-quotation-2026-before-279fz' });
    const october = thresholdAt('law.quotationPurchaseLimit', '2026-10-01');
    expect(october).toMatchObject({ value: 20_000, status: 'verified', edition: '44fz-quotation-279fz-temporary' });
    expect(thresholdAt('law.quotationPurchaseLimit', '2027-12-31').value).toBe(20_000);
    expect(thresholdAt('law.quotationPurchaseLimit', '2028-01-01'))
      .toMatchObject({ value: 10_000, status: 'unverified', edition: null });
    expect(freezeThresholds('2026-10-22')['law.quotationPurchaseLimit'].value).toBe(20_000);
  });
  it('never promotes one verified quotation threshold to full legal coverage', () => {
    const captured = freezeThresholds('2026-10-22');
    expect(captured['law.quotationPurchaseLimit'].status).toBe('verified');
    expect(legalThresholdsVerifiedForContext(captured)).toBe(false);
    expect(legalThresholdsVerifiedForContext(null)).toBe(false);
    const pretendAll = Object.fromEntries(thresholdsByDomain('law').map(id => [id, {
      value: thresholdValue(id), unit: threshold(id)!.unit, status: 'verified' as const, edition: 'test', sourceRef: 'test',
    }]));
    expect(legalThresholdsVerifiedForContext(pretendAll)).toBe(true);
    delete pretendAll['law.quotationPurchaseLimit'];
    expect(legalThresholdsVerifiedForContext(pretendAll)).toBe(false);
  });
  it('does not treat an undated legal reference as a verified rule for a date', () => {
    expect(thresholdAt('law.epSmallSingleContract', '2026-10-21').status).toBe('unverified');
    expect(thresholdAt('economy.highSharePct', '2026-10-21').status).toBe('internal');
  });
  it('uses the frozen edition and effective interval without today settings', () => {
    const frozen = { ...threshold('law.epSmallSingleContract')!, editions: [
      { id: 'synthetic-old', validFrom: '2026-01-01', validUntil: '2026-07-01', value: 1,
        verification: 'verified' as const, sourceRef: 'synthetic fixture' },
      { id: 'synthetic-new', validFrom: '2026-07-01', value: 2,
        verification: 'verified' as const, sourceRef: 'synthetic fixture' },
    ] };
    expect(thresholdAt('law.epSmallSingleContract', '2026-06-30', frozen)).toMatchObject({ status: 'verified', value: 1, edition: 'synthetic-old' });
    expect(thresholdAt('law.epSmallSingleContract', '2026-07-01', frozen)).toMatchObject({ status: 'verified', value: 2, edition: 'synthetic-new' });
    expect(thresholdAt('law.epSmallSingleContract', '2025-12-31', frozen).status).toBe('unverified');
    expect(() => thresholdAt('law.epSmallSingleContract', 'invalid', frozen)).toThrow();
  });
  it('freezes source units and internal role-based references; legacy units are not guessed', () => {
    const snapshot = freezeThresholds('2026-10-22');
    for (const role of Object.keys(EP_ROLE_THRESHOLD_IDS) as Array<keyof typeof INTERNAL_EP_SHARE_BY_ROLE>) {
      const captured = snapshot[EP_ROLE_THRESHOLD_IDS[role]];
      expect(captured).toMatchObject({ unit: 'ratio', status: 'internal', value: INTERNAL_EP_SHARE_BY_ROLE[role] });
      expect(capturedThresholdValue(captured, 'ratio')).toBe(INTERNAL_EP_SHARE_BY_ROLE[role]);
      expect(capturedThresholdValue(captured, 'percent')).toBeNull();
      // Legacy payloads may lack a unit. Exercise that runtime shape without
      // inventing an explicit `undefined` field rejected by exactOptionalPropertyTypes.
      const legacy = { ...captured! };
      Reflect.deleteProperty(legacy, 'unit');
      expect(capturedThresholdValue(legacy, 'ratio')).toBeNull();
    }
    expect(legalThresholdsVerifiedForContext(Object.fromEntries(thresholdsByDomain('law').map(id => [id, {
      value: thresholdValue(id), status: 'verified' as const, edition: 'test', sourceRef: 'test',
    }])))).toBe(false);
  });

  it('prints a frozen quotation limit, never a current reference for an unspecified date', () => {
    const old = thresholdAt('law.quotationPurchaseLimit', '2026-09-30');
    const changed = thresholdAt('law.quotationPurchaseLimit', '2026-10-01');
    expect(formatThreshold('law.quotationPurchaseLimit')).toContain('нужна дата среза');
    expect(formatThreshold('law.quotationPurchaseLimit', old)).toBe('10000 тыс. руб.');
    expect(formatThreshold('law.quotationPurchaseLimit', changed)).toBe('20000 тыс. руб.');
    expect(formatThreshold('law.quotationPurchaseLimit', thresholdAt('law.quotationPurchaseLimit', '2028-01-01')))
      .toContain('не подтверждена');
    expect(formatThreshold('law.quotationPurchaseLimit', { ...old, unit: 'percent' })).toContain('недоступны');
  });

  it('rejects overlapping applicable editions rather than picking one', () => {
    const edition = { id: 'a', validFrom: '2026-01-01', value: 1,
      verification: 'verified' as const, sourceRef: 'synthetic fixture' };
    expect(() => thresholdAt('law.epSmallSingleContract', '2026-10-21', {
      ...threshold('law.epSmallSingleContract')!, editions: [edition, { ...edition, id: 'b' }],
    })).toThrow();
  });
});
