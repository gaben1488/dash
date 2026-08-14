import { describe, it, expect } from 'vitest';
import {
  DEPARTMENT_REGISTRY,
  ALL_DEPT_IDS,
  ALL_LATIN_IDS,
  LATIN_TO_CYRILLIC,
  CYRILLIC_TO_LATIN,
} from '../department-registry';
import {
  GRBS_CANONICAL,
  GRBS_REGISTRY,
  ALL_GRBS_IDS,
  DEPARTMENT_ID_TO_GRBS_ID,
  GRBS_ID_TO_DEPARTMENT_ID,
  toGrbsId,
} from './grbs-registry';
import { getSubordinatesByGrbs, SUBORDINATE_REGISTRY } from './subordinate-registry';
import { UI_LABELS } from '../constants';

describe('ГРБС identity bijection (department ↔ latin ↔ grbs)', () => {
  it('latin↔cyrillic — полная биекция из реестра (8, обратима)', () => {
    expect(Object.keys(LATIN_TO_CYRILLIC)).toHaveLength(8);
    expect(Object.keys(CYRILLIC_TO_LATIN)).toHaveLength(8);
    for (const lat of ALL_LATIN_IDS) {
      const cyr = LATIN_TO_CYRILLIC[lat];
      expect(cyr).toBeDefined();
      expect(CYRILLIC_TO_LATIN[cyr]).toBe(lat); // round-trip latin→cyr→latin
    }
    for (const cyr of ALL_DEPT_IDS) {
      expect(LATIN_TO_CYRILLIC[CYRILLIC_TO_LATIN[cyr]]).toBe(cyr); // cyr→latin→cyr
    }
  });

  it('производные карты совпадают с id/latinId записей реестра', () => {
    for (const d of DEPARTMENT_REGISTRY) {
      expect(LATIN_TO_CYRILLIC[d.latinId]).toBe(d.id);
      expect(CYRILLIC_TO_LATIN[d.id]).toBe(d.latinId);
    }
  });

  it('DepartmentId ↔ GrbsId — мост покрывает все 8 и биективен', () => {
    expect(ALL_DEPT_IDS).toHaveLength(GRBS_CANONICAL.length);
    expect(ALL_GRBS_IDS).toHaveLength(8);
    for (const dep of ALL_DEPT_IDS) {
      const grbs = DEPARTMENT_ID_TO_GRBS_ID[dep];
      expect(grbs, `нет GrbsId для ${dep}`).toBeDefined();
      expect(GRBS_CANONICAL).toContain(grbs);
      expect(GRBS_ID_TO_DEPARTMENT_ID[grbs]).toBe(dep); // round-trip
    }
  });

  it('единственное расхождение форм — УАГЗО ↔ УАГиЗО', () => {
    expect(DEPARTMENT_ID_TO_GRBS_ID['УАГЗО']).toBe('УАГиЗО');
    for (const dep of ALL_DEPT_IDS) {
      if (dep === 'УАГЗО') continue;
      // остальные семь — идентичные строки в обеих формах
      expect(String(DEPARTMENT_ID_TO_GRBS_ID[dep])).toBe(String(dep));
    }
  });

  it('toGrbsId нормализует обе кириллические формы, alias-строки и мусор', () => {
    expect(toGrbsId('УАГЗО')).toBe('УАГиЗО'); // DepartmentId/данные → канон
    expect(toGrbsId('УАГиЗО')).toBe('УАГиЗО'); // уже канон
    expect(toGrbsId('УО')).toBe('УО');
    expect(toGrbsId('УО  АЕМР')).toBe('УО'); // двойной пробел через alias-карту
    expect(toGrbsId('УФБР')).toBe('УФБП'); // опечатка через alias-карту
    expect(toGrbsId('чушь')).toBeUndefined();
  });

  it('GREEN: getSubordinatesByGrbs работает для обеих форм (УАГЗО = УАГиЗО)', () => {
    const viaGrbs = getSubordinatesByGrbs('УАГиЗО');
    const viaDept = getSubordinatesByGrbs('УАГЗО'); // форма данных/фильтра — раньше промахивалась
    expect(viaGrbs.length).toBeGreaterThan(0);
    expect(viaDept).toEqual(viaGrbs);
  });
});

describe('СТРАЖ п.7/33 интервью 14.08.2026 — расшифровка УКСиМП верна во всех словарях', () => {
  // Класс дефекта: УКСиМП расшифровывался как «Управление кап. строительства»
  // — выдуманное имя, не существующее в районе. Верно: «Управление культуры,
  // спорта и молодёжной политики». Исправлено в 4 словарях 14.08 (п.7); на
  // проде старое имя жило до выката (п.33). Страж закрывает КЛАСС: ни одна
  // словарная запись системы не имеет права содержать выдуманную расшифровку,
  // а все полные имена УКСиМП обязаны быть про культуру/спорт/молодёжную
  // политику. Запрещённая фраза собрана конкатенацией, чтобы приёмочный
  // grep-свип по исходникам оставался нулевым.

  it('полные имена УКСиМП во всех реестрах — культура, спорт и молодёжная политика', () => {
    const dept = DEPARTMENT_REGISTRY.find((d) => d.id === 'УКСиМП')!;
    expect(dept.fullName).toBe('Управление культуры, спорта и молодёжной политики');
    const grbs = GRBS_REGISTRY.find((g) => g.id === 'УКСиМП')!;
    expect(grbs.fullName).toBe('Управление культуры, спорта и молодёжной политики');
    // UI-словарь держит сокращённую форму, но с тем же смыслом.
    expect(UI_LABELS['dept.УКСиМП']).toContain('культуры, спорта');
    // Запись самой организации в реестре подведов (канон п.51: дословно из книги).
    const orgItself = SUBORDINATE_REGISTRY.find((s) => s.id === 'uksimp_org');
    if (orgItself) {
      expect(orgItself.canonicalName).toContain('культуры, спорта');
    }
  });

  it('выдуманная расшифровка не встречается ни в одном словарном значении', () => {
    const forbidden = ['капитального', 'строительства'].join(' ');
    const allValues: string[] = [
      ...DEPARTMENT_REGISTRY.flatMap((d) => [d.fullName, d.shortName ?? '']),
      ...GRBS_REGISTRY.flatMap((g) => [g.fullName, g.shortName ?? '']),
      ...SUBORDINATE_REGISTRY.flatMap((s) => [s.canonicalName, s.displayName, s.shortName ?? '']),
      ...Object.values(UI_LABELS),
    ];
    for (const v of allValues) {
      expect(v).not.toContain(forbidden);
    }
  });
});
