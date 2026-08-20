// @vitest-environment jsdom
// ── Обещания примитивов, записанные тестом.
//
//    Проверяется не «нарисовалось ли», а то, ради чего примитивы заведены:
//    честная пустота вместо нуля, скоуп рядом с числом, словесный дубль
//    цвета, доступность прокручиваемой таблицы, запрет карточки в карточке.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardFooter } from './card';
import { Stat } from './stat';
import { Chip } from './chip';
import { DataTable, THead, TBody, Tr, Th, Td } from './data-table';
import { applyDensity } from './density';
import { legendLine, seriesPalette, gridProps, axisProps } from './chart-theme';

describe('Карточка', () => {
  it('несёт заголовок, скоуп и объяснение', () => {
    render(
      <Card>
        <CardHeader title="Исполнение плана" scope="2026 · год · на 18.08" note="Считано по листу СВОД." />
        <CardFooter>Источник: книга «Свод».</CardFooter>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Исполнение плана' })).toBeTruthy();
    expect(screen.getByText('2026 · год · на 18.08')).toBeTruthy();
    expect(screen.getByText('Считано по листу СВОД.')).toBeTruthy();
  });

  it('вложенная карточка теряет тень сама, без напоминания автору страницы', () => {
    const { container } = render(
      <Card>
        <Card>
          <span>внутри</span>
        </Card>
      </Card>,
    );
    const cards = container.querySelectorAll('div.rounded-\\[var\\(--radius-card\\)\\]');
    expect(cards.length).toBe(2);
    const outer = cards[0]!;
    const inner = cards[1]!;
    expect(outer.className).toContain('shadow-[var(--elevation-1)]');
    expect(inner.className).not.toContain('shadow-[var(--elevation-1)]');
  });
});

describe('Число-показатель', () => {
  it('без базы пишет причину, а не ноль', () => {
    render(<Stat label="Экономия" value={null} emptyReason="План на год не проставлен — считать не от чего" />);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText('План на год не проставлен — считать не от чего')).toBeTruthy();
  });

  it('пустота без объяснения всё равно не превращается в ноль', () => {
    const { container } = render(<Stat label="Экономия" value={null} />);
    expect(container.querySelector('[data-empty]')).toBeTruthy();
  });

  it('держит скоуп рядом с числом', () => {
    const { container } = render(<Stat label="План" value="1 240,5" unit="млн ₽" scope="2026 · год" />);
    expect(container.querySelector('[data-scope]')?.textContent).toBe('2026 · год');
    expect(container.querySelector('[data-numeric]')?.textContent).toBe('1 240,5');
  });

  it('дублирует направление изменения словом, а не только цветом', () => {
    render(
      <Stat
        label="Нарушений"
        value="14"
        delta={{ text: '+3', tone: 'bad', meaning: 'больше, чем неделю назад' }}
      />,
    );
    expect(screen.getByText('больше, чем неделю назад')).toBeTruthy();
  });
});

describe('Чип', () => {
  it('метка остаётся текстом и кнопкой не притворяется', () => {
    render(<Chip tone="warn">ЕП</Chip>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('ЕП')).toBeTruthy();
  });

  it('переключатель объявляет нажатость диктору, а не только заливкой', () => {
    render(
      <Chip pressed onClick={() => {}}>
        Только ЕП
      </Chip>,
    );
    expect(screen.getByRole('button', { pressed: true })).toBeTruthy();
  });
});

describe('Таблица', () => {
  function table() {
    return render(
      <DataTable caption="Закупки управления образования · 2026 · на 18.08">
        <THead>
          <Tr>
            <Th>Предмет</Th>
            <Th numeric>Сумма</Th>
          </Tr>
        </THead>
        <TBody>
          <Tr>
            <Td>Ремонт кровли</Td>
            <Td numeric>12 400,00</Td>
          </Tr>
        </TBody>
      </DataTable>,
    );
  }

  it('имеет подпись со скоупом — таблица без подписи запрещена', () => {
    const { container } = table();
    expect(container.querySelector('caption')?.textContent).toContain('на 18.08');
  });

  it('прокручиваемая область берётся с клавиатуры', () => {
    const { container } = table();
    const region = container.querySelector('[role="region"]') as HTMLElement;
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toContain('Закупки управления образования');
  });

  it('числовая ячейка встаёт вправо и помечается для табличных цифр', () => {
    const { container } = table();
    const cell = container.querySelector('td[data-numeric]') as HTMLElement;
    expect(cell.textContent).toBe('12 400,00');
    expect(cell.className).toContain('text-right');
  });

  it('заголовок колонки объявлен как заголовок столбца', () => {
    const { container } = table();
    expect(container.querySelector('th')?.getAttribute('scope')).toBe('col');
  });
});

describe('Плотность', () => {
  it('компактный режим — умолчание и выражается отсутствием отметки', () => {
    const root = document.createElement('div');
    root.setAttribute('data-density', 'comfortable');
    applyDensity('compact', root);
    expect(root.hasAttribute('data-density')).toBe(false);
  });

  it('просторный режим ставит одно слово, разметка не меняется', () => {
    const root = document.createElement('div');
    applyDensity('comfortable', root);
    expect(root.getAttribute('data-density')).toBe('comfortable');
  });
});

describe('Облик графика', () => {
  it('краска ряда — переменная, поэтому тема переключается без перерисовки', () => {
    expect(seriesPalette(3)).toEqual(['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)']);
    expect(gridProps.stroke).toBe('var(--chart-grid)');
    expect(axisProps.tick.fill).toBe('var(--ink-muted)');
  });

  it('вертикальной решётки нет: вторая сетка не добавляет сведений', () => {
    expect(gridProps.vertical).toBe(false);
  });

  it('легенда собирается словами — цвет исчезает на чёрно-белой печати', () => {
    expect(legendLine([{ label: 'ФБ', value: '120 млн' }, { label: 'МБ', value: '80 млн' }]))
      .toBe('ФБ — 120 млн · МБ — 80 млн');
  });
});
