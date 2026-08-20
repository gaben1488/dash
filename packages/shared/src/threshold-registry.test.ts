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
