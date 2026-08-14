/**
 * comment-consistency.test.ts — сигнал несогласованности комментариев (п.72(а)).
 *
 * Все тексты — ЖИВЫЕ, из дампа прода comments-full.jsonl от 14.08.2026
 * (адрес каждого: книга + номер строки листа) либо из эталонной разметки
 * владельца std-dop-infa.txt (строка указана). Дата снимка везде 14.08.2026 —
 * день снятия дампа; передаётся параметром, Date.now в правилах нет.
 */

import { describe, it, expect } from 'vitest';
import { detectCommentInconsistencies } from './comment-consistency.js';
import type { CommentRowRef } from './comment-consistency.js';

const SNAPSHOT = new Date(2026, 7, 14); // 14.08.2026 — дата снятия дампов

const ref = (book: string, sheetRow: number): CommentRowRef => ({ book, sheetRow });

describe('правило (а): этапность при заключённом контракте', () => {
  it('УД r14: «в стадии окончания подачи заявок» в AF при Q=27.04.2026 → карточка', () => {
    // Живая строка: УД, лист r14, A=11 (пледы), Q=27.04.2026, AG=ЭА179-26
    const cards = detectCommentInconsistencies(ref('УД', 14), {
      Q: '27.04.2026',
      N: '30.04.2026',
      AF: 'в период с 03.04.2026 по 28.04.2026 в стадии окончания подачи заявок, переходящий период на второй квартал ввиду позднего срока направления заявок',
    }, SNAPSHOT);

    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.kind).toBe('stage_marker_when_signed');
    expect(card.rowKey).toBe('УД:r14');
    expect(card.column).toBe('AF');
    expect(card.cell).toBe('AF14');
    expect(card.excerpt).toContain('подачи заявок');
    expect(card.mechanism).toContain('27.04.2026'); // дата Q — структурный факт заключения
    expect(card.action).toContain('AF14');
    expect(card.action).toContain('обновите комментарий');
  });

  it('УО r32: «будет размещен еще аукцион» в AF при Q=27.04.2026 → карточка по букве директивы', () => {
    // Живая строка: УО, лист r32, A=29. Текст — про НОВЫЙ аукцион на экономию,
    // не про стадию этой закупки; срабатывание по маркеру «будет размещ» —
    // кандидат в ложные, вынесен в вопросы владельцу (см. отчёт волны 14.08).
    const cards = detectCommentInconsistencies(ref('УО', 32), {
      Q: '27.04.2026',
      AF: 'контракт заключен, на оставшаюся экономию будет размещен еще аукцион',
    }, SNAPSHOT);

    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('stage_marker_when_signed');
    expect(cards[0].cell).toBe('AF32');
  });

  it('УЭР r41: маркер стадии в U при заключённом — НЕ карточка (правило (а) сканирует только AF/AE)', () => {
    // Живая строка: УЭР, лист r41, A=14, Q=30.06.2026. Маркер «на стадии подачи
    // заявок» стоит в U — вне охвата правила (а) по букве директивы (AF/AE).
    // Расширение на U — вопрос владельцу (в U часто ИСТОРИЧЕСКОЕ объяснение
    // отклонения, которое не устарело).
    const cards = detectCommentInconsistencies(ref('УЭР', 41), {
      Q: '30.06.2026',
      U: 'Процедура объявлена в мае, однако по техническим причинам процедура в ЕИС была отменена. На данный момент 11.06.2026 заявка скорректирована, размещена в ЕИС повторно 11.06. Процедура находится на стадии подачи заявок от поставщиков, будет завершена до конца 2 квартала.',
    }, SNAPSHOT);

    expect(cards).toHaveLength(0);
  });

  it('УО r2031: маркер стадии при Q-заглушке — НЕ карточка (закупка не заключена, этапность уместна)', () => {
    // Живая строка: УО, лист r2031, A=2336 (замена ворот), Q='X'.
    const cards = detectCommentInconsistencies(ref('УО', 2031), {
      Q: 'X',
      AF: 'планирование, Смета на утверждении, ЭА будет размещен в начале сентября, ориентировочно 5-10 сентября',
    }, SNAPSHOT);

    // «будет размещен в начале сентября» — без даты цифрами, правило (б) тоже молчит
    expect(cards).toHaveLength(0);
  });
});

describe('правило (б): просроченное обещание при Q-заглушке', () => {
  it('УО r331: «договор будет заключен 01.06.2026» в AF при Q=X → карточка', () => {
    // Живая строка: УО, лист r331, A=335 (испытания электрооборудования).
    const cards = detectCommentInconsistencies(ref('УО', 331), {
      N: 'X',
      Q: 'X',
      U: 'Отсутствует финансирование. Планируется ориентировочно переносится на 31.08.2026',
      AF: 'договор будет заключен 01.06.2026',
    }, SNAPSHOT);

    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.kind).toBe('past_promise_no_fact');
    expect(card.rowKey).toBe('УО:r331');
    expect(card.cell).toBe('AF331');
    expect(card.excerpt).toContain('будет заключен 01.06.2026');
    expect(card.mechanism).toContain('01.06.2026');
    expect(card.mechanism).toContain('14.08.2026'); // дата снимка — параметр, не Date.now
    expect(card.action).toContain('Q331');
  });

  it('эталон владельца (std-dop-infa строка 10): «Контракт будет подписан до 31.07.2026» при Q=Х → карточка', () => {
    // Текст из эталонной разметки владельца (УЭР/МКУ «ЦЭР», дезинсекция,
    // строка листа 83). NB: в дампе 14.08 живая ячейка уже переписана на
    // «Контракт на подписании» — сам исполнитель обновил просроченное обещание.
    const cards = detectCommentInconsistencies(ref('УЭР', 83), {
      Q: 'Х', // кириллическая заглушка
      U: 'Перенос дезинсекции помещения на конец июля. Контракт будет подписан до 31.07.2026',
    }, SNAPSHOT);

    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('past_promise_no_fact');
    expect(cards[0].cell).toBe('U83');
    expect(cards[0].mechanism).toContain('31.07.2026');
  });

  it('УКСиМП r88: обещание с датой в БУДУЩЕМ («будет заключен 2.09.2026») → НЕ карточка', () => {
    // Живая строка: УКСиМП, лист r88, A=125 (обслуживание сайта АИС), Q=Х.
    const cards = detectCommentInconsistencies(ref('УКСиМП', 88), {
      Q: 'Х',
      N: '02.09.2026',
      AE: 'необходимо для своевременного размещения плана мероприятий по месяцам, обеспечения прозрачности деятельности учреждения',
      AF: 'контракт будет заключен 2.09.2026 (переходящий на 2027)',
    }, SNAPSHOT);

    expect(cards).toHaveLength(0);
  });

  it('УО r2280: обещание в прошлом, но Q заполнена → НЕ карточка (правило (б) только для незаключённых)', () => {
    // Живая строка: УО, лист r2280, A=2598 (отделочные материалы), Q=29.06.2026.
    // Обещание «будет заключен 30.06.2026» просрочено, но контракт заключён —
    // это правило молчит; проверку «обещание против фактической даты» решает
    // владелец отдельно (в вопросах волны).
    const cards = detectCommentInconsistencies(ref('УО', 2280), {
      Q: '29.06.2026',
      N: '30.05.2026',
      U: 'По состоянию на 26.06.2026 заказчик выбирает материал. Финансирование доведено, контракт будет заключен 30.06.2026',
      AF: 'договор заключен',
    }, SNAPSHOT);

    expect(cards).toHaveLength(0);
  });

  it('дата без года трактуется годом снимка (ветка по букве директивы: ДД.ММ(.ГГГГ)?)', () => {
    // Синтетическая вариация: в дампе 14.08.2026 обещаний без года — 0 (проверено
    // сканом всех 3881 строк); ветка покрывается тестом, помеченным как синтетика.
    const cards = detectCommentInconsistencies(ref('УО', 999), {
      Q: 'Х',
      AF: 'договор будет подписан до 05.08',
    }, SNAPSHOT);

    expect(cards).toHaveLength(1);
    expect(cards[0].mechanism).toContain('05.08.2026'); // год = год снимка
  });
});

describe('правило (г): посторонний текст в колонке номера процедуры AG (п.74б)', () => {
  it('УИО r27: «ЭА220-26 не состоялся (…)» — код + приписка → карточка «перенести в примечание»', () => {
    // Живая ячейка дампа: AG = код + пояснение. Q заполнена — правило (г)
    // от Q не зависит, а правила (а)/(б) AG-текстом не срабатывают.
    const cards = detectCommentInconsistencies(ref('УИО', 27), {
      Q: '08.06.2026',
      AG: 'ЭА220-26 не состоялся (заявка 1 , заключили с ед. поставщиком)',
    }, SNAPSHOT);

    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.kind).toBe('foreign_text_in_ag');
    expect(card.rowKey).toBe('УИО:r27');
    expect(card.column).toBe('AG');
    expect(card.cell).toBe('AG27');
    expect(card.excerpt).toContain('не состоялся');
    expect(card.mechanism).toContain('ЭА220-26'); // распознанный код назван
    expect(card.action).toContain('AE27'); // перенести в примечание
    expect(card.action).toContain('AG27');
  });

  it('УИО r37: «ЭЗК 283» — искажённый номер без валидного кода → карточка «исправьте или перенесите»', () => {
    const cards = detectCommentInconsistencies(ref('УИО', 37), {
      Q: '7.7.2026',
      AG: 'ЭЗК 283',
    }, SNAPSHOT);
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('foreign_text_in_ag');
    expect(cards[0].cell).toBe('AG37');
    expect(cards[0].mechanism).toContain('не содержит распознаваемого номера');
    expect(cards[0].action).toContain('исправьте');
  });

  it('УКСиМП r346: «Отдел ФК и С» — текст вовсе без кода → карточка', () => {
    const cards = detectCommentInconsistencies(ref('УКСиМП', 346), {
      Q: '19.01.2026',
      AG: 'Отдел ФК и С',
    }, SNAPSHOT);
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('foreign_text_in_ag');
    expect(cards[0].excerpt).toBe('Отдел ФК и С');
  });

  it('чистый код, список кодов и скобочная пара кодов — НЕ карточка', () => {
    // УЭР r5: одиночный код; УЭР r28: список ЭЕП (план дробится на процедуры);
    // УД r45: «ЭА160-26 (ЭА141-26)» — скобки-разделители между кодами.
    for (const [row, ag] of [
      [5, 'ЭЗК426-25'],
      [28, 'ЭЕП123-26,ЭЕП124-26,ЭЕП125-26,ЭЕП128-26'],
      [45, 'ЭА160-26 (ЭА141-26)'],
    ] as const) {
      expect(detectCommentInconsistencies(ref('УЭР', row), { Q: '15.01.2026', AG: ag }, SNAPSHOT))
        .toHaveLength(0);
    }
  });

  it('заглушки Х/-/точка и пустая AG — молчание', () => {
    for (const ag of ['Х', 'X', '-', '—', '.', '', '  ']) {
      expect(detectCommentInconsistencies(ref('УО', 2), { Q: 'X', AG: ag }, SNAPSHOT)).toHaveLength(0);
    }
  });
});

describe('границы подсистемы', () => {
  it('строка без комментариев и без Q — молчание', () => {
    expect(detectCommentInconsistencies(ref('УО', 1), { Q: 'X' }, SNAPSHOT)).toHaveLength(0);
    expect(detectCommentInconsistencies(ref('УО', 1), {}, SNAPSHOT)).toHaveLength(0);
  });

  it('канон п.27: карточка не несёт статуса — только адрес, механизм и действие «обновите»', () => {
    const cards = detectCommentInconsistencies(ref('УД', 14), {
      Q: '27.04.2026',
      AF: 'в стадии окончания подачи заявок',
    }, SNAPSHOT);
    expect(cards).toHaveLength(1);
    // Форма аннотации — полный провенанс, никаких полей статуса закупки
    expect(Object.keys(cards[0]).sort()).toEqual(
      ['action', 'cell', 'column', 'excerpt', 'kind', 'mechanism', 'rowKey'].sort(),
    );
  });
});
