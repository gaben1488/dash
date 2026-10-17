// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReportAssuranceSchema, type ReportAssurance } from '@aemr/shared';
import { ReportAssurancePanel } from './ReportAssurancePanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const value: ReportAssurance = {
  contract: 'actionable-assurance-v1', fully_automated: false,
  user_action_count: 1, engine_action_count: 0, active_recommendations: 0,
  link_status_counts: {}, action_status_counts: {}, meaning: 'Verification is scoped.',
  actions: [{ signal_id: 'SIG-one', code: 'FACT_MONEY_WITHOUT_DATE', severity: 'needs_attention',
    owner_kind: 'SOURCE_OWNER', owner: 'УЭР', user_action_required: true,
    title: 'Сумма без даты', cause: 'Дата отсутствует', report_effect: 'Факт не увеличен',
    action: 'Внесите подтверждённую дату в Q', resolved_when: 'Дата появилась',
    recommendation_id: null, source_row_key: 'book::ВСЕ::4::1', locations: [{
      source_id: 'book', sheet: 'ВСЕ', sheet_id: 17, row: 4, column: 'Q', a1: 'Q4',
      url: 'https://docs.google.com/spreadsheets/d/book/edit#gid=17&range=Q4',
      subject: 'Синтетическая бумага', business_id: '1',
    }],
  }],
};
it('shows concrete ownership, location and action without a grey-only status', () => {
  render(<ReportAssurancePanel value={value} label="Выбранный выпуск" />);
  expect(screen.getByText(/Уточнений по данным: 1/)).toBeTruthy();
  const allDetails = document.querySelectorAll('details');
  // The weekly report remains short; diagnostics are disclosed on demand.
  expect(allDetails[0]?.open).toBe(false);
  fireEvent.click(screen.getByText(/Пояснения к проверке отчёта/));
  fireEvent.click(screen.getByText(/Что нужно уточнить в исходных таблицах/));
  fireEvent.click(screen.getByText(/Сумма без даты завершения: уточнить вид позиции/));
  expect(screen.getByText('Внесите подтверждённую дату в Q', { exact: false })).toBeTruthy();
  expect(screen.getByText(/Открыть ВСЕ, Q4/)).toBeTruthy();
});
it('does not offer an injected source link as a clickable action', () => {
  const unsafe = structuredClone(value); unsafe.actions[0]!.locations[0]!.url = 'javascript:alert(1)';
  const { container } = render(<ReportAssurancePanel value={unsafe} label="Выпуск" />);
  expect(container.querySelector('a')).toBeNull();
});
it('keeps the server assurance in the parsed response rather than silently stripping it', () => {
  expect(ReportAssuranceSchema.parse(value)).toEqual(value);
});

it('groups thousands of engine records by cause, effect and action without rendering every row', () => {
  const engine = structuredClone(value.actions[0]!);
  Object.assign(engine, { owner_kind: 'ENGINE', owner: 'Сопровождение генератора',
    user_action_required: false, code: 'ENGINE_IDENTITY_CONTINUITY',
    title: 'Не завершена проверка идентичности', cause: 'Историческая связь не подтверждена',
    action: 'Восстановить доказательства', report_effect: 'Связь не объявляется доказанной' });
  const receipt = { ...value, engine_action_count: 2547,
    actions: [...value.actions, ...Array.from({ length: 2547 }, (_, i) => ({ ...engine,
      signal_id: `SIG-${i}`, source_row_key: `book::ВСЕ::${i + 4}::${i}` }))] };
  const before = JSON.stringify(receipt);
  const { container } = render(<ReportAssurancePanel value={receipt} label="Выбранный выпуск" />);
  expect(screen.getAllByText(/Историческая связь не подтверждена/)).toHaveLength(1);
  expect(screen.getByText(/Затронутых записей: 2547/)).toBeTruthy();
  expect(container.querySelectorAll('details').length).toBeLessThan(12);
  expect(JSON.stringify(receipt)).toBe(before);
});

it('does not merge different impacts, actions or blockers into one technical cause', () => {
  const engine = { ...value.actions[0]!, owner_kind: 'ENGINE' as const,
    user_action_required: false, owner: 'Сопровождение генератора' };
  const receipt = { ...value, user_action_count: 0, engine_action_count: 3,
    actions: [engine, { ...engine, signal_id: 'SIG-two', report_effect: 'Другой эффект' },
      { ...engine, signal_id: 'SIG-three', severity: 'blocks_release' as const }] };
  render(<ReportAssurancePanel value={receipt} label="Выбранный выпуск" />);
  expect(screen.getAllByText(/Затронутых записей: 1/)).toHaveLength(3);
  expect(screen.getByText(/Нужны уточнения перед новым выпуском/)).toBeTruthy();
});

it('makes full technical evidence available as a downloadable file rather than thousands of cards', () => {
  const engine = { ...value.actions[0]!, owner_kind: 'ENGINE' as const,
    user_action_required: false, owner: 'Сопровождение генератора' };
  render(<ReportAssurancePanel value={{ ...value, user_action_count: 0,
    engine_action_count: 1, actions: [engine] }} label="Выбранный выпуск" />);
  expect(screen.getByRole('button', { name: 'Скачать полный технический протокол' })).toBeTruthy();
});

it('treats monetary fact without Q as a classification question and preserves the frozen instruction', () => {
  const receipt = structuredClone(value);
  receipt.actions[0]!.locations[0]!.subject = 'Годовая потребность';
  const before = JSON.stringify(receipt);
  render(<ReportAssurancePanel value={receipt} label="Сохранённый выпуск" />);
  expect(screen.getByText(/Сумма без даты завершения: уточнить вид позиции/)).toBeTruthy();
  expect(screen.getByText(/Вид позиции по этому сигналу не установлен/)).toBeTruthy();
  expect(screen.getByText(/Для годовой потребности Q — дата последнего договора/)).toBeTruthy();
  expect(screen.getByText(/заполнение Q не является обязательным способом закрытия вопроса/)).toBeTruthy();
  expect(screen.getByText(/Исходное пояснение сохранённого выпуска/)).toBeTruthy();
  expect(screen.getByText('Внесите подтверждённую дату в Q', { exact: false })).toBeTruthy();
  expect(JSON.stringify(receipt)).toBe(before);
});

it('retains complete evidence for manual saving if browser file transfer fails', () => {
  vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('Browser denied transfer'); } });
  const engine = { ...value.actions[0]!, owner_kind: 'ENGINE' as const, user_action_required: false };
  const receipt = { ...value, user_action_count: 0, engine_action_count: 1, actions: [engine] };
  render(<ReportAssurancePanel value={receipt} label="Выбранный выпуск" />);
  fireEvent.click(screen.getByRole('button', { name: 'Скачать полный технический протокол' }));
  const text = screen.getByRole('textbox', { name: 'Полный технический протокол' }) as HTMLTextAreaElement;
  expect(JSON.parse(text.value)).toEqual(receipt);
});
