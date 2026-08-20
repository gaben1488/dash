// @vitest-environment jsdom
/**
 * Страж карточки «Расхождения по признанию экономии» (канон п.119: по каждому
 * сигналу виден ответ — какая строка, что в ней, почему) и её режима подведов
 * (приказ владельца 20.08: при выборе «ГРБС с подведомственными» карточка
 * переходит из плоского списка в разбивку по учреждениям).
 *
 * Проверяются обещания, а не разметка: адрес строки виден, организация без
 * расхождений не пропадает из разбивки, живой ключ вне канона не теряется,
 * момент чтения книг назван словами.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ORG_ITSELF_SENTINEL } from '@aemr/shared';
import {
  EconomyConflictRows, groupConflictsByOrg,
  type ConflictIssue, type ConflictSubScope,
} from './EconomyConflictRows';

afterEach(() => cleanup());

const issue = (over: Partial<ConflictIssue> = {}): ConflictIssue => ({
  departmentId: 'УО',
  sheet: 'Закупки',
  row: 42,
  rowSeq: '17',
  description: 'Финансовый орган снял флаг «является экономией», управление оставило.',
  ...over,
});

const subScope = (orgs: string[]): ConflictSubScope => ({
  deptLabel: 'УО',
  hasSubs: orgs.length > 0,
  orgs: [
    { key: ORG_ITSELF_SENTINEL, label: 'Аппарат управления' },
    ...orgs.map(name => ({ key: name, label: name })),
  ],
});

describe('groupConflictsByOrg — раскладка строк по учреждениям', () => {
  it('аппарат идёт первым, организации — по алфавиту', () => {
    const groups = groupConflictsByOrg(
      [issue({ subordinateId: 'Школа № 2' }), issue({ subordinateId: undefined })],
      subScope(['Школа № 2', 'Детский сад «Ромашка»']).orgs,
    );
    expect(groups.map(g => g.label)).toEqual([
      'Аппарат управления', 'Детский сад «Ромашка»', 'Школа № 2',
    ]);
    expect(groups[0].rows).toHaveLength(1);
  });

  it('каноничная организация без расхождений остаётся в разбивке пустой', () => {
    const groups = groupConflictsByOrg([issue({ subordinateId: 'Школа № 2' })], subScope(['Школа № 2', 'Лицей № 1']).orgs);
    const lyceum = groups.find(g => g.label === 'Лицей № 1');
    // «Расхождений нет» и «организации нет» — разные новости.
    expect(lyceum).toBeDefined();
    expect(lyceum?.rows).toHaveLength(0);
  });

  it('живой ключ вне канона не теряется — строку нельзя выбросить', () => {
    const groups = groupConflictsByOrg([issue({ subordinateId: 'Новый центр' })], subScope(['Школа № 2']).orgs);
    expect(groups.find(g => g.label === 'Новый центр')?.rows).toHaveLength(1);
  });
});

describe('EconomyConflictRows — раскрытие до строк с адресами', () => {
  const base = {
    conflictsTotal: 1,
    lastRefreshed: '2026-08-20T09:15:00.000Z',
    open: true,
    onToggle: () => {},
    onOpenRegistry: () => {},
  };

  it('в плоском режиме показывает управление, адрес строки и момент чтения', () => {
    render(<EconomyConflictRows {...base} issues={[issue()]} />);
    expect(screen.getByText(/лист Закупки · строка 42 · № п\/п 17/)).toBeTruthy();
    // Адрес верен на момент чтения книг, а не «вообще» (п.58, п.98б).
    expect(screen.getByText(/момент чтения книг/i)).toBeTruthy();
    expect(screen.getByText(/лист живёт, строки могли сдвинуться/i)).toBeTruthy();
  });

  it('незнание момента чтения не выдаёт за свежесть', () => {
    render(<EconomyConflictRows {...base} lastRefreshed={null} issues={[issue()]} />);
    // Канон реестра: молчание сервера — это «неизвестно», а не «только что».
    expect(screen.getByText(/момент чтения книг неизвестен/i)).toBeTruthy();
  });

  it('в режиме подведов группирует строки и называет тихие организации', () => {
    render(
      <EconomyConflictRows
        {...base}
        conflictsTotal={2}
        issues={[issue({ subordinateId: 'Школа № 2' }), issue({ subordinateId: undefined })]}
        subScope={subScope(['Школа № 2', 'Лицей № 1'])}
      />,
    );
    expect(screen.getByText('Школа № 2')).toBeTruthy();
    expect(screen.getByText('Аппарат управления')).toBeTruthy();
    // Организация без расхождений названа словами, а не выброшена молча.
    expect(screen.getByText(/Расхождений нет у 1 организации: Лицей № 1\./)).toBeTruthy();
  });

  it('пустоту счётчика без строк объясняет причиной, а не прочерком', () => {
    render(<EconomyConflictRows {...base} conflictsTotal={3} issues={[]} />);
    expect(screen.getByText(/в перечень замечаний последнего чтения эти строки не попали/i)).toBeTruthy();
  });
});
