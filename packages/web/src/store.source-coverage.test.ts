import { beforeEach, expect, it, vi } from 'vitest';
import { departmentCoverage } from '@aemr/shared';
vi.mock('./api', () => ({ api: { getSubordinates: vi.fn() }, humanizeRequestError: String }));
import { api } from './api';
import { useStore } from './store';

beforeEach(() => {
  vi.resetAllMocks();
  useStore.setState({ subordinatesLoading: false });
});

it('retains the explicit partial perimeter of the live subordinate dictionary', async () => {
  const coverage = departmentCoverage(['УО', 'УД'], ['УО']);
  vi.mocked(api.getSubordinates).mockResolvedValue({ subordinates: { УО: ['Новое учреждение'] }, coverage } as never);
  await useStore.getState().fetchSubordinates();
  expect(useStore.getState().subordinatesMap['УО']).toContain('Новое учреждение');
  expect(useStore.getState().subordinatesCoverage).toEqual(coverage);
});

it('a failed dictionary refresh is visible and preserves existing selectable organizations', async () => {
  useStore.setState({ subordinatesMap: { УО: ['Прочитанное учреждение'] } });
  vi.mocked(api.getSubordinates).mockRejectedValue(new Error('503'));
  await useStore.getState().fetchSubordinates();
  expect(useStore.getState().subordinatesMap['УО']).toEqual(['Прочитанное учреждение']);
  expect(useStore.getState().subordinatesError).toContain('503');
});
