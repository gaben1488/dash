import { describe, expect, it } from 'vitest';
import { EP_REASON_CLUSTERS, canonicalizeReasonEp } from './dictionaries/ep-reason-clusters.js';
import {
  EP_GRADE_BY_CLUSTER,
  EP_GRADE_EXPLAIN,
  EP_GRADE_LABELS,
  epGradeOfCluster,
  epGradeTotals,
  futureFactDateSeverity,
} from './ep-justification-grade.js';

describe('обоснованность ЕП (канон п.98ж)', () => {
  it('каждый кластер словаря имеет степень — новый кластер без степени недопустим', () => {
    const missing = EP_REASON_CLUSTERS.filter((c) => !(c in EP_GRADE_BY_CLUSTER));
    expect(missing).toEqual([]);
  });

  it('negating monopoly does not produce the lawful-exclusive grade', () => {
    expect(epGradeOfCluster(canonicalizeReasonEp('не является монополистом').cluster).grade).toBe('unfounded');
  });
  it('the unknown grade does not assert a legal basis is absent', () => {
    expect(EP_GRADE_LABELS.unfounded).toBe('Основание не установлено');
    expect(EP_GRADE_EXPLAIN.unfounded).toContain('не доказывает отсутствия основания');
    expect(EP_GRADE_EXPLAIN.unfounded).not.toContain('нечем защитить');
  });
  it('монополист и авария — безальтернативны по закону', () => {
    expect(epGradeOfCluster('EP_MONOPOLIST').grade).toBe('lawful-exclusive');
    expect(epGradeOfCluster('EP_EMERGENCY').grade).toBe('lawful-exclusive');
    expect(epGradeOfCluster('EP_ROSGVARDIA').grade).toBe('lawful-exclusive');
  });

  it('категории руководства: КП в УЭР и наименьшая цена — подтверждённая выгода', () => {
    expect(epGradeOfCluster('EP_UER_APPROVED').grade).toBe('verified-benefit');
    expect(epGradeOfCluster('EP_QUOTES_LOWEST').grade).toBe('verified-benefit');
    expect(epGradeOfCluster('EP_CONCLUDE_LOWEST').grade).toBe('verified-benefit');
  });

  it('«нецелесообразно» и «срочно» — решение заказчика, а не основание', () => {
    expect(epGradeOfCluster('EP_NOT_WORTHWHILE').grade).toBe('discretionary');
    expect(epGradeOfCluster('EP_URGENCY').grade).toBe('discretionary');
  });

  it('пустая графа, нераспознанное и подмена процедуры — без обоснования', () => {
    expect(epGradeOfCluster('EMPTY').grade).toBe('unfounded');
    expect(epGradeOfCluster('UNMAPPED').grade).toBe('unfounded');
    expect(epGradeOfCluster('EP_SMALL_EL_PURCH').grade).toBe('unfounded');
    expect(epGradeOfCluster('EP_CURRENT_LAW').grade).toBe('unfounded');
  });

  it('незнакомый кластер не выдаётся за обоснованный', () => {
    const g = epGradeOfCluster('EP_НЕИЗВЕСТНО');
    expect(g.grade).toBe('unfounded');
    expect(g.evidence).toContain('не распознана');
  });

  it('свод: сокращаемым считается только усмотрение и пустота', () => {
    const t = epGradeTotals([
      { cluster: 'EP_MONOPOLIST', sum: 1000 },   // законно — не сократить
      { cluster: 'EP_UER_APPROVED', sum: 500 },  // выгода доказана — не сократить
      { cluster: 'EP_NOT_WORTHWHILE', sum: 300 },// решение заказчика — сократимо
      { cluster: 'EMPTY', sum: 200 },            // без обоснования — сократимо
    ]);
    expect(t.rows).toBe(4);
    expect(t.sum).toBe(2000);
    expect(t.reducibleSum).toBe(500);
    expect(t.reducibleShare).toBe(25);
    expect(t.byGrade['lawful-exclusive'].rows).toBe(1);
    expect(t.byGrade.unfounded.sum).toBe(200);
  });

  it('пустой свод не делит на ноль', () => {
    const t = epGradeTotals([]);
    expect(t.reducibleShare).toBeNull();
    expect(t.sum).toBe(0);
  });

  it('у каждой степени есть подпись и объяснение для экрана', () => {
    for (const grade of ['lawful-exclusive', 'verified-benefit', 'discretionary', 'unfounded'] as const) {
      expect(EP_GRADE_LABELS[grade].length).toBeGreaterThan(3);
      expect(EP_GRADE_EXPLAIN[grade].length).toBeGreaterThan(40);
    }
  });
});

describe('future date series calendar context uses authoritative N', () => {
  const row={dept:'УКСиМП',id:'3',subject:'Окорока (куриные)',method:'ЕП',factDateRaw:'15.06.2026',factSum:80,amountBasis:'position-total' as const,planYear:2026};
  it.each([undefined, '', 'not a date', '31.02.2026', '15.06.2027'])('does not trust stale P when N is %s', planDateRaw => {
    expect(futureFactDateSeverity({...row,planDateRaw})).toBe('significant');
  });
  it('uses N2026 despite stale P2027 without declaring the source mismatch valid', () => {
    expect(futureFactDateSeverity({...row,planDateRaw:'15.06.2026',planYear:2027})).toBe('info');
  });
});
