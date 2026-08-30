/**
 * Страж двери «пятно Пульта → раздел Контроля» (срез 4 волны обмотки,
 * 30.08.2026).
 *
 * Пятно «Целостность формул книг» обязано приводить в СВОЙ раздел вкладки
 * «Контроль», а не в общий список замечаний: перечень ячеек с адресами живёт
 * только там. Затравка раздела живёт по тому же закону, что затравки
 * признаков и слагаемого доверия (канон п.134): переход, о разделе не
 * просивший, её обнуляет — иначе вкладка однажды откроется не тем разделом,
 * которого никто не просил.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';

const s = () => useStore.getState();

beforeEach(() => {
  useStore.setState({
    page: 'dashboard',
    qualityTab: 'recon',
    issuesSectionSeed: null,
  } as never);
});

describe('затравка раздела вкладки «Контроль»', () => {
  it('дверь пятна формул кладёт раздел и вкладку разом', () => {
    s().navigateTo('quality', { qualityTab: 'issues', issuesSection: 'formulas' });
    expect(s().page).toBe('quality');
    expect(s().qualityTab).toBe('issues');
    expect(s().issuesSectionSeed).toBe('formulas');
  });

  it('переход без раздела обнуляет затравку — она не переживает второй заход', () => {
    s().navigateTo('quality', { qualityTab: 'issues', issuesSection: 'formulas' });
    expect(s().issuesSectionSeed).toBe('formulas');
    s().navigateTo('quality', { qualityTab: 'issues' });
    expect(s().issuesSectionSeed).toBeNull();
  });

  it('затравка снимается и общим сбросом отбора', () => {
    s().navigateTo('quality', { qualityTab: 'issues', issuesSection: 'formulas' });
    s().resetAllFilters();
    expect(s().issuesSectionSeed).toBeNull();
  });

  it('очистка затравки вручную — то, что делает вкладка при открытии', () => {
    s().navigateTo('quality', { qualityTab: 'issues', issuesSection: 'formulas' });
    s().clearIssuesSectionSeed();
    expect(s().issuesSectionSeed).toBeNull();
  });
});
