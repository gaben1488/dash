// @vitest-environment jsdom
// ── Стражи надстройки над готовым (канон п.114).
//
//    Проверяется не «нарисовалось ли» — это и так видно. Проверяется ровно
//    то, ЧЕМ наши примитивы отличаются от готовых из библиотеки, потому что
//    именно это отличие тихо теряется при следующей правке:
//
//      • кнопка не отправляет форму молча и не меняет ширину в ожидании;
//      • у режима названо последствие, а не только подпись;
//      • ненастроенная сверка идёт тревожным тоном, а не благополучным;
//      • у неблагополучного состояния всегда есть «что делать»;
//      • график без данных не отдаёт пустое полотно;
//      • доля всегда названа дважды — по счёту и по деньгам;
//      • строка без «№ п/п» говорит об этом словом;
//      • формульная колонка объявлена диктору, а не только знаком.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Автоматическая уборка библиотеки тестов включается только при глобальных
// именах vitest; здесь их нет, поэтому уборка объявлена явно. Без неё
// разметка предыдущего случая остаётся в документе и поиск по тексту
// находит два совпадения вместо одного.
afterEach(cleanup);

// В jsdom нет наблюдателя за размером, а Radix меряет им всплывающий слой.
// Заглушка нужна, чтобы раскрытие происхождения вообще смонтировалось: без
// неё падает не наш код, а измерение внутри библиотеки.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import { Button } from './button';
import { Segmented } from './segmented';
import { Origin } from './origin';
import { FreshnessMark, worstState, freshnessTone } from './freshness';
import { ChartFrame, SharePair } from './chart-frame';
import { DataTable, THead, TBody, Tr, Th, Td, RowAddress, RowSignals } from './data-table';
import { Drawer } from './drawer';
import { problemText } from './toast';

describe('Кнопка', () => {
  it('по умолчанию не отправляет форму: type=button, а не submit', () => {
    render(<Button>Обновить</Button>);
    expect(screen.getByRole('button', { name: 'Обновить' }).getAttribute('type')).toBe('button');
  });

  it('в ожидании объявляет работу диктору и не подменяет подпись', () => {
    render(<Button busy>Перечитать книгу</Button>);
    // Подпись осталась той же — ширина кнопки не меняется, соседи не едут.
    const button = screen.getByRole('button', { name: 'Перечитать книгу' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/загрузка/i)).toBeNull();
  });

  it('кнопка-значок имеет имя словом, а не пустоту', () => {
    render(<Button iconOnly aria-label="Обновить снимок" icon={<span />} />);
    expect(screen.getByRole('button', { name: 'Обновить снимок' })).toBeTruthy();
  });

  it('необратимое действие не залито тревожным цветом — только обведено', () => {
    render(<Button tone="danger">Снять снимок</Button>);
    const cls = screen.getByRole('button', { name: 'Снять снимок' }).className;
    expect(cls).toContain('bg-transparent');
    expect(cls).toContain('var(--data-bad)');
  });
});

describe('Переключатель режима', () => {
  const OPTIONS = [
    { value: 'руб' as const, hint: 'суммы читаются в рублях', label: 'Рубли' },
    { value: 'тыс' as const, hint: 'суммы читаются в тысячах рублей', label: 'Тысячи' },
  ];

  it('это настоящая радиогруппа: переход стрелками и объявление достаются от платформы', () => {
    render(<Segmented legend="Шкала денег" options={OPTIONS} value="тыс" onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(2);
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
  });

  it('у режима названо последствие, а не только подпись', () => {
    render(<Segmented legend="Шкала денег" options={OPTIONS} value="тыс" onChange={() => {}} />);
    // Последствие доступно диктору как описание переключателя: выбор
    // единицы меняет цену ошибки в тысячу раз, и об этом надо сказать.
    expect(screen.getByRole('radio', { name: /суммы читаются в рублях/ })).toBeTruthy();
  });

  it('сообщает выбор наружу', () => {
    let chosen = '';
    render(<Segmented legend="Шкала денег" options={OPTIONS} value="тыс" onChange={(v) => { chosen = v; }} />);
    fireEvent.click(screen.getAllByRole('radio')[0]!);
    expect(chosen).toBe('руб');
  });
});

describe('Происхождение числа', () => {
  it('имя кнопки — вопрос читателя целиком, а не слово «подробнее»', () => {
    render(
      <Origin
        metric="Экономия по торгам"
        source="Книга «Ежедневный мониторинг»"
        howSourceCounts="НМЦК минус цена победителя"
        match="exact"
      >
        84,2
      </Origin>,
    );
    expect(screen.getByRole('button', { name: 'Откуда число: Экономия по торгам' })).toBeTruthy();
  });

  it('раскрывает источник, счёт источника и адрес', () => {
    render(
      <Origin
        metric="Плановая сумма"
        source="Книга «Свод», лист «СВОД ТД-ПМ»"
        howSourceCounts="=СУММ(K5:K318)"
        match="divergent"
        sheetRef="СВОД ТД-ПМ · K319"
        rowAddress="строка 218 · № п/п 145"
      >
        1 240,5
      </Origin>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Откуда число/ }));
    // Расхождение с источником поднято наверх словом, а не спрятано в сноску.
    expect(screen.getByText('Считаем иначе, чем источник')).toBeTruthy();
    expect(screen.getByText('=СУММ(K5:K318)')).toBeTruthy();
    expect(screen.getByText('строка 218 · № п/п 145')).toBeTruthy();
  });
});

describe('Доверие к числу', () => {
  it('ненастроенная сверка — это «осторожно», а не «хорошо»', () => {
    // Главное правило, взятое у зрелых панелей: отсутствие доказательства
    // не равно доказательству благополучия.
    expect(freshnessTone('uncovered')).toBe('warn');
    expect(freshnessTone('unmeasurable')).toBe('warn');
    expect(freshnessTone('verified')).toBe('good');
  });

  it('причина и действие достаются диктору целиком, а не только по наведению', () => {
    render(
      <FreshnessMark
        info={{
          state: 'stale',
          reason: 'снимок старше суток',
          whatToDo: 'нажать «Обновить» в шапке',
        }}
        readAt="18.08, 09:14"
      />,
    );
    expect(screen.getByText(/снимок старше суток\. нажать «Обновить» в шапке/)).toBeTruthy();
  });

  it('на карточке остаётся один значок — самый тяжёлый', () => {
    expect(worstState(['fresh', 'stale', 'verified'])).toBe('stale');
    expect(worstState(['stale', 'failed'])).toBe('failed');
    expect(worstState(['verified', 'uncovered'])).toBe('uncovered');
    expect(worstState([])).toBeNull();
  });
});

describe('Рама графика', () => {
  it('без данных не отдаёт пустое полотно, а называет причину', () => {
    const { container } = render(
      <ChartFrame
        unit="тыс ₽"
        emptyReason="За неделю нет ни одной завершённой процедуры"
        summary="Данных за период нет"
      />,
    );
    expect(container.querySelector('[data-empty]')).toBeTruthy();
    expect(screen.getByText('За неделю нет ни одной завершённой процедуры')).toBeTruthy();
  });

  it('единица измерения названа всегда: столбик без единицы читается втрое неверно', () => {
    const { container } = render(
      <ChartFrame unit="тыс ₽" summary="Факт держится вблизи плана">
        <svg />
      </ChartFrame>,
    );
    expect(container.querySelector('[data-unit]')?.textContent).toBe('тыс ₽');
  });

  it('текстовый дубль виден всем, а не спрятан для диктора', () => {
    render(
      <ChartFrame unit="закупок" summary="Доля единственного поставщика падает четвёртую неделю">
        <svg />
      </ChartFrame>,
    );
    const caption = screen.getByText('Доля единственного поставщика падает четвёртую неделю');
    expect(caption.className).not.toContain('sr-only');
  });
});

describe('Двойная доля', () => {
  it('называет обе доли: счётную и денежную', () => {
    render(<SharePair byCount="80,4 %" byMoney="12,1 %" of="закупки у единственного поставщика" />);
    expect(screen.getByText('по счёту закупок')).toBeTruthy();
    expect(screen.getByText('по деньгам')).toBeTruthy();
    expect(screen.getByText('80,4 %')).toBeTruthy();
    expect(screen.getByText('12,1 %')).toBeTruthy();
  });

  it('без базы пишет причину, а не ноль процентов', () => {
    const { container } = render(
      <SharePair byCount={null} byMoney={null} of="закупки у единственного поставщика" />,
    );
    expect(container.querySelector('[data-empty]')).toBeTruthy();
    expect(screen.queryByText('0 %')).toBeNull();
  });
});

describe('Реестровая таблица', () => {
  function renderTable() {
    return render(
      <DataTable caption="Закупки · 2026 · на 18.08">
        <THead>
          <tr>
            <Th>Адрес</Th>
            <Th numeric formula>Экономия</Th>
            <Th>Замечания</Th>
          </tr>
        </THead>
        <TBody>
          <Tr signalTone="bad">
            <Td><RowAddress sheet="СВОД ТД-ПМ" row={231} seq={null} /></Td>
            <Td numeric formula>—</Td>
            <Td><RowSignals signals={[{ label: 'не обеспечено финансированием', tone: 'bad' }]} /></Td>
          </Tr>
          <Tr>
            <Td><RowAddress row={214} seq="141" /></Td>
            <Td numeric formula>181,6</Td>
            <Td><RowSignals signals={[]} /></Td>
          </Tr>
        </TBody>
      </DataTable>,
    );
  }

  it('формульная колонка объявлена диктору словами, а не только знаком «равно»', () => {
    renderTable();
    expect(screen.getByText(/колонка считается формулой листа, только для чтения/)).toBeTruthy();
  });

  it('строка без «№ п/п» говорит об этом словом: завтра её иначе не найти', () => {
    renderTable();
    expect(screen.getByText(/№ п\/п не проставлен/)).toBeTruthy();
  });

  it('двойной адрес переживает сортировку листа', () => {
    const { container } = renderTable();
    const addresses = container.querySelectorAll('[data-address]');
    expect(addresses.length).toBe(2);
    // Номер строки нужен, чтобы найти закупку сейчас; «№ п/п» — чтобы найти
    // её завтра, когда лист пересортируют. Поэтому в адресе есть оба.
    expect(addresses[1]!.textContent).toContain('строка 214');
    expect(addresses[1]!.textContent).toContain('№ п/п 141');
  });

  it('полоса замечания рисуется тенью, а не рамкой: содержимое строки не сдвигается', () => {
    const { container } = renderTable();
    const marked = container.querySelector('tr[data-signal="bad"]') as HTMLElement | null;
    expect(marked).toBeTruthy();
    expect(marked!.style.boxShadow).toContain('inset 3px 0 0');
    expect(marked!.style.borderLeft).toBe('');
  });

  it('отсутствие замечаний — это утверждение, а не пустая ячейка', () => {
    renderTable();
    expect(screen.getByText('замечаний нет')).toBeTruthy();
  });
});

describe('Шторка снизу', () => {
  it('имеет имя для диктора и подписанную кнопку закрытия по-русски', () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Текущий ремонт кровли" description="Строка 218 · № п/п 145">
        <p>подробность</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Текущий ремонт кровли' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeTruthy();
  });

  it('закрывается по Esc — это приходит от готового диалога, своего кода здесь нет', () => {
    let open = true;
    render(
      <Drawer open onOpenChange={(next) => { open = next; }} title="Подробность строки">
        <p>содержимое</p>
      </Drawer>,
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(open).toBe(false);
  });
});

describe('Уведомление об отказе', () => {
  it('несёт механизм, действие и адрес подробности (канон п.53)', () => {
    const text = problemText({
      reason: 'сервер не ответил за тридцать секунд',
      whatToDo: 'проверьте, что служба запущена, и повторите',
      where: 'вкладка «Система»',
    });
    expect(text).toBe(
      'сервер не ответил за тридцать секунд. проверьте, что служба запущена, и повторите. Подробность — вкладка «Система».',
    );
  });

  it('без адреса подробности фраза не обрывается на полуслове', () => {
    const text = problemText({ reason: 'файл не найден', whatToDo: 'выберите книгу заново' });
    expect(text).toBe('файл не найден. выберите книгу заново.');
  });
});
