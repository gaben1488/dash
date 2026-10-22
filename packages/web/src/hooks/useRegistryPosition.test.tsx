// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useRegistryPosition } from './useRegistryPosition';
afterEach(cleanup);
const row = { dept: 'УО', rowIndex: 8, rowRevision: 'revision-one', subject: 'Столы' };
it('restores pagination and the observed row after leaving and remounting the registry', () => {
  history.replaceState(null, '', '/?page=data');
  const first = renderHook(() => useRegistryPosition('data', [row], true));
  act(() => { first.result.current.setPageNum(3); first.result.current.setSelectedRow(row); });
  first.unmount();
  const second = renderHook(() => useRegistryPosition('data', [row], true));
  expect(second.result.current.pageNum).toBe(3);
  expect(second.result.current.selectedRow).toEqual(row);
});
it('does not reopen a different row reused at the same physical address, or erase the cursor before loading', () => {
  history.replaceState(null, '', '/?page=data');
  const first = renderHook(() => useRegistryPosition('data', [row], true));
  act(() => { first.result.current.setPageNum(4); first.result.current.setSelectedRow(row); });
  first.unmount();
  const second = renderHook(({ rows, ready }) => useRegistryPosition('data', rows, ready), { initialProps: { rows: [] as typeof row[], ready: false } });
  expect(second.result.current.pageNum).toBe(4);
  expect(second.result.current.selectionUnavailable).toBe(false);
  second.rerender({ rows: [{ ...row, rowRevision: 'new revision', subject: 'Другая закупка' }], ready: true });
  expect(second.result.current.selectedRow).toBeNull();
  expect(second.result.current.selectionUnavailable).toBe(true);
});
it('closes the card on browser Back and keeps another module query parameters', () => {
  history.replaceState(null, '', '/?page=data&monitoring=retained');
  const { result } = renderHook(() => useRegistryPosition('data', [row], true));
  act(() => result.current.setSelectedRow(row));
  expect(new URL(location.href).searchParams.get('monitoring')).toBe('retained');
  act(() => { history.replaceState(null, '', '/?page=data'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(result.current.selectedRow).toBeNull();
});
