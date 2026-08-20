// @vitest-environment jsdom
/**
 * Стражи яруса «Происхождение» в карточке показателя (канон п.104).
 *
 * Ярус обещает читателю четыре вещи, и проверяются именно они, а не вёрстка:
 *   1) у числа названы источник, счёт источника и адрес первоисточника —
 *      для показателя каждого из четырёх классов;
 *   2) сирота названа нашей инициативой ВСЛУХ, а расхождение — предупреждением
 *      с описанием разницы, а не молчащей пометкой;
 *   3) показателя нет в карте — блока нет вовсе (честная пустота), и ни один
 *      экран от этого не падает;
 *   4) единый дом работает: ярус приходит в обе карточки базы знаний, и одной
 *      родословной достаточно, чтобы подсказка открылась там, где полной
 *      записи БЗ ещё нет.
 *
 * Тёмная тема проверяется отдельно: панель KBTooltip всегда тёмная, даже когда
 * страница светлая, поэтому `dark:`-варианты Tailwind там не сработали бы —
 * страж следит, чтобы у тона `dark` цвет был задан без них.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MetricProvenance } from './MetricProvenance';
import { DivergenceMark } from './DivergenceMark';
import { TooltipProvider } from '../ui/tooltip';

// Radix Popover меряет позицию через ResizeObserver, которого в jsdom нет.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// Хранилище тянет за собой api-слой; ярусу происхождения оно не нужно —
// подменяем целиком, чтобы тест проверял карточку, а не загрузку дашборда.
vi.mock('../../store', () => ({ useStore: () => 'year' }));

const EXACT = 'plan_count';
// Знак «Отклонения» сведён к листовому 18.08.2026, и deviation перестал быть
// расхождением. Представитель класса — доля ЕП: лист знает её только в
// ДЕНЬГАХ (`=O26/O29`), мы считаем в ШТУКАХ, числа расходятся кратно.
const DIVERGENT = 'ep_share_pct';
const ORPHAN = 'trust_overall';
const GAP = 'fb_execution_pct';
/** Расхождение без записи в METRIC_KB — родословная тут единственный житель. */
const LINEAGE_ONLY = 'lifecycle_type_unknown';

afterEach(cleanup);

describe('ярус происхождения: показатель каждого класса', () => {
  it('совпадение: назван лист, его формула и адрес колонки', () => {
    render(<MetricProvenance metricKey={EXACT} />);
    const block = screen.getByTestId('metric-provenance');
    expect(block.getAttribute('data-kind')).toBe('exact');
    expect(within(block).getByText('Лист «СВОД ТД-ПМ»')).toBeTruthy();
    expect(within(block).getByTestId('provenance-verdict').textContent).toContain(
      'Считаем так же',
    );
    expect(block.textContent).toContain('COUNTIFS');
    expect(block.textContent).toContain('СВОД ТД-ПМ!D');
  });

  it('расхождение: предупреждение и разница названы словами, а не пометкой', () => {
    render(<MetricProvenance metricKey={DIVERGENT} />);
    const block = screen.getByTestId('metric-provenance');
    expect(block.getAttribute('data-kind')).toBe('divergent');
    expect(within(block).getByTestId('provenance-verdict').textContent).toContain(
      'Считаем иначе',
    );
    // Счёт источника дословно + в чём именно разница.
    expect(block.textContent).toContain('=O26/O29');
    const note = within(block).getByTestId('provenance-note');
    expect(note.textContent).toContain('В чём разница:');
    expect(note.textContent).toContain('РАСХОЖДЕНИЕ БАЗЫ');
  });

  it('сирота: «наша инициатива» сказана вслух и подкреплена обоснованием', () => {
    render(<MetricProvenance metricKey={ORPHAN} />);
    const block = screen.getByTestId('metric-provenance');
    expect(block.getAttribute('data-kind')).toBe('orphan');
    expect(within(block).getByText('Наша инициатива')).toBeTruthy();
    expect(within(block).getByTestId('provenance-verdict').textContent).toContain(
      'в источниках не значится',
    );
    expect(within(block).getByTestId('provenance-note').textContent).toContain(
      'Обоснование:',
    );
  });

  it('пробел: источник дал данные, но такого показателя не считает', () => {
    render(<MetricProvenance metricKey={GAP} />);
    const block = screen.getByTestId('metric-provenance');
    expect(block.getAttribute('data-kind')).toBe('gap');
    expect(within(block).getByText('Лист «СВОД ТД-ПМ»')).toBeTruthy();
    expect(within(block).getByTestId('provenance-verdict').textContent).toContain(
      'такого показателя не считает',
    );
  });

  it('показателя нет в карте — блока нет вовсе, и ничего не падает', () => {
    const { container } = render(<MetricProvenance metricKey="нет_такого_показателя" />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('metric-provenance')).toBeNull();
  });
});

describe('обе темы читаются', () => {
  it('тревожный цвет расхождения задан и в светлой, и в тёмной панели', () => {
    const { container: themed } = render(
      <MetricProvenance metricKey={DIVERGENT} tone="themed" />,
    );
    const themedVerdict = within(themed as HTMLElement).getByTestId('provenance-verdict');
    // Светлая тема: янтарный 700; тёмная тема страницы — свой вариант.
    expect(themedVerdict.className).toContain('text-amber-700');
    expect(themedVerdict.className).toContain('dark:text-amber-400');

    cleanup();

    const { container: dark } = render(<MetricProvenance metricKey={DIVERGENT} tone="dark" />);
    const darkVerdict = within(dark as HTMLElement).getByTestId('provenance-verdict');
    // Панель KBTooltip тёмная всегда: цвет обязан быть прямым, без `dark:`,
    // иначе на светлой странице текст возьмёт светлый вариант на тёмном стекле.
    expect(darkVerdict.className).toContain('text-amber-300');
    expect(darkVerdict.className).not.toContain('dark:');
  });

  it('нейтральные классы не красятся тревожным цветом — интонация не врёт', () => {
    render(<MetricProvenance metricKey={ORPHAN} />);
    const verdict = screen.getByTestId('provenance-verdict');
    expect(verdict.className).not.toContain('amber');
    expect(verdict.className).not.toContain('red');
  });
});

describe('значок расхождения у числа', () => {
  it('стоит у расходящегося показателя и объясняет механизм в подписи', () => {
    render(<DivergenceMark metricKey={DIVERGENT} />);
    const mark = screen.getByTestId('divergence-mark');
    expect(mark.getAttribute('title')).toContain('На источнике считается иначе');
    expect(mark.getAttribute('aria-label')).toContain('Лист «СВОД ТД-ПМ»');
    // Доступность: значок читается голосом, а не только глазами.
    expect(mark.getAttribute('role')).toBe('img');
  });

  it('не появляется там, где наш счёт сходится, и там, где карта молчит', () => {
    const { container } = render(
      <>
        <DivergenceMark metricKey={EXACT} />
        <DivergenceMark metricKey="нет_такого_показателя" />
      </>,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('единый дом: ярус приходит в обе карточки базы знаний', () => {
  it('KbHover открывает подсказку по одной родословной, когда записи БЗ ещё нет', async () => {
    const { KbHover } = await import('../contract/KbHover');
    render(
      <KbHover metricKey={LINEAGE_ONLY}>
        <span>549</span>
      </KbHover>,
    );
    // Обёртка есть: у числа появился фокусируемый триггер подсказки.
    const trigger = screen.getByText('549').closest('span[tabindex]');
    expect(trigger).not.toBeNull();
    // И значок расхождения — для тех, кто никогда не наведёт.
    expect(screen.getByTestId('divergence-mark')).toBeTruthy();
    // Отдельный срок: этот тест первым тянет KbHover динамическим импортом и
    // платит за трансформацию всего его графа модулей. Пять секунд по
    // умолчанию на это не хватает, и падение выглядит как ошибка логики,
    // хотя это стоимость сборки. Проверка от срока не зависит.
  }, 30_000);

  it('KbHover ведёт себя так, будто обёртки не было, когда сказать нечего', async () => {
    const { KbHover } = await import('../contract/KbHover');
    const { container } = render(
      <KbHover metricKey="нет_такого_показателя">
        <span>42</span>
      </KbHover>,
    );
    expect(container.querySelector('span[tabindex]')).toBeNull();
    expect(container.textContent).toBe('42');
  });

  it('KBTooltip открывает подсказку по одной родословной и ставит значок расхождения', async () => {
    const { KBTooltip } = await import('../ui/kb-tooltip');
    // KBTooltip рассчитан на общий провайдер приложения — в тесте он свой.
    const { container } = render(
      <TooltipProvider>
        <KBTooltip metric={LINEAGE_ONLY}>
          <span>549</span>
        </KBTooltip>
      </TooltipProvider>,
    );
    expect(container.querySelector('.cursor-help')).not.toBeNull();
    expect(screen.getByTestId('divergence-mark')).toBeTruthy();
  });

  it('KBTooltip не оборачивает число, о котором нечего сказать', async () => {
    const { KBTooltip } = await import('../ui/kb-tooltip');
    const { container } = render(
      <TooltipProvider>
        <KBTooltip metric="нет_такого_показателя">
          <span>42</span>
        </KBTooltip>
      </TooltipProvider>,
    );
    expect(container.querySelector('.cursor-help')).toBeNull();
    expect(container.textContent).toBe('42');
  });
});
