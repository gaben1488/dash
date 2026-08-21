/**
 * Стражи консолидации сигналов — решения владельца п.137 от 21.08.2026
 * (`docs/superpowers/audits/2026-08-14-interview-register.md`, спека
 * `docs/superpowers/specs/2026-08-21-signal-consolidation.md`).
 *
 * Каждая смена РОДА класса (замечание против состояния, критический против
 * справочного) и каждая смена ПОДПИСИ закрыта здесь тестом. Без них решения
 * владельца живут ровно до следующей правки реестра: за последний месяц
 * продукт трижды возвращал уже снятый тон, потому что возвращать было некому.
 *
 * ЖЕЛЕЗНОЕ ПРАВИЛО, которое эти тесты тоже стерегут: ключи снимков не
 * меняются. Класс, ушедший с экрана, продолжает вычисляться и ложиться в
 * снимок — иначе годовая динамика оборвётся.
 */
import { describe, it, expect } from 'vitest';
import { CHECK_REGISTRY } from './check-registry.js';
import { LEGACY_SIGNAL_TO_CHECK, issueSuppressedByRowClass } from './issue-conversion.js';
import { SIGNAL_CLASS_NAMES, signalCardTitle } from './product-dictionary.js';
import {
  EP_RISK_STRICT_GRADES,
  epRiskStrictnessOfGrade,
  epRiskStrictnessOfReason,
} from './ep-justification-grade.js';
import {
  COMPOSITE_GRADE_CUTS,
  GRADE_SCALE_DIRECTION,
  MANAGEMENT_GRADE_CUTS,
  compositeGradeOfPenalty,
  managementGradeOfPenalty,
} from './grade-scale.js';

const check = (id: string) => CHECK_REGISTRY.find((c) => c.id === id);

describe('п.137(1) «в течение года» — только стадия', () => {
  it('СТРАЖ: замечание по ключу factWithoutDate не рождается', () => {
    // Решение владельца дословно: «закупка в течение года — ТОЛЬКО СТАДИЯ».
    // Дом класса — вкладка «В течение года»; из Замечаний, Дисциплины, Отчёта
    // и счёта качества он ушёл. Ход тот же, что у любого «бейдж-only» класса:
    // ключа нет в карте генерации, значит замечания нет ни в конвейере, ни в
    // проверке источника на сервере — обе читают эту карту.
    expect(LEGACY_SIGNAL_TO_CHECK.factWithoutDate).toBeUndefined();
  });

  it('СТРАЖ: паспорт остаётся в реестре и остаётся справочным', () => {
    // Запись нужна, чтобы старые снимки читались подписью, а не голым id:
    // ключ снимка не переименовывается и не удаляется никогда.
    const entry = check('fact_without_date');
    expect(entry).toBeDefined();
    expect(entry!.severity).toBe('info');
    expect(entry!.legacyId).toBe('factWithoutDate');
  });

  it('СТРАЖ: паспорт не требует правки книги', () => {
    const entry = check('fact_without_date')!;
    expect(entry.recommendation).toContain('Действий не требуется');
  });
});

describe('п.137(2) ЕП-риск — развилка по обоснованию', () => {
  it('СТРАЖ: строгий конец — «без обоснования» и «решение заказчика»', () => {
    expect([...EP_RISK_STRICT_GRADES].sort()).toEqual(['discretionary', 'unfounded']);
    expect(epRiskStrictnessOfGrade('unfounded')).toBe('critical');
    expect(epRiskStrictnessOfGrade('discretionary')).toBe('critical');
  });

  it('СТРАЖ: справочный конец — законная безальтернативность и подтверждённая выгода', () => {
    expect(epRiskStrictnessOfGrade('lawful-exclusive')).toBe('info');
    expect(epRiskStrictnessOfGrade('verified-benefit')).toBe('info');
  });

  it('СТРАЖ: живые формулировки книг разводятся по концам развилки', () => {
    // Тексты взяты из книг района, а не придуманы: монополист — справка,
    // «нецелесообразно» — риск.
    expect(epRiskStrictnessOfReason('Единственный поставщик тепловой энергии, естественная монополия'))
      .toBe('info');
    expect(epRiskStrictnessOfReason('Проведение аукциона нецелесообразно')).toBe('critical');
  });

  it('СТРАЖ: пустое и нераспознанное обоснование судится строго', () => {
    // Судить не о чем — значит и снисхождения нет. Это же значение стоит
    // умолчанием в паспорте, чтобы чип и карточка не разошлись.
    expect(epRiskStrictnessOfReason('')).toBe('critical');
    expect(epRiskStrictnessOfReason(null)).toBe('critical');
    expect(epRiskStrictnessOfReason('по решению руководителя учреждения')).toBe('critical');
  });

  it('СТРАЖ: умолчание паспорта совпадает со строгим концом развилки', () => {
    expect(check('ep_risk')!.severity).toBe('critical');
    expect(check('ep_risk')!.description).toContain('Строгость зависит от обоснования');
  });
});

describe('п.137(3) инициативные заявки — отмечаются, но не в риск-списки', () => {
  it('СТРАЖ: маркер «хотелки» гасит замечание о необеспеченности', () => {
    expect(issueSuppressedByRowClass('planYearMissing', { initiativeRequest: true })).toBe(true);
  });

  it('СТРАЖ: гасится ровно эта претензия, а не все признаки строки', () => {
    // «Хотелка» без плановой даты не обязана иметь срок; ошибку формулы,
    // просрочку и прочее она не оправдывает.
    expect(issueSuppressedByRowClass('overdue', { initiativeRequest: true })).toBe(false);
    expect(issueSuppressedByRowClass('formulaBroken', { initiativeRequest: true })).toBe(false);
    expect(issueSuppressedByRowClass('planYearMissing', { initiativeRequest: false })).toBe(false);
  });

  it('СТРАЖ: «хотелки» остались самостоятельным классом со своим именем', () => {
    // Решение начальницы через владельца: «хотелки как класс оставляем».
    expect(SIGNAL_CLASS_NAMES.initiativeRequest.chip).toBe('Инициативная заявка');
    expect(check('initiative_request')!.severity).toBe('info');
    // Собственного замечания у класса нет — он только отмечает строку.
    expect(LEGACY_SIGNAL_TO_CHECK.initiativeRequest).toBeUndefined();
  });
});

describe('п.137(4) исполнение чужого года — информационный признак', () => {
  it('СТРАЖ: класс есть, род информационный', () => {
    const entry = check('foreign_year_execution');
    expect(entry).toBeDefined();
    expect(entry!.severity).toBe('info');
    expect(entry!.name).toBe(signalCardTitle('foreignYearExecution'));
  });

  it('СТРАЖ: замечания по нему не рождается — «вполне как норма»', () => {
    expect(LEGACY_SIGNAL_TO_CHECK.foreignYearExecution).toBeUndefined();
    expect(check('foreign_year_execution')!.recommendation).toContain('Действий по книге не требуется');
  });
});

describe('п.137(6) факт раньше плановой даты — информационный', () => {
  it('СТРАЖ: род справочный и цена гейта ЕП названа вслух', () => {
    const entry = check('fact_date_before_plan')!;
    expect(entry.severity).toBe('info');
    // Спека спросила «показывать или объяснять, почему нет» — объяснение
    // обязано стоять в паспорте вместе с числом спрятанных строк.
    expect(entry.description).toContain('212');
  });
});

describe('п.137(9) одна шкала букв — меньше значит лучше', () => {
  it('СТРАЖ: направление числа штрафное, ноль — лучший исход', () => {
    expect(GRADE_SCALE_DIRECTION).toBe('penalty');
    expect(compositeGradeOfPenalty(0)).toBe('A');
    expect(managementGradeOfPenalty(0)).toBe('A');
  });

  it('СТРАЖ: буква ухудшается с ростом числа у обеих карт', () => {
    expect(compositeGradeOfPenalty(80)).toBe('F');
    expect(managementGradeOfPenalty(80)).toBe('D');
    for (const cuts of [COMPOSITE_GRADE_CUTS, MANAGEMENT_GRADE_CUTS]) {
      const bounds = cuts.map((c) => ('below' in c ? c.below : c.upTo));
      expect([...bounds].sort((a, b) => a - b)).toEqual(bounds);
    }
  });

  it('СТРАЖ: перенос шкалы не сдвинул ступени оценки управлений', () => {
    // Прежняя балльная запись: A ≥ 85, B ≥ 70, C ≥ 50, иначе D. Штраф —
    // её зеркало, поэтому пограничные управления буквы не меняют.
    for (let score = 0; score <= 100; score++) {
      const legacy = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
      expect(managementGradeOfPenalty(100 - score)).toBe(legacy);
    }
  });
});

describe('п.137(10) обоснование ЕП вне справочника — не претензия', () => {
  it('СТРАЖ: имя ведёт к справочнику, а не к вине управления', () => {
    expect(SIGNAL_CLASS_NAMES.unmappedReasonEP.chip).toBe('Обоснование ЕП вне справочника');
    expect(signalCardTitle('unmappedReasonEP')).toBe('Обоснование ЕП вне справочника оснований');
  });

  it('СТРАЖ: тон справочный, рекомендация ведёт к пополнению словаря', () => {
    const entry = check('unmapped_reason_ep')!;
    expect(entry.severity).toBe('info');
    expect(entry.recommendation).toContain('справочник');
    expect(entry.name).toBe(signalCardTitle('unmappedReasonEP'));
  });
});

describe('§6 спеки: объяснения без развилок', () => {
  it('СТРАЖ: «не обеспечена финансированием» объясняется рукописной датой N', () => {
    // Предикат требует ОБОИХ условий, и разница не косметическая: строк, где
    // плановая дата есть, а год пуст, — две, и это другой класс («сломана
    // формула даты»). Механизм «по P» дал бы не 552 строки, а 554.
    const entry = check('plan_year_missing')!;
    expect(entry.description).toContain('рукописной плановой даты (N)');
    expect(entry.description).toContain('P — вторичная история');
  });
});
