import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RowDetailCard } from './RowDetailCard';
import { rowSignalTone, signalChipText } from '../lib/rows/registry-view';
vi.mock('../store', () => ({ useStore: (selector: (s: unknown) => unknown) => selector({ formatMoney: String, dashboardData: null }) }));
vi.mock('./timeline/RowTimelineSection', () => ({ RowTimelineSection: () => null }));
vi.mock('./provenance/PlanProvenanceSection', () => ({ PlanProvenanceSection: () => null }));
vi.mock('./yearlong/YearlongKindSelect', () => ({ YearlongKindSelect: () => null }));
vi.mock('./yearlong/YearlongBadge', () => ({ YearlongBadge: () => null }));

it('shows the same read-only AE/AF context with the uncertainty chip', () => {
  const row = { id: '999', subject: 'Годовая потребность', method: 'ЕП', amountBasis: 'position-total' as const,
    necessityJustification: 'Необходимость из AE', commentGRBS: 'История из AF', epReason: '', signals: ['epRisk'] };
  const html = renderToStaticMarkup(<RowDetailCard row={row} onClose={() => {}} />);
  expect(html).toContain('Необходимость из AE');
  expect(html).toContain('История из AF');
  expect(html).toContain(signalChipText('epRisk', row).text);
});

describe('EP detail uses the registry row scope', () => {
  it.each([
    { dept: 'uksimp', id: '3', subject: 'Окорока (куриные)', method: 'ЕП', factDateRaw: 'Х', factSum: 800, epReason: '' },
    { dept: 'uksimp', id: '4', subject: 'Разовая закупка', method: 'ЕП', factDateRaw: '10.10.2026', factSum: 800, epReason: 'Проведение аукциона нецелесообразно' },
    { dept: 'uksimp', id: '4', subject: 'Разовая закупка', method: 'ЕП', factDateRaw: 'Х', factSum: 800, epReason: 'Особое основание для проверки' },
  ])('matches table wording and tone for $id / $epReason', row => {
    const html = renderToStaticMarkup(<RowDetailCard row={{ ...row, signals: ['epRisk'] }} onClose={() => {}} />);
    expect(html).toContain(signalChipText('epRisk', row).text);
    expect(html).toContain(rowSignalTone('epRisk', row).bg);
  });
});
