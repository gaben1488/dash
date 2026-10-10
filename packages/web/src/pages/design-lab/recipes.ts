/**
 * Extensible UI recipe inventory for Dash's internal developer laboratory.
 *
 * Rules:
 * - These are examples and acceptance contracts, not alternate business logic.
 * - Use production components instead of copying them or inventing new APIs.
 * - Real source links resolve to the existing main branch at creation time.
 * - Demonstration data is fictitious and never written to a register.
 */
export const COMPONENT_INDEX = [
  { id: 'button', title: 'Действие', path: 'packages/web/src/components/ui/button.tsx', purpose: 'Единый размер, приоритет, запрет ложного успеха', category: 'Контролы' },
  { id: 'segmented', title: 'Режим счёта', path: 'packages/web/src/components/ui/segmented.tsx', purpose: 'Радиогруппа с названным последствием выбора', category: 'Контролы' },
  { id: 'chip', title: 'Фильтр и метка', path: 'packages/web/src/components/ui/chip.tsx', purpose: 'Выбор через aria-pressed, семантический цвет', category: 'Контролы' },
  { id: 'card', title: 'Поверхность', path: 'packages/web/src/components/ui/card.tsx', purpose: 'Один дом рамок; никаких вложенных приподнятых карточек', category: 'Композиция' },
  { id: 'stat', title: 'Число с контекстом', path: 'packages/web/src/components/ui/stat.tsx', purpose: 'Единица, период, причина отсутствия числа', category: 'Данные' },
  { id: 'origin', title: 'Откуда число', path: 'packages/web/src/components/ui/origin.tsx', purpose: 'Провенанс источника рядом с числом', category: 'Данные' },
  { id: 'freshness', title: 'Состояние сверки', path: 'packages/web/src/components/ui/freshness.tsx', purpose: 'Причина и действие, если сверка не состоялась', category: 'Данные' },
  { id: 'data-table', title: 'Таблица реестра', path: 'packages/web/src/components/ui/data-table.tsx', purpose: 'Sticky, двойной адрес, формулы, сигналы в строке', category: 'Данные' },
  { id: 'empty-state', title: 'Пустой / аварийный экран', path: 'packages/web/src/components/EmptyState.tsx', purpose: 'Честная причина, действие, технические подробности', category: 'Состояния' },
  { id: 'toast', title: 'Уведомление', path: 'packages/web/src/components/ui/toast.tsx', purpose: 'Результат действия, отказ с дальнейшим шагом', category: 'Состояния' },
  { id: 'theme', title: 'Свет и тьма', path: 'packages/web/src/components/ThemeProvider.tsx', purpose: 'Единственный переключатель действующей темы', category: 'Облик' },
  { id: 'tokens', title: 'Роли облика', path: 'packages/web/src/components/ui/tokens.ts', purpose: 'Порядок текста, отступов, линий, данных и хрома', category: 'Облик' },
  { id: 'density', title: 'Плотность', path: 'packages/web/src/components/ui/density.ts', purpose: 'Два режима без ручной смены кегля', category: 'Облик' },
  { id: 'chart-theme', title: 'Графический язык', path: 'packages/web/src/components/ui/chart-theme.ts', purpose: 'Сетка, оси, легенды через смысловые переменные', category: 'Облик' },
  { id: 'kit', title: 'Витрина рабочих элементов', path: 'packages/web/src/pages/Kit.tsx', purpose: 'Живой dev-стенд существующей дизайн-системы', category: 'Инструменты' },
] as const;

export type ComponentId = (typeof COMPONENT_INDEX)[number]['id'];
export type RecipeId =
  'source-metric' | 'source-row' | 'triage' | 'filters' |
  'reliable-update' | 'honest-empty' | 'typography' | 'material';

export interface UiRecipe {
  id: RecipeId;
  title: string;
  category: 'Основания' | 'Рабочие действия' | 'Состояния' | 'Облик';
  answer: string;
  rationale: string;
  mistake: string;
  criteria: readonly string[];
  components: readonly ComponentId[];
  status: 'production-parts' | 'concept';
  code: string;
}

/** Concrete, directly reusable combinations; avoid imitating backend guarantees. */
export const UI_RECIPES: readonly UiRecipe[] = [
  {
    id: 'source-metric', title: 'Число с доказательством', category: 'Основания',
    answer: 'Можно ли пользоваться конкретным числом и где проверить его происхождение?',
    rationale: 'Вместо второго экрана «пояснения» ставим источник и отметку сверки рядом с числом.',
    mistake: 'Красивое крупное число без базы, момента чтения, сверки и адреса источника.',
    criteria: ['Число не подменяет отсутствие данных нулём', 'У источника есть двойной адрес', 'Неудачная сверка содержит действие'],
    components: ['stat', 'origin', 'freshness'],
    status: 'production-parts',
    code: "import { Stat } from '@/components/ui/stat';\nimport { FreshnessMark } from '@/components/ui/freshness';\nimport { Origin } from '@/components/ui/origin';\n\n<Stat label=\"План\" value=\"7 800\" unit=\"тыс. ₽\" scope=\"2026 · учебный пример\" />\n<Origin metric=\"План\" source=\"ДЕМО — книга\" howSourceCounts=\"Значение поля без пересчёта\" match=\"initiative\" sheetRef=\"Лист · D14\" rowAddress=\"строка 14 · № п/п 173/1\"><span>Откуда число</span></Origin>\n<FreshnessMark info={{ state: 'uncovered', reason: 'Сверка не настроена', whatToDo: 'Проверьте исходный лист' }} />",
  },
  {
    id: 'source-row', title: 'Строка и её проблема', category: 'Основания',
    answer: 'Как найти конкретную закупку и понять, что исправлять?',
    rationale: 'Формула, двойной адрес и сигнал остаются в таблице, а не превращаются в удалённый рейтинг.',
    mistake: 'Строка исчезает из реестра, замечание остаётся без адреса; составной номер обрезается.',
    criteria: ['Номер 173/1 остаётся строкой', 'Признак формулы виден в заголовке', 'Проблема названа текстом'],
    components: ['data-table'],
    status: 'production-parts',
    code: "import { DataTable, THead, TBody, Tr, Th, Td, RowAddress, RowSignals } from '@/components/ui/data-table';\n<DataTable caption=\"ДЕМО · реестр · 2026\">\n  <THead><Tr><Th>Адрес</Th><Th formula>Сумма</Th><Th>Что исправить</Th></Tr></THead>\n  <TBody><Tr signalTone=\"warn\"><Td><RowAddress row={14} seq=\"173/1\" /></Td><Td formula numeric>7 800</Td><Td><RowSignals signals={[{label:'Нужен источник',tone:'warn'}]} /></Td></Tr></TBody>\n</DataTable>",
  },
  {
    id: 'triage', title: 'Провести человека через исправление', category: 'Рабочие действия',
    answer: 'Как исправить обнаруженную проблему без хождения по пяти вкладкам?',
    rationale: 'Отделяем причину, шаг, источник и результат. Показываем сначала одно действие.',
    mistake: 'Штрафной балл, красная метка и кнопка «исправить всё» без объяснения.',
    criteria: ['Есть следующая конкретная операция', 'Объяснение остаётся в контексте', 'Нельзя сообщать успех до подтверждения'],
    components: ['button', 'card', 'chip', 'origin'],
    status: 'concept',
    code: "import { Card, CardHeader, CardDivider } from '@/components/ui/card';\nimport { Button } from '@/components/ui/button';\n<Card><CardHeader title=\"Подтвердите источник суммы\" note=\"ДЕМО · строка 173/1\" /><CardDivider /><p>Откройте ячейку и проверьте формулу, затем запишите основание.</p><Button tone=\"primary\" onClick={showSource}>Открыть источник</Button></Card>",
  },
  {
    id: 'filters', title: 'Фильтры, не меняющие смысл данных', category: 'Рабочие действия',
    answer: 'Как выбрать нужный срез и потом восстановить прежний?',
    rationale: 'Выбор слышен, состав показан, сброс объяснён, логика сохраняет ноль результатов.',
    mistake: 'Вариант «ничего не выбрано» бесшумно интерпретируется как «все».',
    criteria: ['aria-pressed у каждого переключателя', 'Число строк честно пересчитывается', 'Сброс — отдельное действие'],
    components: ['chip', 'segmented', 'button'],
    status: 'production-parts',
    code: "import { Chip } from '@/components/ui/chip';\nimport { Button } from '@/components/ui/button';\n<Chip tone=\"accent\" pressed={selected} onClick={() => setSelected(!selected)}>УО</Chip>\n<Button tone=\"quiet\" onClick={resetFilters}>Сбросить отбор</Button>",
  },
  {
    id: 'reliable-update', title: 'Изменение без подмены версии', category: 'Состояния',
    answer: 'Что значит «изменение обнаружено», «прочитано», «применено»?',
    rationale: 'Не обновляем рабочие цифры, пока новый снимок не принят и контекст не сохранён.',
    mistake: 'Нажатие «скрыть уведомление» приравнивается к применению новых данных.',
    criteria: ['Различать увидено и прочитано', 'Не потерять черновик', 'Показывать сохранённую старую версию при отказе'],
    components: ['button', 'card', 'toast'],
    status: 'concept',
    code: "// Не писать бизнес-состояние в библиотеке. Реальное обновление — через LiveUpdateBar.\n// Вариант сценария: detected → read → ready → applied, error → previous snapshot retained.",
  },
  {
    id: 'honest-empty', title: 'Пустота ≠ ноль ≠ сбой', category: 'Состояния',
    answer: 'Почему список пуст и что читателю делать дальше?',
    rationale: 'Нейтральная пустота и потеря ответа сервера — разные события и разные действия.',
    mistake: 'Показывать пустую таблицу как «всё хорошо», когда чтение источника сорвалось.',
    criteria: ['Описана причина', 'Есть полезное действие', 'Нет поддельных нулей и сумм'],
    components: ['empty-state', 'stat', 'button'],
    status: 'production-parts',
    code: "import { EmptyState } from '@/components/EmptyState';\n<EmptyState title=\"Под выбранный период записей нет\" description=\"Снимок прочитан, но отбор вернул пустой список.\" action={{label:'Сбросить отбор',onClick:resetFilters}} />",
  },
  {
    id: 'typography', title: 'Типографика цифр и смыслов', category: 'Облик',
    answer: 'Как одновременно читать крупные итоги и плотные 1000-строчные реестры?',
    rationale: 'Используем девять ролей кегля, табличные цифры и две плотности, не повышаем контраст повсюду.',
    mistake: 'Маленькая подпись без даты, пропавшая граница сумм и разные гарнитуры в одном блоке.',
    criteria: ['Читаемые названия и числа при 200%', 'Цифры tabular-nums', 'Плотность не уменьшает шрифт'],
    components: ['tokens', 'density', 'stat', 'card'],
    status: 'production-parts',
    code: "import { textClass } from '@/components/ui/tokens';\nconst headline = textClass('text-lg');\n// Применяйте ds-text-*, tabular-nums и --row-h вместо произвольных px.\n// Никогда не масштабируйте текст через transform.",
  },
  {
    id: 'material', title: 'Материал поверх геометрии', category: 'Облик',
    answer: 'Как добавить кэнди/металл/стекло, не ухудшив чтение?',
    rationale: 'Физика поверхности отделена от семантического цвета и не рисуется под массивами текста.',
    mistake: 'Заливать все строки шиммером, заменять барабан кнопочной сеткой и красить предупреждения по теме раздела.',
    criteria: ['Материал имеет предмет и ограничение', 'Семантический цвет сигнала не меняется', 'Reduced motion и контраст проверены'],
    components: ['tokens', 'card', 'button'],
    status: 'concept',
    code: "/* Демонстрационное оформление строго на контейнере, не :root. */\n.dash-design-preview { --dl-top: #4a6da6; --dl-bottom: #324b78; }\n/* Берите настоящую геометрию из pulse.html и действующего Header, не из стенда. */",
  },
] as const;

const RECIPE_IDS = new Set(UI_RECIPES.map((item) => item.id));
const COMPONENT_IDS = new Set<string>(COMPONENT_INDEX.map((item) => item.id));
if (RECIPE_IDS.size !== UI_RECIPES.length) throw new Error('Duplicate UI recipe id');
for (const recipe of UI_RECIPES) {
  if (recipe.components.some((id) => !COMPONENT_IDS.has(id))) throw new Error('Unknown UI component in ' + recipe.id);
}

export function searchRecipes(query: string, category?: UiRecipe['category']): UiRecipe[] {
  const needle = query.trim().toLocaleLowerCase('ru');
  return UI_RECIPES.filter((item) =>
    (!category || item.category === category) &&
    (!needle || [item.title, item.answer, item.rationale, item.mistake].some((text) =>
      text.toLocaleLowerCase('ru').includes(needle)))
  );
}
