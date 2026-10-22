// @vitest-environment jsdom
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { QualityPage } from './Quality';

vi.mock('./Trust', () => ({ TrustPage: () => <div>Quality content</div> }));
vi.mock('./Recon', () => ({ ReconPage: () => <div>Reconciliation content</div> }));
vi.mock('./Issues', () => ({ IssuesPage: () => <div>Issues content</div> }));
vi.mock('./Recs', () => ({ RecsPage: () => <div>Recommendations content</div> }));
vi.mock('./Journal', () => ({ JournalPage: () => <div>Journal content</div> }));
vi.mock('../components/quality/CommentAnnotationsSection', () => ({
  CommentAnnotationsSection: () => null,
}));
vi.mock('../components/analytics-extra/IntegritySection', () => ({
  IntegritySection: () => null,
}));
vi.mock('../components/scorecard/ScorecardSection', () => ({
  ScorecardSection: () => <div>Scorecard content</div>,
}));

const before = useStore.getState();
beforeEach(() => useStore.setState({ qualityTab: 'recon' }));
afterEach(() => { cleanup(); useStore.setState(before); });

it('unrelated store changes cannot redraw Control; selecting its tab still redraws the content', () => {
  let renders = 0;
  const onRender: ProfilerOnRenderCallback = () => { renders++; };
  render(<Profiler id="quality" onRender={onRender}><QualityPage /></Profiler>);
  expect(screen.getByText('Reconciliation content')).toBeTruthy();
  const initial = renders;
  act(() => useStore.setState({ moneyUnit: useStore.getState().moneyUnit === 'млн' ? 'тыс' : 'млн' }));
  expect(renders).toBe(initial);
  fireEvent.click(screen.getByRole('tab', { name: /Качество заполнения/ }));
  expect(renders).toBeGreaterThan(initial);
  expect(screen.getByText('Quality content')).toBeTruthy();
  expect(screen.getByRole('tab', { name: /Качество заполнения/ }).getAttribute('aria-selected')).toBe('true');
});
