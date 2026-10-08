import { describe, expect, it } from 'vitest';
import { normalizeMonitoring } from './contract';
import { buildMonitoringCsv } from './csv';

describe('выгрузка текущего отбора мониторинга', () => {
  it('сохраняет код источника с ведущими нулями, отдельно от ключа сопоставления', () => {
    const rows = normalizeMonitoring({ procedures: [{ code: 'ЭАС6/2-25', sourceCode: 'ЭАС06/02-25' }] }).procedures;
    expect(rows[0].sourceCode).toBe('ЭАС06/02-25');
    expect(buildMonitoringCsv(rows, { readAt: '' }, '')).toContain('\r\nЭАС06/02-25;');
    expect(rows[0].code).toBe('ЭАС6/2-25');
  });
  it('выгружает переданные строки в их порядке, сохраняет копейки, пустоту и источник', () => {
    const rows = normalizeMonitoring({ procedures: [
      { code: 'ЭА12-26', sheet: 'Рабочий реестр процедур', row: 4, nmck: 100.01, auctionPrice: 0, stage: 'published', subject: 'Крупа; "Поставка"\nВторая строка' },
      { code: 'ЭА11-26', sheet: 'Рабочий реестр процедур', row: 3, nmck: null, auctionPrice: null, stage: 'application' },
    ] }).procedures;
    const csv = buildMonitoringCsv(rows, { readAt: '2026-10-07T12:30:00Z', bookUrl: 'https://docs.google.com/spreadsheets/d/book/edit' }, 'УО · текущий отбор');
    expect(csv.startsWith('\uFEFFКод процедуры;')).toBe(true);
    expect(csv.indexOf('ЭА12-26')).toBeLessThan(csv.indexOf('ЭА11-26'));
    expect(csv).toContain('100,01;0,00;');
    expect(csv).toContain('"Крупа; ""Поставка""\nВторая строка"');
    expect(csv).toContain("https://docs.google.com/spreadsheets/d/book/edit?range=");
    expect(csv).toContain('08.10.2026, 00:30 (Камчатка)');
    expect(csv).not.toContain('NaN');
    expect(csv).not.toContain('—');
    expect(csv).toContain('УО · текущий отбор');
  });

  it('содержит действие, качество и явные связи; текст из книги не становится формулой', () => {
    const rows = normalizeMonitoring({ procedures: [
      { subject: '=SUM(1;2)', customer: ' \t+cmd', requiredAction: 'Разместить извещение', qualityNote: 'Неполно: Заказчик — F',
        ancestorCodes: ['ЭА09-26'], successorCodes: ['ЭА13-26'], protocolFlag: 'протокол с отклонениями',
        winner: { name: '@supplier', inn: '0200123456' }, comment: '=Комментарий источника; потребность пересмотрена' },
    ] }).procedures;
    const csv = buildMonitoringCsv(rows, { readAt: '2026-10-07T12:30:00Z' }, 'Весь округ');
    expect(csv).toContain("'=SUM(1;2)");
    expect(csv).toContain("'@supplier");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain('Разместить извещение');
    expect(csv).toContain('Неполно: Заказчик — F');
    expect(csv).toContain('ЭА09-26;ЭА13-26');
    expect(csv).toContain('протокол с отклонениями');
    expect(csv).toContain("\"'=Комментарий источника; потребность пересмотрена\"");
    expect(rows[0].comment).toBe('=Комментарий источника; потребность пересмотрена');
  });
});
