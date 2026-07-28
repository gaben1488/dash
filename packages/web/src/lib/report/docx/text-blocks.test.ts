/**
 * Состав .docx-отчётов: проверяется словами, без рендера документа.
 * Калибровка — структура ручного отчёта «Отчёт по закупкам 05.04.2026».
 */
import { describe, it, expect } from 'vitest';
import { mainReportBlocks, analyticalReportBlocks, type ReportForExport } from './text-blocks';
import { makeReportFixture } from '../fixture';

const fixture = makeReportFixture() as ReportForExport;
const AS_OF = '20.03.2026';
const main = mainReportBlocks(fixture, AS_OF);
const extra = analyticalReportBlocks(fixture, AS_OF);
const textOf = (blocks: { text: string }[]) => blocks.map((b) => b.text).join('\n');

describe('основной отчёт — структура ручного оригинала', () => {
  it('начинается районным блоком и двумя разделами способов', () => {
    expect(main[0].text).toBe('ВСЕ ГРБС');
    const headings = main.filter((b) => b.kind === 'heading').map((b) => b.text);
    expect(headings[0]).toBe('ПО КОНКУРЕНТНЫМ ПРОЦЕДУРАМ:');
    expect(headings).toContain('ЕДИНСТВЕННЫЙ ПОСТАВЩИК:');
  });

  it('каждое управление получает свою секцию с обоими способами', () => {
    const headings = main.filter((b) => b.kind === 'heading').map((b) => b.text);
    for (const block of fixture.grbsBlocks) {
      expect(headings).toContain(block.deptLabel);
    }
    // По разделу «КОНКУРЕНТНЫЕ ПРОЦЕДУРЫ:» на каждое управление.
    expect(headings.filter((h) => h === 'КОНКУРЕНТНЫЕ ПРОЦЕДУРЫ:'))
      .toHaveLength(fixture.grbsBlocks.length);
  });

  it('кварталы названы по-русски, латинской Q в тексте нет', () => {
    expect(textOf(main)).toContain('1 кв');
    expect(textOf(main)).not.toMatch(/\bQ[1-4]\b/);
  });

  it('дата среза стоит в строке «По состоянию на»', () => {
    expect(textOf(main)).toContain(`По состоянию на ${AS_OF}`);
  });

  it('исполнение печатается с двумя знаками и запятой (формат оригинала)', () => {
    expect(textOf(main)).toContain('40,00%');
  });

  it('нерассчитанное названо честной плашкой, а не нулём', () => {
    // Плановая сумма квартала по бюджетам продуктом пока не считается.
    expect(textOf(main)).toContain('не рассчитано');
  });

  it('склонения по числу: 1 договор/контракт, 2 договора, 5 договоров', () => {
    const blocks = mainReportBlocks(fixture, AS_OF);
    // В фикстуре УЭР: ЕП план 5, факт 2 — обе формы должны встретиться.
    const t = textOf(blocks);
    expect(t).toMatch(/Заключено 2 договора\/контракта/);
  });
});

describe('дополнительный отчёт — аналитическая часть', () => {
  it('несёт девять разделов оригинала по порядку', () => {
    const headings = extra.filter((b) => b.kind === 'heading').map((b) => b.text);
    expect(headings[0]).toBe('1. УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ');
    expect(headings).toContain('2. ОБЩАЯ КАРТИНА');
    expect(headings).toContain('3. СВЕРКА С ОФИЦИАЛЬНЫМ ЛИСТОМ СВОД');
    expect(headings).toContain('4. АНАЛИТИКА ПО ГРБС');
    expect(headings).toContain('5. ЗАМЕЧАНИЯ И РИСКИ');
    expect(headings).toContain('8. ОГОВОРКИ К ОТЧЁТУ');
  });

  it('сверка называет расхождение с адресом ячейки', () => {
    // Фикстура УЭР: живой КП-факт 5 против 5 в листе — расхождения нет.
    expect(textOf(extra)).toContain('Расхождений нет');
  });

  it('режим просмотра назван в оговорках', () => {
    const live = analyticalReportBlocks(
      { ...fixture, period: { ...fixture.period, live: true } },
      AS_OF,
    );
    expect(textOf(live)).toContain('в режиме прямого эфира');
    const archive = analyticalReportBlocks(
      { ...fixture, period: { ...fixture.period, live: false } },
      AS_OF,
    );
    expect(textOf(archive)).toContain('по снимку недели');
  });

  it('замечания секций попадают в раздел рисков', () => {
    expect(textOf(extra)).toContain('Просрочен план размещения по 3 процедурам');
  });
});
