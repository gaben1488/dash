/**
 * Проверки на правила страницы «Система», которые легко потерять при правке
 * вёрстки. Все три относятся к обещаниям продукта, а не к деталям разметки.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSourcesResponse, maskSecret, CELL_ADDRESS_RE,
  buildDiagnostics, maskAccessKey, summarizeDiagnostics,
  type DiagnosticsInput,
} from './Settings';

describe('parseSourcesResponse: «сервер не сообщил» — не то же, что ноль', () => {
  it('rowCount отсутствует → null, а не 0 (иначе непрочитанная книга выглядит пустой)', () => {
    const [src] = parseSourcesResponse({ sources: [{ name: 'УЖКХ', status: 'warning' }] });
    expect(src.rows).toBeNull();
  });

  it('rowCount = 0 сохраняется как настоящий ноль', () => {
    const [src] = parseSourcesResponse({ sources: [{ name: 'УЖКХ', status: 'ok', rowCount: 0 }] });
    expect(src.rows).toBe(0);
  });

  it('причина отказа отделяется от подписи состояния и не тащит слово «Ошибка»', () => {
    const [src] = parseSourcesResponse({
      sources: [{ name: 'УЭР', status: 'error', statusLabel: 'Ошибка: Unable to parse range' }],
    });
    expect(src.status).toBe('error');
    expect(src.statusDetail).toBe('Unable to parse range');
  });

  it('«Активна» — это подпись состояния, а не причина: отдельной строкой не показывается', () => {
    const [src] = parseSourcesResponse({
      sources: [{ name: 'УЭР', status: 'ok', statusLabel: 'Активна' }],
    });
    expect(src.statusDetail).toBeNull();
  });

  it('пустой идентификатор книги превращается в null («не задан»), а не в пустую строку', () => {
    const [src] = parseSourcesResponse({ sources: [{ name: 'УЭР', status: 'unknown', spreadsheetId: '' }] });
    expect(src.spreadsheetId).toBeNull();
  });

  it('ответ без источников не роняет разбор', () => {
    expect(parseSourcesResponse(null)).toEqual([]);
    expect(parseSourcesResponse({})).toEqual([]);
  });
});

describe('maskSecret: закрытый ключ не показывается целиком ни при каких условиях', () => {
  it('длинный ключ отдаёт только начало и конец', () => {
    const key = `-----BEGIN PRIVATE KEY-----${'A'.repeat(400)}-----END PRIVATE KEY-----`;
    const masked = maskSecret(key);
    expect(masked).not.toContain('A'.repeat(50));
    expect(masked.length).toBeLessThan(40);
    expect(masked).toContain('…');
  });

  it('короткая строка закрывается полностью — по ней ключ не восстановить', () => {
    expect(maskSecret('short-secret')).toMatch(/^•+$/);
  });
});

describe('maskAccessKey: ключ доступа виден только хвостом', () => {
  it('длинный ключ показывает четыре последних знака и ни знаком больше', () => {
    const key = 'aemr-prod-key-9f31c7a4e2b8';
    const masked = maskAccessKey(key);
    expect(masked).toBe(`••••${key.slice(-4)}`);
    expect(masked).not.toContain('aemr');
    expect(masked.replace(/•/g, '').length).toBe(4);
  });

  it('короткий ключ закрывается целиком — по хвосту его слишком легко достроить', () => {
    expect(maskAccessKey('short-key')).toMatch(/^•+$/);
  });

  it('пустая строка не превращается в точки: показывать нечего', () => {
    expect(maskAccessKey('   ')).toBe('');
  });
});

/** Заготовка «всё хорошо»: тесты правят ровно то, что проверяют. */
function healthy(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    serverOnline: true,
    sheetsConfigured: true,
    accessKey: 'aemr-prod-key-9f31c7a4e2b8',
    sources: [
      { status: 'ok', rows: 120 },
      { status: 'ok', rows: 80 },
    ],
    sourcesLoadedOnce: true,
    lastRefreshed: '2026-08-08T09:00:00.000Z',
    dataError: null,
    hasData: true,
    now: Date.parse('2026-08-08T09:05:00.000Z'),
    ...overrides,
  };
}

const lineFor = (input: DiagnosticsInput, subject: string) => {
  const line = buildDiagnostics(input).find(l => l.subject === subject);
  if (!line) throw new Error(`Строка диагностики «${subject}» пропала`);
  return line;
};

describe('buildDiagnostics: у каждой поломки есть причина и следующий шаг', () => {
  it('исправная система не выдумывает работу: действий нет ни в одной строке', () => {
    const lines = buildDiagnostics(healthy());
    expect(lines.every(l => l.tone === 'ok')).toBe(true);
    expect(lines.every(l => l.action === null)).toBe(true);
  });

  it('у каждой сломанной строки есть внятное «что делать»', () => {
    const lines = buildDiagnostics(healthy({
      serverOnline: false,
      sourcesLoadedOnce: true,
      sources: [{ status: 'error', rows: null }],
      dataError: 'Нет связи с сервером данных',
    }));
    const problems = lines.filter(l => l.tone === 'problem');
    expect(problems.length).toBeGreaterThan(0);
    for (const line of problems) {
      expect(line.action).not.toBeNull();
      expect((line.action ?? '').length).toBeGreaterThan(20);
    }
  });

  it('молчащий сервер не позволяет утверждать, что доступ к таблицам настроен', () => {
    const line = lineFor(healthy({ serverOnline: false, sheetsConfigured: true }), 'Доступ к Google Таблицам');
    expect(line.tone).toBe('unknown');
    expect(line.state).toContain('неизвестен');
  });

  it('«ещё не спрашивали» — не то же, что «книг нет»', () => {
    const notAsked = lineFor(healthy({ sourcesLoadedOnce: false, sources: [] }), 'Книги-источники');
    expect(notAsked.tone).toBe('unknown');

    const asked = lineFor(healthy({ sourcesLoadedOnce: true, sources: [] }), 'Книги-источники');
    expect(asked.tone).toBe('problem');
    expect(asked.state).toContain('ни одной книги');
  });

  it('книга, не сообщившая число строк, в сумму не входит, и об этом сказано', () => {
    const line = lineFor(healthy({
      sources: [{ status: 'ok', rows: 120 }, { status: 'warning', rows: null }],
    }), 'Строк прочитано');
    expect(line.state).toContain('120');
    expect(line.state).toContain('1 книге из 2');
  });

  it('ни одна книга не сообщила строк — честная неизвестность вместо нуля', () => {
    const line = lineFor(healthy({ sources: [{ status: 'warning', rows: null }] }), 'Строк прочитано');
    expect(line.tone).toBe('unknown');
    expect(line.state).not.toContain('0');
  });

  it('ключ доступа не попадает в диагностику целиком', () => {
    const key = 'aemr-prod-key-9f31c7a4e2b8';
    const line = lineFor(healthy({ accessKey: key }), 'Ключ доступа к серверу');
    expect(line.state).not.toContain(key);
    expect(line.state).toContain(key.slice(-4));
  });

  it('отсутствие ключа не объявляется поломкой: требует ли его сервер, знает только сервер', () => {
    const line = lineFor(healthy({ accessKey: null }), 'Ключ доступа к серверу');
    expect(line.tone).toBe('unknown');
    expect(line.action).not.toBeNull();
  });

  it('отказ загрузки данных показывается словами сервера, а не «ошибка»', () => {
    const line = lineFor(healthy({ dataError: 'Нет связи с сервером данных', hasData: false }), 'Данные на экране');
    expect(line.tone).toBe('problem');
    expect(line.state).toBe('Нет связи с сервером данных');
  });

  it('время последнего чтения считается от переданного момента, а не от часов машины', () => {
    const line = lineFor(healthy(), 'Последнее чтение книг');
    expect(line.state).toBe('5 мин. назад');
  });
});

describe('summarizeDiagnostics: заголовок — утверждение о состоянии', () => {
  it('всё исправно — так и сказано', () => {
    expect(summarizeDiagnostics(buildDiagnostics(healthy()))).toEqual({
      problems: 0,
      headline: 'Всё, что проверяется, работает',
    });
  });

  it('проверено не всё — «поломок не видно» не превращается в «всё хорошо»', () => {
    const summary = summarizeDiagnostics(buildDiagnostics(healthy({ sourcesLoadedOnce: false, sources: [] })));
    expect(summary.problems).toBe(0);
    expect(summary.headline).toContain('проверено ещё не всё');
  });

  it('поломки считаются и склоняются по-русски', () => {
    const summary = summarizeDiagnostics(buildDiagnostics(healthy({
      serverOnline: false,
      dataError: 'Нет связи с сервером данных',
    })));
    expect(summary.problems).toBe(2);
    expect(summary.headline).toContain('Сломано: 2 места');
  });
});

describe('CELL_ADDRESS_RE: правится адрес ячейки, а не «Лист!Ячейка»', () => {
  it('принимает адрес, который ждёт сервер', () => {
    expect(CELL_ADDRESS_RE.test('D14')).toBe(true);
    expect(CELL_ADDRESS_RE.test('AA255')).toBe(true);
  });

  it('отвергает адрес с именем листа — раньше такой уходил на сервер и молча отклонялся', () => {
    expect(CELL_ADDRESS_RE.test('СВОД ТД-ПМ!D14')).toBe(false);
    expect(CELL_ADDRESS_RE.test('d14')).toBe(false);
    expect(CELL_ADDRESS_RE.test('14')).toBe(false);
  });
});
