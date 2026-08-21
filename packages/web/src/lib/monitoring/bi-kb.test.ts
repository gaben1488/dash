/**
 * Страж полноты карточек базы знаний витрины (канон п.135).
 *
 * Карточка без «скоупа и момента» или без «почему может разойтись» —
 * половина карточки: читатель не сможет ответить ни за какой периметр
 * посчитано число, ни почему оно не сходится со сводом. Проверять глазами
 * шесть карточек при каждой правке текста никто не будет, поэтому проверяет
 * тест.
 *
 * Отдельно стережётся ПРОВЕНАНС (п.104): «Откуда» обязано называть книгу и
 * колонку. Фраза «данные системы» вместо колонки книги — та самая потеря
 * родословной, ради которой карточку и заводили.
 */
import { describe, expect, it } from 'vitest';
import { BI_KB, biKbProps, type BiKbCard } from './bi-kb';

const entries = Object.entries(BI_KB) as [string, BiKbCard][];

describe('BI_KB — шесть разрезов витрины', () => {
  it('карточка заведена у каждого из шести разрезов', () => {
    expect(entries.map(([k]) => k).sort()).toEqual([
      'budget_savings',
      'carry_over',
      'customer_concentration',
      'joint_purchases',
      'rejoined_fates',
      'zero_reduction',
    ]);
  });

  it.each(entries)('«%s»: все обязательные разделы п.135 заполнены', (_key, card) => {
    for (const field of ['whatIs', 'howCalc', 'dataSource', 'scopeMoment', 'divergence', 'actions'] as const) {
      expect(card[field].trim().length, `раздел «${field}» пуст`).toBeGreaterThan(40);
    }
  });

  it.each(entries)('«%s»: провенанс называет книгу и колонку, а не «данные системы»', (_key, card) => {
    expect(card.dataSource).toMatch(/Ежедневный мониторинг/u);
    expect(card.dataSource).toMatch(/колонк/iu);
    expect(card.dataSource).not.toMatch(/данные системы|из базы|из движка/iu);
  });

  it.each(entries)('«%s»: скоуп называет и периметр, и момент чтения', (_key, card) => {
    expect(card.scopeMoment).toMatch(/периметр/iu);
    expect(card.scopeMoment).toMatch(/момент/iu);
  });

  it.each(entries)('«%s»: «что делать» ведёт к строкам-основаниям (п.119)', (_key, card) => {
    expect(card.actions).toMatch(/строк|реестр|лист|книг/iu);
  });

  it('тексты карточек написаны по-русски без внутренних ключей', () => {
    for (const [key, card] of entries) {
      const all = [card.whatIs, card.howCalc, card.dataSource, card.scopeMoment, card.divergence, card.actions].join(' ');
      // Латиница допустима только в адресе ячейки — одиночной заглавной
      // буквой в скобках. Всё прочее означает просочившийся ключ движка.
      const latin = all.match(/[A-Za-z]{2,}/gu) ?? [];
      expect(latin, `в карточке «${key}» просочилась латиница: ${latin.join(', ')}`).toEqual([]);
    }
  });
});

describe('biKbProps', () => {
  it('не роняет «скоуп» и «расхождение» — ради них карточка и живёт отдельно', () => {
    const props = biKbProps(BI_KB.budget_savings);
    expect(props.scopeMoment).toBe(BI_KB.budget_savings.scopeMoment);
    expect(props.divergence).toBe(BI_KB.budget_savings.divergence);
  });

  it('незаполненный необязательный раздел не превращается в пустую строку', () => {
    const bare: BiKbCard = {
      whatIs: 'что', howCalc: 'как', dataSource: 'откуда',
      scopeMoment: 'периметр и момент', divergence: 'почему расходится', actions: 'что делать',
    };
    const props = biKbProps(bare);
    expect('example' in props).toBe(false);
    expect('pitfalls' in props).toBe(false);
  });
});
