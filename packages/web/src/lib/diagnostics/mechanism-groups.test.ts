import { describe, it, expect } from 'vitest';
import {
  groupIssuesByMechanism,
  mechanismLabel,
  isRetiredIssue,
  MECHANISM_FALLBACK_LABEL,
} from './mechanism-groups';

const overdueA = {
  id: 'i1',
  severity: 'critical',
  signal: 'overdue',
  checkId: 'overdue',
  title: 'Просрочен: Окорока (куриные)',
  description: 'УКСиМП, строка 4: Окорока (куриные)',
  sheet: 'УКСиМП',
  row: 4,
  departmentId: 'УКСиМП',
  kbHint: 'Плановая дата прошла, факта нет.',
  recommendation: 'Владельцу книги: проставить дату заключения или перенести план.',
};

const overdueB = {
  id: 'i2',
  severity: 'critical',
  signal: 'overdue',
  checkId: 'overdue',
  title: 'Просрочен: Шкаф комбинированный',
  sheet: 'УИО',
  row: 2237,
  departmentId: 'УИО',
};

const planYear = {
  id: 'i3',
  severity: 'warning',
  signal: 'planYearMissing',
  checkId: 'plan_year_missing',
  title: 'Закупка, не обеспеченная финансированием: Ремонт кровли',
  sheet: 'УО',
  row: 12,
  departmentId: 'УО',
};

describe('groupIssuesByMechanism', () => {
  it('сворачивает простыню в карточки: один механизм — одна карточка', () => {
    const groups = groupIssuesByMechanism([overdueA, overdueB, planYear]);
    expect(groups).toHaveLength(2);
    const overdue = groups.find((g) => g.key === 'overdue')!;
    expect(overdue.count).toBe(2);
    expect(overdue.addresses.map((a) => a.row)).toEqual([4, 2237]);
  });

  it('заголовок карточки — механизм, не предмет закупки', () => {
    const [first] = groupIssuesByMechanism([overdueA]);
    expect(first.label).toBe('Просрочен');
    expect(first.label).not.toContain('Окорока');
  });

  it('критические карточки идут раньше предупреждений, крупные — раньше мелких', () => {
    const groups = groupIssuesByMechanism([planYear, overdueA, overdueB]);
    expect(groups[0].key).toBe('overdue');
    expect(groups[1].key).toBe('plan_year_missing');
  });

  it('подсказка и действие поднимаются из первого замечания, где они есть', () => {
    const groups = groupIssuesByMechanism([overdueB, overdueA]);
    const overdue = groups.find((g) => g.key === 'overdue')!;
    expect(overdue.kbHint).toBe('Плановая дата прошла, факта нет.');
    expect(overdue.recommendation).toContain('Владельцу книги');
  });

  it('словарь продукта главнее заголовка конвейера', () => {
    const label = mechanismLabel(overdueA, (key) => (key === 'overdue' ? 'Просрочено' : key));
    expect(label).toBe('Просрочено');
  });

  it('латинский ключ не выходит на экран — честная заглушка', () => {
    const label = mechanismLabel({ title: 'unknown_check: something', signal: 'foo_bar' });
    expect(label).toBe(MECHANISM_FALLBACK_LABEL);
  });

  it('снятый каноном п.30 сигнал td_with_program не попадает в карточки', () => {
    const retired = { severity: 'warning', checkId: 'td_with_program', title: 'ТД с программой: X' };
    expect(isRetiredIssue(retired)).toBe(true);
    expect(groupIssuesByMechanism([retired, overdueA])).toHaveLength(1);
  });

  it('«№ п/п» из замечания проносится в адрес карточки (двойной адрес, п.98б)', () => {
    // Строки листа двигаются («Опрессовка»: была 534 → стала 155), поэтому
    // рядом с позиционным номером адрес несёт стабильный № п/п из колонки A.
    const withSeq = { ...overdueA, row: 155, rowSeq: '531' };
    const [group] = groupIssuesByMechanism([withSeq, overdueB]);
    expect(group.addresses[0].row).toBe(155);
    expect(group.addresses[0].rowSeq).toBe('531');
    // Замечание без rowSeq (старый снимок из SQL) — поле честно отсутствует.
    expect(group.addresses[1].rowSeq).toBeUndefined();
  });

  it('предмет закупки уходит в адрес, а не в заголовок; служебный хвост правил отбрасывается', () => {
    const rule = {
      severity: 'significant',
      title: 'Консистентность плановых сумм бюджета: лист «УО», строка 7',
      sheet: 'УО',
      row: 7,
      departmentId: 'УО',
    };
    const groups = groupIssuesByMechanism([rule, overdueA]);
    const ruleGroup = groups.find((g) => g.label.startsWith('Консистентность'))!;
    expect(ruleGroup.addresses[0].subject).toBeUndefined();
    const overdue = groups.find((g) => g.key === 'overdue')!;
    expect(overdue.addresses[0].subject).toBe('Окорока (куриные)');
  });
});
