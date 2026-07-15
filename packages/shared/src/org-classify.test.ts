import { describe, expect, it } from 'vitest';
import { classifyOrg, type OrgType } from './org-classify';

describe('classifyOrg (1.2): тип организации по ОПФ, не по регексам', () => {
  it('казённое учреждение (МКУ) → ПБС', () => {
    expect(classifyOrg('Муниципальное казенное учреждение «Центр бухгалтерского обслуживания и материально-технического обеспечения»').type).toBe('kazennoe');
    expect(classifyOrg('МКУ "ЦЭР"').type).toBe('kazennoe');
  });
  it('бюджетное (МБОУ/МБДОУ) → не ПБС', () => {
    expect(classifyOrg('МБДОУ ДС № 24 «Журавлик»').type).toBe('byudzhetnoe');
    expect(classifyOrg('МБОУ «Елизовская средняя школа №9 им. Р.В.Федины»').type).toBe('byudzhetnoe');
  });
  it('казённое общеобразовательное (МКОУ/МКДОУ) → ПБС, не бюджетное', () => {
    // МКОУ = муниципальное КАЗЁННОЕ общеобразовательное учреждение (ст.6 БК → ПБС).
    expect(classifyOrg('МКОУ «Сельская средняя школа»').type).toBe('kazennoe');
    expect(classifyOrg('МКОУ «Сельская средняя школа»').isPBS).toBe(true);
    expect(classifyOrg('МКДОУ «Детский сад»').type).toBe('kazennoe');
  });
  it('автономное (МАДОУ) → не ПБС', () => {
    expect(classifyOrg('МАДОУ ДС № 1 «Ласточка»').type).toBe('avtonomnoe');
  });
  it('совместные закупки — псевдо-организация, не учреждение', () => {
    expect(classifyOrg('Совместные закупки').type).toBe('joint_procurement');
  });
  it('пустая/«Х» колонка C → аппарат (само управление)', () => {
    expect(classifyOrg('Х').type).toBe('apparatus');
    expect(classifyOrg('').type).toBe('apparatus');
  });
  it('функции аппарата (Опека/Администрирование) → аппарат', () => {
    expect(classifyOrg('Опека').type).toBe('apparatus');
    expect(classifyOrg('Администрирование').type).toBe('apparatus');
  });
  it('isPBS = только казённые + органы', () => {
    expect(classifyOrg('МКУ "ЦЭР"').isPBS).toBe(true);
    expect(classifyOrg('МБДОУ ДС № 24 «Журавлик»').isPBS).toBe(false);
  });
  it('ЦДТ — учреждение (Центр детского творчества, Елизово), не unknown и не аппарат', () => {
    const r = classifyOrg('ЦДТ');
    expect(r.type).toBe('byudzhetnoe');
    expect(r.isPBS).toBe(false);
    expect(r.label).toContain('Центр детского творчества');
  });

  it('нераспознанный префикс → unknown + не бросает', () => {
    const r = classifyOrg('ООО «Ромашка»');
    expect(r.type).toBe('unknown');
  });
  it('OrgType — экспортируемый тип (компиляционная проверка)', () => {
    const t: OrgType = 'kazennoe';
    expect(t).toBe('kazennoe');
  });
});
