// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DirectoryTable } from './DirectoryTable';
import type { DirectoryPayload } from '../../lib/monitoring/contract';

afterEach(cleanup);

it('shows a joint purchasing group as a group and retains exact evidence addresses', () => {
  const directory: DirectoryPayload = {
    rows: [{
      num: '1', grbs: 'УО', institutionId: '32e0191e-2ed9-48a7-83da-8a4ade214da2',
      entityKind: 'joint_group', status: 'Группа заказчиков',
      fullName: 'Совместная закупка УО', shortName: 'СЗ УО',
      shortMissing: false, usedInBook: 2,
      nameEvidence: [
        { name: 'Совместные закупки УО АЕМР', role: 'canonical', sourceAddress: 'Справочник заказчиков!D2' },
        { name: 'Совместная закупка УО', role: 'current', sourceAddress: 'Справочник заказчиков!Q2' },
      ],
    }, {
      num: '2', grbs: 'УО', institutionId: '42e0191e-2ed9-48a7-83da-8a4ade214da2',
      entityKind: 'institution', status: 'Ликвидирован',
      fullName: 'Бывшая школа', shortName: 'Бывшая школа', shortMissing: true, usedInBook: 0,
    }],
    unmatchedCustomers: [], notes: [],
  };
  const { container } = render(createElement(DirectoryTable, {
    directory, readAtLabel: '22.10.2026',
  }));
  expect(container.textContent).toContain('Группа закупки');
  expect(container.textContent).toContain('Ликвидировано');
  expect(container.textContent).toContain('Названия и источники');
  expect(container.textContent).toContain('Справочник заказчиков!D2');
  expect(container.textContent).toContain('Справочник заказчиков!Q2');
  expect(container.textContent).toContain('Идентификатор записи');
  expect(container.textContent).toContain('План-реестр процедур определения поставщика');
  expect(container.textContent).not.toContain('Идентификатор учреждения');
});
