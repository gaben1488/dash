import { describe, expect, it } from 'vitest';
import {
  FIELD_GUIDANCE, SEASONAL_RULES, procurementEditableGuidance,
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
});
