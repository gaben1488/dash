// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconHeader } from './ReconHeader';

const request = vi.fn();
const createUrl = vi.fn(() => 'blob:verified-csv');
const revokeUrl = vi.fn();
let save: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  request.mockReset(); createUrl.mockClear(); revokeUrl.mockClear();
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = () => render(<ReconHeader view="departments" onViewChange={() => {}} csvUrl="/api/export/reconciliation?year=2026" />);

describe('авторизованная выгрузка сверки', () => {
  it('получает CSV через общий auth-транспорт и скачивает только успешные байты', async () => {
    const blob = new Blob(['csv']);
    request.mockResolvedValue({ ok: true, blob: async () => blob });
    mount(); fireEvent.click(screen.getByText('Выгрузить таблицу'));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(request.mock.calls[0][0]).toBe('/api/export/reconciliation?year=2026');
    expect(new Headers(request.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer test-token');
    expect(request.mock.calls[0][1].credentials).toBe('same-origin');
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(revokeUrl).toHaveBeenCalledWith('blob:verified-csv');
  });

  it.each([401, 403])('объясняет HTTP %s без скачивания тела отказа и автоматического повтора', async status => {
    request.mockResolvedValue({ ok: false, status, text: async () => 'PRIVATE SERVER BODY' });
    mount(); fireEvent.click(screen.getByText('Выгрузить таблицу'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('авторизац'));
    expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE');
    expect(request).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });
});
