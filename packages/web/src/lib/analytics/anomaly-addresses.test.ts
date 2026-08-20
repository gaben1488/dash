import { describe, it, expect } from 'vitest';
import {
  selectSeasonalFindings,
  selectSplittingFindings,
  outlierRule,
  groupFindingsBySubordinate,
} from './anomaly-addresses';

const analyses = {
  uo: {
    seasonalAnomalies: [
      {
        type: 'DECEMBER_RUSH_CONTRACT',
        severity: 'medium',
        rowIndex: 41,
        description: 'Контракт заключён за 3 дн. в декабре (план→факт < 15 дн.)',
        details: { description: 'Поставка бумаги', subordinate: 'МБОУ СОШ №1' },
      },
      {
        type: 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS',
        severity: 'critical',
        rowIndex: 12,
        description: 'Ремонт образовательного учреждения в учебный период (03.10.2026)',
        details: { description: 'Ремонт кровли', subordinate: '' },
      },
      {
        type: 'Q4_SPENDING_SPIKE',
        severity: 'high',
        rowIndex: -1,
        description: '52% контрактов заключены в IV квартале (порог 40%)',
        details: { q4Share: 0.52 },
      },
    ],
    suspiciousSplitting: [
      { groupKey: 'МБОУ СОШ №1', rowIndices: [30, 8, 19], commonSubject: 'канцтовары', totalAmount: 900, count: 3 },
      { groupKey: '_org', rowIndices: [5, 6, 7], commonSubject: 'мебель', totalAmount: 1500, count: 3 },
    ],
  },
};

describe('адреса сезонных находок (п.119)', () => {
  it('номер строки книги = индекс листа + 1, шапка не теряется', () => {
    const rows = selectSeasonalFindings(analyses, 'uo');
    const school = rows.find((r) => r.type === 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS');
    expect(school?.sheetRow).toBe(13);
    const december = rows.find((r) => r.type === 'DECEMBER_RUSH_CONTRACT');
    expect(december?.sheetRow).toBe(42);
  });

  it('признак по всей книге приходит без строки, а не с выдуманной', () => {
    const spike = selectSeasonalFindings(analyses, 'uo').find((r) => r.type === 'Q4_SPENDING_SPIKE');
    expect(spike?.sheetRow).toBeNull();
    expect(spike?.why).toContain('IV квартале');
  });

  it('сначала то, что смотреть первым', () => {
    const rows = selectSeasonalFindings(analyses, 'uo');
    expect(rows[0].severity).toBe('critical');
    expect(rows[0].urgency).toBe('смотреть первым');
  });

  it('пустая колонка организации читается как аппарат управления', () => {
    const school = selectSeasonalFindings(analyses, 'uo').find((r) => r.type === 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS');
    expect(school?.subordinate).toBe('Аппарат управления');
  });

  it('управления без разбора и мусор в снимке дают пустой список, а не падение', () => {
    expect(selectSeasonalFindings(analyses, 'uer')).toEqual([]);
    expect(selectSeasonalFindings({ uo: { seasonalAnomalies: 'нет' } }, 'uo')).toEqual([]);
    expect(selectSeasonalFindings(null, 'uo')).toEqual([]);
  });
});

describe('адреса групп дробления', () => {
  it('строки группы пронумерованы по книге и упорядочены', () => {
    const groups = selectSplittingFindings(analyses, 'uo');
    const school = groups.find((g) => g.subordinate === 'МБОУ СОШ №1');
    expect(school?.sheetRows).toEqual([9, 20, 31]);
  });

  it('крупная группа идёт первой, ключ аппарата спрятан за подписью', () => {
    const groups = selectSplittingFindings(analyses, 'uo');
    expect(groups[0].subordinate).toBe('Аппарат управления');
    expect(groups[0].totalAmount).toBe(1500);
  });
});

describe('правило выброса вместо выдуманного адреса', () => {
  it('порог = типичная сумма плюс N разбросов', () => {
    const rule = outlierRule({ outlierCount: 4, outlierMean: 100, outlierStdDev: 50, outlierThreshold: 3 });
    expect(rule.thresholdAmount).toBe(250);
    expect(rule.text).toContain('250');
  });

  it('без параметров расчёта порог не придумывается', () => {
    const rule = outlierRule({ outlierCount: 4, outlierMean: null, outlierStdDev: null, outlierThreshold: null });
    expect(rule.thresholdAmount).toBeNull();
    expect(rule.text).toContain('не сохранил');
  });

  it('нулевой счёт объясняется словами, а не пустотой', () => {
    expect(outlierRule({ outlierCount: 0, outlierMean: 1, outlierStdDev: 1, outlierThreshold: 3 }).text)
      .toContain('Выбросов нет');
  });
});

describe('разбивка находок по организациям', () => {
  it('аппарат первым, дальше по алфавиту', () => {
    const groups = groupFindingsBySubordinate(selectSeasonalFindings(analyses, 'uo'));
    expect(groups.map((g) => g.label)).toEqual(['Аппарат управления', 'МБОУ СОШ №1']);
  });
});
