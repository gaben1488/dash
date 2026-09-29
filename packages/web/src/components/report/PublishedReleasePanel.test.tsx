// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PublishedReleasePanel } from './PublishedReleasePanel';

const receipt = {
  release_id: `REL-${'a'.repeat(64)}`, snapshot_id: 'SNP-test', report_date: '30.09.2026',
  cutoff_at: '2026-09-29T16:00:00Z', published_at: '2026-09-29T16:05:00Z',
  model_sha256: 'a'.repeat(64), rules_version: 'test', renderer_version: 'test', status: 'VERIFIED',
};
const request = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', request);
  request.mockReset();
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function respond(body: unknown) {
  request.mockResolvedValue({ ok: true, json: async () => body });
}

describe('опубликованный комплект', () => {
  it('не предлагает документы до первого проверенного выпуска', async () => {
    respond({ latest: null, attempt: null });
    render(<PublishedReleasePanel />);
    expect(await screen.findByText('Проверенных выпусков пока нет.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Основной отчёт · Word' })).toBeNull();
  });

  it('при отказе нового запуска сохраняет прежнюю дату и объясняет причину', async () => {
    respond({ latest: receipt, attempt: { status: 'NOT_ISSUED', report_date: '01.10.2026',
      blockers: [{ code: 'SOURCE_QA_ERRORS', message: 'Не совпали суммы источников.' }] } });
    render(<PublishedReleasePanel />);
    expect(await screen.findByText('Отчёт на 30.09.2026')).toBeTruthy();
    expect(screen.getByText('Новый отчёт на 01.10.2026 не выпущен.')).toBeTruthy();
    expect(screen.getByText('Не совпали суммы источников.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Основной отчёт · Word' })).toBeTruthy();
  });

  it('показывает замечания и скачивает только выбранный сохранённый выпуск с авторизацией', async () => {
    localStorage.setItem('aemr_api_key', 'test-token');
    respond({ latest: { ...receipt, status: 'VERIFIED_WITH_WARNINGS' }, attempt: null });
    const create = vi.fn(() => 'blob:test');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<PublishedReleasePanel />);
    expect(await screen.findByText('Проверен, есть замечания')).toBeTruthy();
    request.mockResolvedValue({ ok: true, blob: async () => new Blob(['docx']) });
    fireEvent.click(screen.getByRole('button', { name: 'Основной отчёт · Word' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    const [url, init] = request.mock.calls.at(-1)!;
    expect(url).toBe(`/api/report-releases/${receipt.release_id}/main.docx`);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token');
    expect(revoke).toHaveBeenCalledWith('blob:test');
    click.mockRestore();
  });

  it('различает недоступный сервис и отсутствие выпусков', async () => {
    request.mockRejectedValue(new Error('offline'));
    render(<PublishedReleasePanel />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Не удалось проверить состояние выпуска. Повторите запрос.');
    expect(screen.queryByText('Проверенных выпусков пока нет.')).toBeNull();
  });

  it('не принимает неизвестное состояние за проверенный выпуск', async () => {
    respond({ latest: { ...receipt, status: 'BLOCKED' }, attempt: null });
    render(<PublishedReleasePanel />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Основной отчёт · Word' })).toBeNull();
  });
});
