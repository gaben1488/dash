// @vitest-environment jsdom
/**
 * Страж двойного адреса карточки диагноста (канон п.98б): рядом с позиционным
 * номером строки листа адрес несёт «№ п/п» из колонки A — строки листа
 * двигаются («Опрессовка»: была 534 → стала 155, № п/п = 531), и без второго
 * ключа исполнитель ищет виновницу не там.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiagnosticCardList } from './DiagnosticCards';

const overdueWithSeq = {
  id: 'i1',
  severity: 'critical',
  signal: 'overdue',
  checkId: 'overdue',
  title: 'Просрочен: Опрессовка',
  sheet: 'УД',
  row: 155,
  rowSeq: '531',
  departmentId: 'УД',
};

const overdueNoSeq = {
  id: 'i2',
  severity: 'critical',
  signal: 'overdue',
  checkId: 'overdue',
  title: 'Просрочен: Шкаф комбинированный',
  sheet: 'УИО',
  row: 2237,
  departmentId: 'УИО',
};

afterEach(() => cleanup());

describe('DiagnosticCard — адрес строки-виновницы', () => {
  it('раскрытый адрес показывает «строка N · № п/п A» при наличии rowSeq', () => {
    render(<DiagnosticCardList issues={[overdueWithSeq, overdueNoSeq]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    const list = screen.getByRole('list');
    const [first, second] = list.querySelectorAll('li');
    expect(first.textContent).toContain('строка 155');
    expect(first.textContent).toContain('№ п/п 531');
    // Без rowSeq (старый снимок) подпись «№ п/п» не печатается вовсе —
    // пустой ярлык был бы ложным обещанием стабильного ключа.
    expect(second.textContent).toContain('строка 2237');
    expect(second.textContent).not.toContain('№ п/п');
  });
});
