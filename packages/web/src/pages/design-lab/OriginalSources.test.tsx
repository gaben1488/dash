// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { ORIGINAL_SOURCES, OriginalSources, sandboxOriginal } from './OriginalSources';

afterEach(() => cleanup());

describe('source-faithful dev gallery', () => {
  it('indexes the real source HTML rather than imagined screenshots', () => {
    expect(ORIGINAL_SOURCES).toHaveLength(12);
    expect(new Set(ORIGINAL_SOURCES.map(s => s.id)).size).toBe(12);
    for (const source of ORIGINAL_SOURCES) {
      expect(existsSync(new URL('../../../../../' + source.path, import.meta.url))).toBe(true);
      expect(source.limitation.length).toBeGreaterThan(20);
    }
  });

  it('blocks network and parent-origin access in the embedded documents', () => {
    const sandboxed = sandboxOriginal('<!doctype html><html><head><title>Test</title></head><body><p>Оригинал</p></body></html>');
    expect(sandboxed).toContain('connect-src');
    expect(sandboxed).toContain('form-action');
    expect(sandboxed).toContain('default-src');
    expect(sandboxed).toContain('<title>Test</title>');
    const fragment = sandboxOriginal('<style>body{margin:0}</style><div>Фрагмент</div>');
    expect(fragment).toContain('<!doctype html>');
    expect(fragment).toContain('Фрагмент');
  });

  it('does not pass the archival ether HTML fragment off as a complete standalone mock', async () => {
    render(<OriginalSources />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Оригинальный макет' }), { target: { value: 'ether' } });
    const source = await screen.findByLabelText('Исходный HTML-фрагмент');
    expect(source.textContent).toContain('pv-panel');
    expect(screen.queryByTitle(/Архивный оригинал: Эфир/)).toBeNull();
  });

  it('lets users inspect a whole original at a selected viewport without replacing product UI', async () => {
    render(<OriginalSources />);
    const source = await screen.findByTitle('Архивный оригинал: Отделки: автомобильные материалы');
    expect(source.tagName).toBe('IFRAME');
    expect(source.getAttribute('sandbox')).toBe('allow-scripts');
    expect(source.getAttribute('srcdoc')).toContain('Отделки Пульса');
    fireEvent.click(screen.getByRole('button', { name: '390 px' }));
    expect(source.getAttribute('width')).toBe('390');
    expect(screen.getByRole('link', { name: /Открыть исходный файл/ }).getAttribute('href')).toContain('/otdelki.html');
  });
});
