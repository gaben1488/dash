import { describe, expect, it } from 'vitest';
import {
  FIELD_GUIDANCE, SEASONAL_RULES, PROCUREMENT_GUIDANCE_VERSION,
  checkedProcurementGuidanceResponse, epReasonEditorGuidance, procurementEditableGuidance,
  procurementRuleSections, procurementRulesMarkdown,
} from './procurement-guidance.js';

describe('C06.03 editable editorial catalog', () => {
  it('has stable, non-duplicated keys for every editable explanation', () => {
    const entries = procurementEditableGuidance();
    expect(entries.length).toBeGreaterThan(20);
    expect(new Set(entries.map(item => item.key)).size).toBe(entries.length);
    expect(entries.map(item => item.key)).toContain('field:planDate');
    expect(entries.map(item => item.key)).toContain('field:factDate');
    expect(entries.map(item => item.key)).toContain('ep:EP_MONOPOLIST');
    expect(entries.map(item => item.key)).toContain('seasonal:WINTER_ROAD_WORK');
  });

  it('projects saved edits to both screen and Markdown with identical paragraphs', () => {
    const overrides = {
      'field:method': 'Уточнённая инструкция по методу.',
      'ep:EP_MONOPOLIST': 'Проверить применимость основания отдельно.',
      'seasonal:WINTER_ROAD_WORK': 'Проверьте график выполнения работ.',
    };
    const sections = procurementRuleSections(overrides);
    const md = procurementRulesMarkdown(overrides);
    for (const text of Object.values(overrides)) {
      expect(sections.some(section => section.paragraphs.includes(text))).toBe(true);
      expect(md).toContain(text);
    }
    for (const section of sections) {
      expect(md).toContain(`## ${section.title}\n\n${section.paragraphs.join('\n\n')}`);
    }
  });

  it('never treats an unknown key or a blank edit as a valid rule rewrite', () => {
    const original = procurementRuleSections();
    const candidate = procurementRuleSections({
      'unknown:key': 'Неизвестный контроль',
      'field:planDate': '   ',
    });
    expect(candidate).toEqual(original);
    expect(procurementRulesMarkdown({ 'unknown:key': 'Неизвестный контроль' }))
      .toBe(procurementRulesMarkdown());
  });

  it('does not mutate semantic N/Q/AD guidance or seasonal parameters', () => {
    const before = { ...FIELD_GUIDANCE };
    const winter = SEASONAL_RULES.WINTER_ROAD_WORK.label;
    procurementRuleSections({
      'field:factDate': 'Редакторский комментарий',
      'seasonal:WINTER_ROAD_WORK': 'Другой текст',
    });
    expect(FIELD_GUIDANCE).toEqual(before);
    expect(FIELD_GUIDANCE.factDate).toContain('Q —');
    expect(FIELD_GUIDANCE.planDate).toContain('N —');
    expect(FIELD_GUIDANCE.flag).toContain('AD —');
    expect(SEASONAL_RULES.WINTER_ROAD_WORK.label).toBe(winter);
  });

  it('applies one strict saved-catalog contract for all screens and exports', () => {
    const entries = procurementEditableGuidance().map(item => ({
      ...item, text: item.defaultText, overridden: false, revision: 0, updatedAt: null as string | null,
    }));
    const response = { version: PROCUREMENT_GUIDANCE_VERSION, calculationRulesChanged: false, entries };
    expect(checkedProcurementGuidanceResponse(response)).toEqual(entries);
    const updated = entries.map(item => item.key === 'field:planDate' ? {
      ...item, text: 'Проверьте N по первичному документу', overridden: true,
      revision: 1, updatedAt: '2026-10-22T08:00:00.000Z',
    } : item);
    expect(checkedProcurementGuidanceResponse({ ...response, entries: updated })).toEqual(updated);

    const wrong = [
      null,
      { ...response, version: 'old-v0' },
      { ...response, calculationRulesChanged: true },
      { ...response, entries: entries.slice(0, -1) },
      { ...response, entries: [...entries.slice(0, -1), entries[0]] },
      { ...response, entries: [{ ...entries[0], section: 'wrong' }, ...entries.slice(1)] },
      { ...response, entries: [{ ...entries[0], defaultText: 'Иной исходный текст' }, ...entries.slice(1)] },
      { ...response, entries: [{ ...entries[0], text: 'Правка без флага' }, ...entries.slice(1)] },
      { ...response, entries: [{ ...entries[0], overridden: true }, ...entries.slice(1)] },
      { ...response, entries: [{ ...entries[0], revision: 1 }, ...entries.slice(1)] },
      { ...response, entries: [{ ...entries[0], updatedAt: 'вчера' }, ...entries.slice(1)] },
      { ...response, entries: [null, ...entries.slice(1)] },
    ];
    for (const candidate of wrong) expect(() => checkedProcurementGuidanceResponse(candidate)).toThrow();
  });


  it('uses the live L/M source fields for contextual help, not a parallel legal classifier', () => {
    const documented = epReasonEditorGuidance('ЕП', 'Закупка с ЕП предусматривает заключение по наименьшей цене');
    expect(documented).toContain('Тема распознана');
    expect(documented).toContain('не подтверждение законности');
    expect(epReasonEditorGuidance('ЕП', 'п.4 ч.1 ст.94')).toContain('не распознано');
    expect(epReasonEditorGuidance('ЕП', 'Х')).toContain('Основание отсутствует');
    expect(epReasonEditorGuidance('ЭА', 'Закупка с ЕП предусматривает заключение по наименьшей цене'))
      .toContain('способ не ЕП');
    const edited = epReasonEditorGuidance('ЕП', 'Х', 'Локальная инструкция');
    expect(edited).toContain('Локальная инструкция');
    expect(FIELD_GUIDANCE.epReason).toContain('M —');
    expect(FIELD_GUIDANCE.epReason).toContain('N');
    expect(FIELD_GUIDANCE.epReason).toContain('Q');
    expect(FIELD_GUIDANCE.epReason).toContain('AD');
  });

});
