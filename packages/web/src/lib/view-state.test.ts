// ── Стражи механизма М7 «состояние экрана в адресной строке» ────────────────
//
//    Каждое утверждение модуля `view-state.ts` здесь либо доказано, либо
//    опровергнуто. Главный страж — круговой прогон «состояние → адрес →
//    состояние» по ВСЕМ объявленным вкладкам: он ловит расхождение схемы
//    записи и схемы чтения раньше, чем его поймает коллега, которому послали
//    неработающую ссылку.
//
//    Второе семейство стражей держит канон п.134: отбор не включается сам.
//    Чистый адрес не порождает фильтра, значение по умолчанию не пишется в
//    ссылку, сохранённые настройки физически не носят отбор, а всякий
//    действующий отбор умеет назвать себя чипом.

import { describe, it, expect } from 'vitest';
import {
  PICK_PREFIX,
  TAB_PARAM,
  VIEW_PREFIX,
  addressHref,
  allViewTabs,
  arrivedPicks,
  canonicalPick,
  canonicalView,
  filterishWord,
  isViewTab,
  parseAddress,
  persistableView,
  serializeAddress,
  validateTabSpec,
  viewBool,
  viewEnum,
  viewIds,
  viewInt,
  viewSpec,
  viewToken,
  type TabViewSpec,
  type ViewState,
  type ViewTab,
  type ViewValue,
} from './view-state';
import { EMPTY_FILTER_CONTEXT, type FilterContext } from './filter-context';

/**
 * Значение, ЗАВЕДОМО отличное от значения по умолчанию, — по виду поля.
 * Нужно потому, что круговой прогон на значениях по умолчанию ничего не
 * доказывает: они в адрес не пишутся, и «совпало» вышло бы само собой.
 */
function departingValue(field: ReturnType<typeof viewSpec>['view'][number]): ViewValue {
  switch (field.kind) {
    case 'enum': {
      const values = field.values ?? [];
      return values.find((v) => v !== field.fallback) ?? values[0] ?? '';
    }
    case 'token':
      return field.fallback === 'проба' ? 'проба-2' : 'проба';
    case 'text':
      return 'строка поиска';
    case 'int': {
      const min = field.min ?? 1;
      const max = field.max ?? 1000;
      const candidate = Number(field.fallback) === min ? min + 1 : min;
      return Math.min(candidate, max);
    }
    case 'bool':
      return field.fallback !== true;
    case 'ids':
      return ['первый', 'второй'];
  }
}

/** Полное состояние вкладки, где КАЖДОЕ поле ушло от значения по умолчанию. */
function departingState(tab: ViewTab): { view: ViewState; pick: ViewState } {
  const spec = viewSpec(tab);
  const view: Record<string, ViewValue> = {};
  for (const field of spec.view) view[field.key] = departingValue(field);
  const pick: Record<string, ViewValue> = {};
  for (const field of spec.pick) pick[field.key] = departingValue(field);
  return { view, pick };
}

describe('круговой прогон «состояние → адрес → состояние»', () => {
  it.each(allViewTabs())('вкладка «%s» возвращается из адреса без потерь', (tab) => {
    const { view, pick } = departingState(tab);
    const parsed = parseAddress(serializeAddress({ tab, view, pick }));

    expect(parsed.tab).toBe(tab);
    expect(parsed.view).toEqual(canonicalView(tab, view));
    expect(parsed.pick).toEqual(canonicalPick(tab, pick));
  });

  it.each(allViewTabs())('вкладка «%s»: состояние по умолчанию тоже переживает круг', (tab) => {
    const parsed = parseAddress(serializeAddress({ tab }));
    expect(parsed.view).toEqual(canonicalView(tab));
    expect(parsed.pick).toEqual(canonicalPick(tab));
  });

  it('второй круг ничего не меняет — адрес устойчив', () => {
    const { view, pick } = departingState('monitoring');
    const first = serializeAddress({ tab: 'monitoring', view, pick });
    const parsed = parseAddress(first);
    const second = serializeAddress({ tab: 'monitoring', view: parsed.view, pick: parsed.pick });
    expect(second).toBe(first);
  });

  it('отбор шапки едет в том же адресе и возвращается целым', () => {
    const filters: FilterContext = {
      ...EMPTY_FILTER_CONTEXT,
      year: 2026,
      period: 'q2',
      months: [4, 5, 6],
      grbs: ['УО'],
      methods: ['ЕП'],
      budgets: ['fb'],
      search: 'шкаф',
    };
    const { view } = departingState('economy');
    const parsed = parseAddress(serializeAddress({ tab: 'economy', filters, view }));

    expect(parsed.filters).toEqual(filters);
    expect(parsed.view).toEqual(canonicalView('economy', view));
  });
});

describe('канон п.134 — отбор не включается сам', () => {
  it('адрес без параметров отбора даёт filters: null, а не «фильтр по умолчанию»', () => {
    const parsed = parseAddress(serializeAddress({ tab: 'monitoring' }));
    expect(parsed.filters).toBeNull();
  });

  it('вид в адресе не пробуждает отбор шапки', () => {
    const parsed = parseAddress(`${TAB_PARAM}=economy&${VIEW_PREFIX}split=1`);
    expect(parsed.filters).toBeNull();
    expect(viewBool(parsed.view, 'split')).toBe(true);
  });

  it('переданный отбор шапки читается — но только когда он в адресе есть', () => {
    const parsed = parseAddress(`${TAB_PARAM}=economy&y=2026`);
    expect(parsed.filters?.year).toBe(2026);
  });

  it('поле вида, названное как отбор, не даёт объявить список полей', () => {
    const illegal: TabViewSpec = {
      tab: 'economy',
      view: [{ key: 'budget', title: 'Бюджет', kind: 'token', fallback: '' }],
      pick: [],
    };
    const problems = validateTabSpec(illegal);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('budget');
    expect(problems[0]).toContain('п.134');
  });

  it.each([
    ['year', 'pyear'],
    ['department', 'department'],
    ['budget', 'budgets'],
    ['search', 'searchText'],
  ])('слово «%s» опознаётся в имени «%s»', (word, key) => {
    expect(filterishWord(key)).toBe(word);
  });

  it('честное имя поля вида нарушением не считается', () => {
    for (const key of ['sort', 'dir', 'open', 'mode', 'split', 'page', 'size', 'hero', 'card']) {
      expect(filterishWord(key)).toBeNull();
    }
  });

  it.each(allViewTabs())('вкладка «%s»: ни одно объявленное поле не нарушает правил', (tab) => {
    expect(validateTabSpec(viewSpec(tab))).toEqual([]);
  });

  it('каждый действующий местный отбор назван чипом', () => {
    const { pick } = departingState('monitoring');
    const picks = arrivedPicks('monitoring', canonicalPick('monitoring', pick));

    expect(picks.length).toBe(viewSpec('monitoring').pick.length);
    for (const arrived of picks) {
      expect(arrived.chip.trim().length).toBeGreaterThan(0);
      expect(arrived.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('отбор в значении по умолчанию чипом не объявляется — показывать нечего', () => {
    expect(arrivedPicks('monitoring', canonicalPick('monitoring'))).toEqual([]);
  });

  it('приехавший ссылкой отбор виден чипами сразу после разбора', () => {
    const parsed = parseAddress(`${TAB_PARAM}=monitoring&${PICK_PREFIX}stage=подача&${PICK_PREFIX}pq=2`);
    expect(parsed.picks.map((p) => p.chip)).toEqual(['Этап: подача', '2 кв по дате']);
  });

  it.each(allViewTabs())('вкладка «%s»: сохранённые настройки не носят отбор', (tab) => {
    const { view, pick } = departingState(tab);
    const saved = persistableView(tab, { ...view, ...pick } as ViewState);
    for (const field of viewSpec(tab).pick) {
      expect(saved).not.toHaveProperty(field.key);
    }
  });

  it('сохранённые настройки не носят и значений по умолчанию', () => {
    expect(persistableView('economy', canonicalView('economy'))).toEqual({});
  });
});

describe('устойчивость к мусору', () => {
  it('неизвестный параметр отбрасывается, экран не падает', () => {
    const parsed = parseAddress(`${TAB_PARAM}=economy&${VIEW_PREFIX}неведомое=1&мусор=2`);
    expect(parsed.view).toEqual(canonicalView('economy'));
  });

  it('чужое значение enum возвращается к значению по умолчанию', () => {
    const parsed = parseAddress(`${TAB_PARAM}=economy&${VIEW_PREFIX}table=выдумка`);
    expect(viewEnum(parsed.view, 'table', ['departments', 'subordinates'], 'departments')).toBe('departments');
  });

  it.each(['-3', '0', '999999999', 'много', '2.5', ''])('число «%s» не проходит границы поля', (raw) => {
    const parsed = parseAddress(`${TAB_PARAM}=data&${VIEW_PREFIX}page=${encodeURIComponent(raw)}`);
    expect(viewInt(parsed.view, 'page', 1)).toBe(1);
  });

  it('число в границах проходит', () => {
    const parsed = parseAddress(`${TAB_PARAM}=data&${VIEW_PREFIX}page=42`);
    expect(viewInt(parsed.view, 'page', 1)).toBe(42);
  });

  it('управляющие символы в ключе не проходят', () => {
    const parsed = parseAddress(`${TAB_PARAM}=monitoring&${VIEW_PREFIX}mode=${encodeURIComponent('\u0007')}`);
    expect(viewToken(parsed.view, 'mode')).toBe('all');
  });

  it('слишком длинный ключ не проходит', () => {
    const long = 'я'.repeat(300);
    const parsed = parseAddress(`${TAB_PARAM}=monitoring&${VIEW_PREFIX}mode=${encodeURIComponent(long)}`);
    expect(viewToken(parsed.view, 'mode')).toBe('all');
  });

  it('длинный текст обрезается, а не отбрасывается — поиск читателя не пропадает', () => {
    const long = 'шкаф '.repeat(100);
    const parsed = parseAddress(`${TAB_PARAM}=monitoring&${PICK_PREFIX}text=${encodeURIComponent(long)}`);
    expect(viewToken(parsed.pick, 'text').length).toBe(120);
  });

  it('список ключей дедуплицируется и режется по потолку', () => {
    const many = Array.from({ length: 200 }, (_, i) => `${VIEW_PREFIX}open=к${i % 5}`).join('&');
    const parsed = parseAddress(`${TAB_PARAM}=analytics&${many}`);
    expect(viewIds(parsed.view, 'open')).toEqual(['к0', 'к1', 'к2', 'к3', 'к4']);
  });

  it('пустая строка параметров не роняет разбор', () => {
    const parsed = parseAddress('');
    expect(parsed.tab).toBeNull();
    expect(parsed.filters).toBeNull();
    expect(parsed.view).toEqual({});
    expect(parsed.picks).toEqual([]);
  });

  it('неизвестная вкладка не притворяется знакомой', () => {
    const parsed = parseAddress(`${TAB_PARAM}=выдумка&${VIEW_PREFIX}sort=цена`);
    expect(parsed.tab).toBeNull();
    expect(parsed.view).toEqual({});
  });

  it('ведущий «?» разбору не мешает', () => {
    expect(parseAddress(`?${TAB_PARAM}=report`).tab).toBe('report');
  });

  it('поле чужой вкладки не просачивается', () => {
    // `split` объявлен только у «Экономии»; в адресе «Мониторинга» его нет.
    const parsed = parseAddress(`${TAB_PARAM}=monitoring&${VIEW_PREFIX}split=1`);
    expect(parsed.view).not.toHaveProperty('split');
    expect(parsed.view).toEqual(canonicalView('monitoring'));
  });

  it('состояние из памяти страницы тоже приводится к канону', () => {
    const canon = canonicalView('data', { page: -5, size: 'десять', mode: 'выдумка' } as never);
    expect(viewInt(canon, 'page', 0)).toBe(1);
    expect(viewInt(canon, 'size', 0)).toBe(25);
    expect(viewEnum(canon, 'mode', ['browse', 'editor'], 'browse')).toBe('browse');
  });
});

describe('форма адреса', () => {
  it('значение по умолчанию в ссылку не пишется — ссылка называет отличия', () => {
    const qs = serializeAddress({ tab: 'economy', view: canonicalView('economy') });
    expect(qs).toBe(`${TAB_PARAM}=economy`);
  });

  it('вкладка названа всегда — иначе принимающая сторона не знает, чей это вид', () => {
    expect(parseAddress(serializeAddress({ tab: 'quality' })).tab).toBe('quality');
  });

  it('поля вида и отбора живут под разными приставками', () => {
    const qs = serializeAddress({
      tab: 'analytics',
      view: { dim: 'budget' },
      pick: { ring: ['УО', 'ЕП'] },
    });
    expect(qs).toContain(`${VIEW_PREFIX}dim=budget`);
    expect(qs).toContain(`${PICK_PREFIX}ring=`);
  });

  it('готовая ссылка не оставляет пустого «?»', () => {
    expect(addressHref('/', { tab: 'report' })).toBe(`/?${TAB_PARAM}=report`);
  });

  it('вкладки узнаются по имени', () => {
    expect(isViewTab('monitoring')).toBe(true);
    expect(isViewTab('settings')).toBe(false);
    expect(isViewTab(null)).toBe(false);
    expect(isViewTab(7)).toBe(false);
  });
});
