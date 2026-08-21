// @vitest-environment jsdom
/**
 * Стражи шести разрезов витрины «где деньги · где риск · где затык».
 *
 * Проверяются ОБЕЩАНИЯ разрезов, а не их оформление:
 *   1) заголовок — утверждение на живых числах, а не ярлык блока: читатель
 *      обязан узнать новость, не разглядывая график;
 *   2) дверь к строкам-основаниям открывается ТЕМ ЖЕ ключом, каким витрина
 *      сложила число (п.119): клик по заказчику отдаёт написание книги, клик
 *      по году — суффикс кода;
 *   3) разрыв «ВСЕГО минус расписанное» показан отдельным числом и не
 *      сглаживается — иначе экран решил бы за читателя, какая сумма верна;
 *   4) две доли бесторговых — в счёте и в деньгах — показаны РЯДОМ: разница
 *      между ними и есть содержание разреза;
 *   5) двойной счёт совместных строк назван словами, а не «починен» тихо;
 *   6) три пустоты различимы: «лист не отдан», «лист прочитан, пометок нет» и
 *      «в срезе нет строк».
 */
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// jsdom не знает ResizeObserver, на котором стоит адаптивный контейнер
// recharts. Заглушка ничего не измеряет: числа проверяются текстовым дублём.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const { CustomerWeight } = await import('./CustomerWeight');
const { BudgetSavingsCard } = await import('./BudgetSavings');
const { ZeroReductionCard } = await import('./ZeroReduction');
const { CarryOverCard } = await import('./CarryOver');
const { JointPurchasesCard } = await import('./JointPurchases');
const { RejoinedFatesCard } = await import('./RejoinedFates');
const { TooltipProvider } = await import('../ui/tooltip');

const {
  budgetSavings, carryOver, customerConcentration, jointComparison,
  rejoinedFates, zeroReduction,
} = await import('../../lib/monitoring/bi');

type Proc = Parameters<typeof customerConcentration>[0][number];

function proc(over: Partial<Proc> = {}): Proc {
  return {
    sheet: '1. УЭР', row: 10, dept: 'УЭР', ppNum: '1',
    customer: 'МКУ «Заказчик»', code: 'ЭА1-26', codeNote: null, method: 'ЭА', year: 26,
    subject: 'Поставка бумаги', nmck: 1_000_000,
    applicationDate: '01.03.2026', publicationDate: '05.03.2026',
    deadlineDate: '14.03.2026', auctionDate: '18.03.2026',
    auctionPrice: 900_000, savingsTotal: 100_000,
    savingsMb: 100_000, savingsKb: null, savingsFb: null, savingsManual: false,
    selfCheck: 'верно', winner: 'ООО «Поставщик» ИНН 1234567890',
    winnerName: 'ООО «Поставщик»', winnerInn: '1234567890', outcome: null,
    stage: 'awarded', reductionRub: 100_000, reductionPct: 10, comment: null,
    customerNormalized: 'мку заказчик', savingsSplitSum: 100_000,
    controlAgrees: true, controlGapRub: 0, joint: false, innRepeated: false,
    durations: { toPublication: 4, toDeadline: 9, toAuction: 4, total: 17 },
    defects: [],
    ...over,
  } as Proc;
}

const PERIOD = 'данные книги на 18.08.2026, 10:00';

/**
 * Карточки базы знаний висят на Radix-подсказке, а она требует провайдера от
 * корня приложения. В продукте его ставит `App`; в тесте — эта обёртка.
 */
function show(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

afterEach(cleanup);

// ── §1. Где деньги: заказчики ────────────────────────────────────────

describe('CustomerWeight', () => {
  const rows = [
    proc({ customer: 'Совместный аукцион ШКОЛЫ', nmck: 700 }),
    proc({ customer: 'МКУ ЕДДС', nmck: 200 }),
    proc({ customer: 'МКУ ЕРУС', nmck: 100 }),
  ];

  it('заголовок называет, сколько заказчиков набирают половину денег', () => {
    show(
      <CustomerWeight concentration={customerConcentration(rows)} periodLabel={PERIOD} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent)
      .toMatch(/Половину денег книги набирают 1 заказчик из 3/u);
  });

  it('дверь отдаёт написание книги — то же, каким сложено число', () => {
    const onPickCustomer = vi.fn();
    show(
      <CustomerWeight
        concentration={customerConcentration(rows)}
        periodLabel={PERIOD}
        onPickCustomer={onPickCustomer}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Совместный аукцион ШКОЛЫ' }));
    expect(onPickCustomer).toHaveBeenCalledWith('Совместный аукцион ШКОЛЫ');
  });

  it('без строк говорит о пустом знаменателе, а не о нулевой концентрации', () => {
    show(
      <CustomerWeight concentration={customerConcentration([])} periodLabel={PERIOD} />);
    expect(screen.getByText(/пустой знаменатель, а не нулевая концентрация/u)).toBeTruthy();
  });
});

// ── §2. Где деньги: бюджеты ──────────────────────────────────────────

describe('BudgetSavingsCard', () => {
  it('разрыв «ВСЕГО минус расписанное» показан отдельно и не сглажен', () => {
    const budget = budgetSavings([
      proc({ savingsTotal: 100, savingsMb: 50, savingsKb: 30, savingsFb: 20, savingsSplitSum: 100 }),
      proc({ savingsTotal: 40, savingsMb: null, savingsKb: null, savingsFb: null, savingsSplitSum: null }),
    ]);
    show(
      <BudgetSavingsCard budget={budget} periodLabel={PERIOD} />);
    expect(screen.getByText('Без адреса бюджета')).toBeTruthy();
    expect(screen.getByText(/бюджетного адреса не имеет/u)).toBeTruthy();
  });

  it('заголовок называет долю местного бюджета в расписанной экономии', () => {
    const budget = budgetSavings([
      proc({ savingsTotal: 100, savingsMb: 60, savingsKb: 40, savingsFb: 0, savingsSplitSum: 100 }),
    ]);
    show(
      <BudgetSavingsCard budget={budget} periodLabel={PERIOD} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent)
      .toMatch(/60 %.*местного бюджета/u);
  });

  it('без экономии вовсе — пустота книги, а не нулевая экономия при торгах', () => {
    const budget = budgetSavings([
      proc({ savingsTotal: null, savingsMb: null, savingsKb: null, savingsFb: null, savingsSplitSum: null }),
    ]);
    show(
      <BudgetSavingsCard budget={budget} periodLabel={PERIOD} />);
    expect(screen.getByText(/пустая книга на данном участке/u)).toBeTruthy();
  });
});

// ── §3. Где риск: нулевое снижение ───────────────────────────────────

describe('ZeroReductionCard', () => {
  const rows = [
    proc({ nmck: 900, auctionPrice: 900, reductionRub: 0 }),
    proc({ nmck: 100, auctionPrice: 50, reductionRub: 50 }),
  ];

  it('показывает обе доли рядом — в процедурах и в деньгах', () => {
    show(
      <ZeroReductionCard zero={zeroReduction(rows)} periodLabel={PERIOD} />);
    expect(screen.getByText('Процедур без снижения')).toBeTruthy();
    expect(screen.getByText('Их начальные цены')).toBeTruthy();
    expect(screen.getByText(/без торга прошли закупки крупнее средней/u)).toBeTruthy();
  });

  it('дверь ставит реестру корзину «снижения не было»', () => {
    const onPickZeroBucket = vi.fn();
    show(
      <ZeroReductionCard
        zero={zeroReduction(rows)}
        periodLabel={PERIOD}
        onPickZeroBucket={onPickZeroBucket}
        onPickMethod={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ЭА/u }));
    expect(screen.getByText(/ставит реестру выше разрез «снижения не было»/u)).toBeTruthy();
  });

  it('несостоявшиеся в знаменатель не идут — там нет цены, а не нулевое снижение', () => {
    const zero = zeroReduction([proc({ stage: 'no_result', auctionPrice: 0, reductionRub: null })]);
    show(
      <ZeroReductionCard zero={zero} periodLabel={PERIOD} />);
    expect(screen.getByText(/пустой знаменатель, а не «все торговались»/u)).toBeTruthy();
  });
});

// ── §4. Где затык: переходящий хвост ─────────────────────────────────

describe('CarryOverCard', () => {
  const rows = [
    proc({ year: 26, nmck: 100 }),
    proc({ year: 26, nmck: 100 }),
    proc({ year: 25, nmck: 800, dept: 'УО' }),
    proc({ year: null, code: null, nmck: 10 }),
  ];

  it('заголовок называет долю хвоста и в строках, и в деньгах', () => {
    show(
      <CarryOverCard carry={carryOver(rows)} periodLabel={PERIOD} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent)
      .toMatch(/процедуры прошлогодней нумерации/u);
  });

  it('строка без кода показана отдельно, а не записана в хвост', () => {
    show(
      <CarryOverCard carry={carryOver(rows)} periodLabel={PERIOD} />);
    expect(screen.getByText('Год без кода')).toBeTruthy();
    expect(screen.getByText(/год неизвестен, а не «прошлый»/u)).toBeTruthy();
  });

  it('дверь отдаёт год из суффикса кода, а не год даты', () => {
    const onPickYear = vi.fn();
    show(
      <CarryOverCard carry={carryOver(rows)} periodLabel={PERIOD} onPickYear={onPickYear} />);
    fireEvent.click(screen.getByRole('button', { name: '2025' }));
    expect(onPickYear).toHaveBeenCalledWith(25);
  });
});

// ── §5. Где деньги: совместные лоты ──────────────────────────────────

describe('JointPurchasesCard', () => {
  const rows = [
    proc({ joint: true, nmck: 1000, auctionPrice: 950, reductionRub: 50 }),
    proc({ joint: false, nmck: 100, auctionPrice: 50, reductionRub: 50 }),
  ];

  it('заголовок сравнивает две стороны числами, а не называет блок', () => {
    show(
      <JointPurchasesCard comparison={jointComparison(rows)} periodLabel={PERIOD} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent)
      .toMatch(/торгуется хуже одиночного/u);
  });

  it('двойной счёт совместных строк назван словами, а не починен тихо', () => {
    show(
      <JointPurchasesCard comparison={jointComparison(rows)} periodLabel={PERIOD} />);
    expect(screen.getByText(/сумма листов расходится с итогом свода книги именно поэтому/u)).toBeTruthy();
  });

  it('без состоявшихся сторон снижение не показывается нулём', () => {
    const comparison = jointComparison([proc({ joint: true, stage: 'no_result', auctionPrice: 0 })]);
    show(
      <JointPurchasesCard comparison={comparison} periodLabel={PERIOD} />);
    expect(screen.getByText(/пустой знаменатель, а не нулевое снижение/u)).toBeTruthy();
  });
});

// ── §6. Где затык: повторный круг ────────────────────────────────────

describe('RejoinedFatesCard', () => {
  const labels = { repeat: 'Повторная процедура', 'fas-complaint': 'Жалоба в ФАС' };

  it('заголовок называет самую частую причину повторного круга', () => {
    const fates = rejoinedFates(
      [
        { fate: 'repeat', fateRaw: 'Повторный аукцион ЭА5-26' },
        { fate: 'repeat', fateRaw: 'повторно' },
        { fate: 'fas-complaint', fateRaw: 'ФАС' },
      ],
      labels,
    );
    show(
      <RejoinedFatesCard fates={fates} periodLabel={PERIOD} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent)
      .toMatch(/повторная процедура — 2 случая/u);
  });

  it('«лист не отдан» и «пометок нет» — две разные новости', () => {
    const empty = { markedRows: 0, totalRows: 0, markedSharePct: null, rows: [] };
    const { unmount } = show(
      <RejoinedFatesCard fates={empty} periodLabel={PERIOD} journalPending />,
    );
    expect(screen.getByText(/незаконченная труба чтения/u)).toBeTruthy();
    unmount();

    show(
      <RejoinedFatesCard
        fates={rejoinedFates([{ fate: null, fateRaw: null }], labels)}
        periodLabel={PERIOD}
      />,
    );
    expect(screen.getByText(/пустота самой книги/u)).toBeTruthy();
  });

  it('сырое написание книги показано рядом с классом — класс без исходника не проверить', () => {
    const fates = rejoinedFates([{ fate: 'fas-complaint', fateRaw: 'УФАС-жалоба' }], labels);
    show(
      <RejoinedFatesCard fates={fates} periodLabel={PERIOD} />);
    expect(screen.getByText(/«УФАС-жалоба»/u)).toBeTruthy();
  });

  it('число помеченных объявлено нижней границей, а не полным счётом', () => {
    const fates = rejoinedFates([{ fate: 'repeat', fateRaw: 'повторно' }], labels);
    show(
      <RejoinedFatesCard fates={fates} periodLabel={PERIOD} />);
    expect(screen.getByText('Это нижняя граница')).toBeTruthy();
  });
});
