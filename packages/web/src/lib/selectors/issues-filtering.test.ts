import { describe, expect, it } from 'vitest';
import { filterIssues, issueAxesWithoutData, splitIssuesBySeverity } from './issues-filtering';

const noFilters = {
  hasDeptFilter: false,
  selectedDeptBothForms: new Set<string>(),
  selectedSubordinates: new Set<string>(),
  normalizedSearch: '',
  selectedActivities: new Set<string>(),
};

const issues = [
  { title: 'Просрочка контракта', description: 'шкаф', departmentId: 'uer', subordinateId: 'Школа №1', activityType: 'program', severity: 'critical' },
  { title: 'Расхождение сверки', description: '', departmentId: 'uio', severity: 'warning' },
  { title: 'Оргзамечание без привязки', description: '' }, // без departmentId/subordinateId/activityType
];

describe('filterIssues (извлечено из useFilteredData §4/§4b)', () => {
  it('фильтров нет — все проходят (та же ссылка)', () => {
    expect(filterIssues(issues, noFilters)).toBe(issues);
  });

  it('ГРБС: матч по любой форме ключа; без departmentId — проходит (Б5)', () => {
    const out = filterIssues(issues, {
      ...noFilters,
      hasDeptFilter: true,
      selectedDeptBothForms: new Set(['УЭР', 'uer']),
    });
    expect(out.map(i => i.title)).toEqual(['Просрочка контракта', 'Оргзамечание без привязки']);
  });

  it('подвед: issue без subordinateId проходит (орг-уровень), чужой подвед — нет', () => {
    const out = filterIssues(issues, { ...noFilters, selectedSubordinates: new Set(['Сад №2']) });
    expect(out.map(i => i.title)).toEqual(['Расхождение сверки', 'Оргзамечание без привязки']);
  });

  it('поиск по title/description/departmentId', () => {
    expect(filterIssues(issues, { ...noFilters, normalizedSearch: 'шкаф' })).toHaveLength(1);
    expect(filterIssues(issues, { ...noFilters, normalizedSearch: 'uio' })).toHaveLength(1);
    expect(filterIssues(issues, { ...noFilters, normalizedSearch: 'нет-такого' })).toHaveLength(0);
  });

  it('вид деятельности: issue без activityType проходит (СВОД-уровень)', () => {
    const out = filterIssues(issues, { ...noFilters, selectedActivities: new Set(['current_program']) });
    expect(out.map(i => i.title)).toEqual(['Расхождение сверки', 'Оргзамечание без привязки']);
  });
});

describe('issueAxesWithoutData (страж мёртвых осей Замечаний)', () => {
  it('на нынешней форме данных периода и способа нет — обе оси объявлены отсутствующими', () => {
    expect(issueAxesWithoutData(issues).map(a => a.id)).toEqual(['period', 'procurement']);
  });

  it('пустая выборка: осей нет — подпись «не применяется» остаётся честной', () => {
    expect(issueAxesWithoutData([]).map(a => a.id)).toEqual(['period', 'procurement']);
  });

  it('detectedAt не считается периодом: это время прогона конвейера, а не период данных', () => {
    const withDetectedAt = [{ title: 'x', detectedAt: '2026-08-07T00:00:00.000Z' }];
    expect(issueAxesWithoutData(withDetectedAt).map(a => a.id)).toContain('period');
  });

  it('появился способ в данных — ось перестаёт числиться отсутствующей', () => {
    const withMethod = [...issues, { title: 'ЕП сверх лимита', method: 'ЕП' }];
    expect(issueAxesWithoutData(withMethod).map(a => a.id)).toEqual(['period']);
  });

  it('появился плановый квартал — ось периода перестаёт числиться отсутствующей', () => {
    const withQuarter = [...issues, { title: 'строка Q2', planQuarter: 2 }];
    expect(issueAxesWithoutData(withQuarter).map(a => a.id)).toEqual(['procurement']);
  });

  it('пустое значение поля осью не считается', () => {
    const emptyMethod = [{ title: 'x', method: '' }, { title: 'y', planQuarter: null }];
    expect(issueAxesWithoutData(emptyMethod).map(a => a.id)).toEqual(['period', 'procurement']);
  });

  it('каждая отсутствующая ось объясняет причину', () => {
    for (const gap of issueAxesWithoutData(issues)) {
      expect(gap.label.length).toBeGreaterThan(0);
      expect(gap.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('splitIssuesBySeverity', () => {
  it('critical|error → critical; warning|significant → warning', () => {
    const all = [
      { severity: 'critical' }, { severity: 'error' },
      { severity: 'warning' }, { severity: 'significant' },
      { severity: 'info' },
    ];
    const { criticalIssues, warningIssues } = splitIssuesBySeverity(all);
    expect(criticalIssues).toHaveLength(2);
    expect(warningIssues).toHaveLength(2);
  });
});
