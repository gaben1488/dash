import { describe, expect, it } from 'vitest';
import { filterIssues, splitIssuesBySeverity } from './issues-filtering';

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
