// ── Стражи механизма «один дом цвета» (М13).
//
//    Проверяется не «цвета красивые», а проверяемое: словарь смысла не знает
//    ни одной краски, каждая его роль объявлена в ОБЕИХ темах, закреплённые
//    словари не делят один тон, и отсутствие данных никогда не превращается в
//    обвинение.
//
//    Тест читает сам `index.css`, а не копию значений: копия разъехалась бы с
//    оригиналом на первой же правке — ровно так словарь ролей и рассыпается.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { THRESHOLDS } from '@aemr/shared';
import { BUDGET_COLORS, METHOD_COLORS } from './chart-colors';
import {
  SEMANTIC_ROLES,
  STATE_LABELS,
  budgetColor,
  criticalIssuesState,
  deptExecutionState,
  disciplineIndexState,
  economyShareState,
  epShareState,
  executionColor,
  executionState,
  methodColor,
  semanticColor,
  seriesColor,
  stateColor,
  trustState,
  type BudgetKey,
  type MethodKey,
  type SemanticState,
} from './semantic-color';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../index.css');
const css = readFileSync(cssPath, 'utf8');
const semanticSource = readFileSync(resolve(here, 'semantic-color.ts'), 'utf8');

/** Вырезать тело правила по его селектору: `:root {…}` или `.dark {…}`. */
function ruleBodies(selector: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(selector, from);
    if (at === -1) break;
    const open = css.indexOf('{', at);
    if (open === -1) break;
    const close = css.indexOf('}', open);
    if (close === -1) break;
    bodies.push(css.slice(open + 1, close));
    from = close + 1;
  }
  return bodies;
}

const THEMES: ReadonlyArray<readonly [string, string]> = [
  ['светлая', ruleBodies(':root {').join('\n')],
  ['тёмная', ruleBodies('.dark {').join('\n')],
];

function valueOf(block: string, token: string): string | undefined {
  const m = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(block);
  return m?.[1]?.trim();
}

const BUDGETS: readonly BudgetKey[] = ['ФБ', 'КБ', 'МБ'];
const METHODS: readonly MethodKey[] = ['КП', 'ЕП'];
const STATES: readonly SemanticState[] = ['норма', 'внимание', 'нарушение', 'не оценено'];

/** Имя роли из `var(--имя)`. */
function roleOf(color: string): string {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(color);
  expect(m, `не роль, а краска: ${color}`).not.toBeNull();
  return m![1]!;
}

describe('в словаре нет сырых hex', () => {
  it('исходник словаря не содержит ни одной краски', () => {
    // Комментарии вправе называть цвета, которыми болел продукт, — код не вправе.
    const code = semanticSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it('всякий выданный цвет — роль, а не значение', () => {
    const produced = [
      ...BUDGETS.map(budgetColor),
      ...METHODS.map(methodColor),
      ...STATES.map(stateColor),
      ...[0, 1, 5, -3].map(seriesColor),
      executionColor(85),
      executionColor(null),
      semanticColor({ kind: 'бюджет', key: 'ФБ' }),
      semanticColor({ kind: 'способ', key: 'ЕП' }),
      semanticColor({ kind: 'состояние', key: 'нарушение' }),
      semanticColor({ kind: 'ряд', index: 2 }),
    ];
    for (const color of produced) {
      expect(color, `${color}: краска вместо роли`).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });
});

describe('роль знает обе темы', () => {
  it('каждая роль словаря объявлена и на светлой, и на тёмной', () => {
    for (const [name, block] of THEMES) {
      const missing = SEMANTIC_ROLES.filter((role) => valueOf(block, role) === undefined);
      expect(missing, `${name} тема: роли забыты`).toEqual([]);
    }
  });

  it('роли, которые словарь выдаёт наружу, перечислены в SEMANTIC_ROLES', () => {
    // Перечень нужен странице объяснений и этому стражу. Роль, выданная мимо
    // перечня, останется без проверки на равноправие тем.
    const handed = [
      ...BUDGETS.map((b) => roleOf(budgetColor(b))),
      ...METHODS.map((m) => roleOf(methodColor(m))),
      ...STATES.map((s) => roleOf(stateColor(s))),
    ];
    for (const role of handed) {
      expect(SEMANTIC_ROLES, `роль ${role} выдаётся, но не перечислена`).toContain(role);
    }
  });
});

describe('бюджеты и способы не делят один цвет', () => {
  const budgetRoles = BUDGETS.map((b) => roleOf(budgetColor(b)));
  const methodRoles = METHODS.map((m) => roleOf(methodColor(m)));

  it('словари не пересекаются по ролям', () => {
    const shared = budgetRoles.filter((r) => methodRoles.includes(r));
    expect(shared, 'источник финансирования и способ закупки делят роль').toEqual([]);
  });

  it('в каждой теме тон бюджета не равен тону способа', () => {
    // Прежде круг по способам красился цветами ФБ и МБ: на соседних графиках
    // синий значил то «федеральный бюджет», то «конкурентная закупка».
    for (const [name, block] of THEMES) {
      const budgetTones = budgetRoles.map((r) => valueOf(block, r));
      const methodTones = methodRoles.map((r) => valueOf(block, r));
      const collision = methodTones.filter((t) => t !== undefined && budgetTones.includes(t));
      expect(collision, `${name} тема: способ закупки покрашен цветом бюджета`).toEqual([]);
    }
  });

  it('внутри бюджетной тройки все тона различны', () => {
    for (const [name, block] of THEMES) {
      const tones = budgetRoles.map((r) => valueOf(block, r));
      expect(new Set(tones).size, `${name} тема: два бюджета одного тона`).toBe(tones.length);
    }
  });

  it('ряд без смысла уведён от закреплённых словарей', () => {
    const fixed = new Set([...budgetRoles, ...methodRoles]);
    for (let i = 0; i < 12; i += 1) {
      expect(fixed.has(roleOf(seriesColor(i))), `ряд ${i} залез в закреплённый словарь`).toBe(false);
    }
  });
});

describe('два дома одного цвета не разъезжаются', () => {
  // Слой смысла отдаёт роль, слой графика — краску, потому что Recharts
  // местами требует настоящее значение. Дома два, значение обязано быть одно.
  // Расхождение уже случалось молча: ЕП стоял розовым `#be185d` в
  // `chart-colors.ts` и фуксией `--method-ep` в `index.css`, и один и тот же
  // способ закупки красился по-разному в круге и в бейдже.
  const [lightBlock, darkBlock] = [THEMES[0]![1], THEMES[1]![1]];

  it('бюджетная тройка слоя графика равна ролям словаря', () => {
    for (const key of BUDGETS) {
      const role = roleOf(budgetColor(key));
      expect(BUDGET_COLORS[key].light, `${key}: светлая тема разъехалась`).toBe(
        valueOf(lightBlock, role),
      );
      expect(BUDGET_COLORS[key].dark, `${key}: тёмная тема разъехалась`).toBe(
        valueOf(darkBlock, role),
      );
    }
  });

  it('способы закупки слоя графика равны ролям словаря', () => {
    for (const key of METHODS) {
      const role = roleOf(methodColor(key));
      expect(METHOD_COLORS[key].light, `${key}: светлая тема разъехалась`).toBe(
        valueOf(lightBlock, role),
      );
      expect(METHOD_COLORS[key].dark, `${key}: тёмная тема разъехалась`).toBe(
        valueOf(darkBlock, role),
      );
    }
  });
});

describe('одна величина — один цвет', () => {
  it('цвет величины не зависит от места вызова', () => {
    for (const b of BUDGETS) expect(budgetColor(b)).toBe(budgetColor(b));
    for (const s of STATES) expect(stateColor(s)).toBe(stateColor(s));
  });

  it('точка входа semanticColor согласна с частными функциями', () => {
    for (const key of BUDGETS) {
      expect(semanticColor({ kind: 'бюджет', key })).toBe(budgetColor(key));
    }
    for (const key of METHODS) {
      expect(semanticColor({ kind: 'способ', key })).toBe(methodColor(key));
    }
    for (const key of STATES) {
      expect(semanticColor({ kind: 'состояние', key })).toBe(stateColor(key));
    }
    expect(semanticColor({ kind: 'ряд', index: 3 })).toBe(seriesColor(3));
  });

  it('четыре состояния носят четыре разные роли', () => {
    const roles = STATES.map((s) => roleOf(stateColor(s)));
    expect(new Set(roles).size).toBe(STATES.length);
  });

  it('цвет исполнения выводится из состояния, а не считается заново', () => {
    for (const pct of [null, 0, 30, 55, 85, 100, 130]) {
      expect(executionColor(pct)).toBe(stateColor(executionState(pct)));
    }
  });

  it('индекс ряда закольцовывается, а не падает на отрицательном', () => {
    expect(seriesColor(-1)).toMatch(/^var\(--cat-\d+\)$/);
    expect(seriesColor(999)).toMatch(/^var\(--cat-\d+\)$/);
  });
});

describe('отсутствие данных — не обвинение', () => {
  const readers = [
    ['исполнение', executionState],
    ['исполнение управления', deptExecutionState],
    ['доверие', trustState],
    ['доля снижения', economyShareState],
    ['доля ЕП', epShareState],
    ['дисциплина', disciplineIndexState],
  ] as const;

  it('null и NaN дают «не оценено», а не «нарушение»', () => {
    // Главная защита от лжи: управление без плана за период не провалило
    // исполнение — у него нет базы для счёта. Прежде отсутствие базы само
    // приезжало в полосу «нарушение», и восемь управлений с прочерками
    // объявлялись отстающими.
    for (const [name, read] of readers) {
      expect(read(null), `${name}: null принят за величину`).toBe('не оценено');
      expect(read(Number.NaN), `${name}: NaN принят за величину`).toBe('не оценено');
    }
  });

  it('«не оценено» имеет собственную роль и не путается с нормой', () => {
    expect(stateColor('не оценено')).not.toBe(stateColor('норма'));
    expect(stateColor('не оценено')).not.toBe(stateColor('нарушение'));
  });

  it('всякое состояние продублировано словом', () => {
    for (const s of STATES) {
      expect(STATE_LABELS[s]?.length, `${s}: словесный дубль пуст`).toBeGreaterThan(2);
    }
    // Прочерк обязан объяснять себя, а не молчать.
    expect(STATE_LABELS['не оценено']).toMatch(/нет|не оценено/);
  });
});

describe('пороги берутся у реестра, а не сочиняются на месте', () => {
  it('исполнение района: 80 — норма, 50 — черта отставания', () => {
    expect(executionState(85)).toBe('норма');
    expect(executionState(80)).toBe('норма');
    expect(executionState(79)).toBe('внимание');
    expect(executionState(50)).toBe('внимание');
    expect(executionState(49)).toBe('нарушение');
  });

  it('перевыполнение — повод посмотреть, а не отличие', () => {
    expect(executionState(101)).toBe('внимание');
    expect(executionState(100)).toBe('норма');
  });

  it('для отдельного управления черта строже районной', () => {
    // Расхождение осознанное: район усредняет восемь управлений, управление
    // отвечает за себя. 85 % — норма для района и не норма для управления.
    expect(executionState(85)).toBe('норма');
    expect(deptExecutionState(85)).toBe('внимание');
    expect(deptExecutionState(THRESHOLDS.EXECUTION.GOOD * 100)).toBe('норма');
  });

  it('доверие: вердикт проходит по семидесяти пяти', () => {
    expect(trustState(THRESHOLDS.TRUST.A)).toBe('норма');
    expect(trustState(THRESHOLDS.TRUST.B)).toBe('норма');
    expect(trustState(THRESHOLDS.TRUST.B - 1)).toBe('внимание');
    expect(trustState(THRESHOLDS.TRUST.C - 1)).toBe('нарушение');
  });

  it('замечания: ноль — норма, больше трёх — критично', () => {
    expect(criticalIssuesState(0)).toBe('норма');
    expect(criticalIssuesState(1)).toBe('внимание');
    expect(criticalIssuesState(3)).toBe('внимание');
    expect(criticalIssuesState(4)).toBe('нарушение');
  });

  it('снижение цены: свыше четверти — внимание, отрицательное — нарушение', () => {
    expect(economyShareState(30)).toBe('внимание');
    expect(economyShareState(25)).toBe('норма');
    expect(economyShareState(10)).toBe('норма');
    expect(economyShareState(2)).toBe('внимание');
    expect(economyShareState(-1)).toBe('нарушение');
  });

  it('доля ЕП никогда не объявляется нарушением', () => {
    // Закон доли ЕП не нормирует вовсе: он перечисляет случаи и лимиты по
    // сумме, но не по доле. Красить её красным значит выдумывать норму.
    for (const pct of [0, 20, 30, 50, 100]) {
      expect(epShareState(pct), `доля ЕП ${pct} % объявлена нарушением`).not.toBe('нарушение');
    }
    expect(epShareState(40)).toBe('внимание');
    expect(epShareState(20)).toBe('норма');
  });

  it('дисциплина: 75 — норма, ниже 50 — книге верить нельзя', () => {
    expect(disciplineIndexState(80)).toBe('норма');
    expect(disciplineIndexState(75)).toBe('норма');
    expect(disciplineIndexState(60)).toBe('внимание');
    expect(disciplineIndexState(49)).toBe('нарушение');
  });
});
