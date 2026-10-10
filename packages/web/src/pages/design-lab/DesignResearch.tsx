import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Command } from 'cmdk';
import { Check, CircleHelp, Command as CommandIcon, Eye, Layers, Search, ShieldAlert, SlidersHorizontal, X } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { FINISHES, ORIGINAL_FAMILIES, type FamilyId, type FinishId, type NavSection } from './catalog';
import type { LabPreset } from './presets';
import { LAB_DEMO_ROWS, LAB_DEMO_TOTAL_THOUSANDS } from './demo-data';
import { getChartColors } from '@/lib/chart-colors';
import { AURORA_STATES, AURORA_VARIANTS, auroraColors, auroraMatrix, familyMatrix, type AuroraVariantId, type AuroraState } from './aurora-research';
import './design-research.css';

type ResearchView = 'aurora' | 'pulse' | 'workflows';
type PulseLayout = 'current' | 'hero' | 'focus';

const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const historicalSources = [
  { title: 'До: 7 августа · лазурь + бронза', url: 'https://github.com/gaben1488/dash/blob/853548a/packages/web/src/index.css' },
  { title: 'Археология цвета и эффекта', url: 'https://github.com/gaben1488/dash/blob/main/docs/superpowers/mockups/zarya-arheologiya.html' },
  { title: 'Поправка 7а: свободные цветовые пары', url: 'https://github.com/gaben1488/dash/blob/main/docs/superpowers/specs/2026-08-22-pulse-feedback-2.md' },
] as const;

function AzureStage({ preset, variant, finish, state, setState }: {
  preset: LabPreset;
  variant: AuroraVariantId;
  finish: FinishId;
  state: AuroraState;
  setState: (state: AuroraState) => void;
}) {
  const palette = auroraColors(variant, preset.family, preset.section);
  const stageStyles = {
    '--dr-top': palette.top,
    '--dr-bottom': palette.bottom,
    '--dr-ink': palette.ink,
    '--dr-glow': variant === 'family' ? palette.top : '#5b99f8',
    '--dr-muted': preset.mode === 'dark' ? '#a9a49c' : '#666057',
    '--dr-card': preset.mode === 'dark' ? '#242320' : '#f8f5ec',
  } as CSSProperties;
  return (
    <div className="dr-aurora-stage" style={stageStyles}
      data-scheme={preset.mode} data-finish={finish} data-motion={preset.motion ? 'on' : 'off'}>
      <div className="dr-demo-header">
        <div><span>ЦВЕТ И МАТЕРИАЛ / УЧЕБНЫЙ ПРЕДМЕТ</span><h3>{preset.section}</h3></div>
        <span className="dr-readable" data-valid={palette.contrastPass}>
          {palette.contrastPass ? 'Читаемые концы пары' : 'Архивная пара: контраст не проходит'}
        </span>
      </div>
      <div className="dr-aurora-hardware" aria-label="Варианты поведения физического предмета">
        <div className="dr-glass-rail">
          <span className="dr-rail-eyebrow">Небо и горизонт</span>
          <button type="button" className="dr-hardware-control" data-state={state}
            aria-pressed={state === 'selected'} disabled={state === 'disabled'}
            onClick={() => setState(state === 'selected' ? 'idle' : 'selected')}>
            <span className="dr-dawn-layer" aria-hidden="true" />
            <span className="dr-control-text">{state === 'danger' ? 'Проверить ошибку' : state === 'partial' ? 'Частично · 2026' : preset.section}</span>
            {state === 'selected' && <Check size={14} aria-hidden="true" />}
          </button>
          <p>Контрастная пара — внутри выбранного элемента. Стекло живёт на барабане; текст и данные остаются матовыми.</p>
        </div>
        <div className="dr-hardware-context">
          <div><span>2025</span><strong>2026</strong><span>2027</span></div>
          <div className="dr-rest-state"><span>Все месяцы</span><span>Есть 2 условия</span></div>
          <p>Годы, недели, частичный отбор и возвращение фокуса здесь обозначены, но рабочий барабан не заменяются этим образцом. Его оригинал — во вкладке «Исходные HTML».</p>
        </div>
      </div>
      <div className="dr-stage-foot">
        <span>Небо {palette.top} · горизонт {palette.bottom} · подпись {palette.ink}</span>
        <strong>Минимальный контраст {Math.min(palette.topContrast, palette.bottomContrast).toFixed(2)}:1</strong>
      </div>
    </div>
  );
}

function AuroraResearch({ preset, onSelect, variant, onVariant }: {
  preset: LabPreset;
  onSelect: (update: { family?: FamilyId; section?: NavSection }) => void;
  variant: AuroraVariantId;
  onVariant: (variant: AuroraVariantId) => void;
}) {
  const [finish, setFinish] = useState<FinishId>('candy');
  const [state, setState] = useState<AuroraState>('selected');
  const pairs = familyMatrix();
  const matrix = auroraMatrix();
  const color = auroraColors(variant, preset.family, preset.section);
  return (
    <div className="dr-section">
      <div className="dr-section-intro">
        <div><h2>Лазурь, которую потеряли</h2><p>Сравнение эпох 7–10 и 14 августа, восстановление читаемости и 39 независимых пар для всех вкладок.</p></div>
        <a href={historicalSources[1].url} target="_blank" rel="noreferrer">Археология оригинала ↗</a>
      </div>
      <div className="dr-variant-grid" aria-label="Пять проверяемых направлений">
        {AURORA_VARIANTS.map(item => {
          const pair = auroraColors(item.id, preset.family, preset.section);
          return <button type="button" key={item.id} aria-pressed={item.id === variant}
            className="dr-variant" onClick={() => onVariant(item.id)}>
            <span className="dr-variant-swatch" style={{ background: 'linear-gradient(180deg, ' + pair.top + ', ' + pair.bottom + ')', color: pair.ink }}>
              {item.id === 'historical' ? '07.08' : item.id === 'cream' ? '14.08' : preset.section}
            </span>
            <strong>{item.title}</strong>
            <small>{item.status === 'archive' ? 'Историческое свидетельство' : item.status === 'original' ? 'Оригинальная пара' : 'Контрастная альтернатива'}</small>
          </button>;
        })}
      </div>
      <div className="dr-material-controls">
        <fieldset>
          <legend>Отделка выбранного предмета</legend>
          <div className="dr-segments">
            {FINISHES.map(item => <button type="button" key={item.id} aria-pressed={finish === item.id} onClick={() => setFinish(item.id)}>{item.label}</button>)}
          </div>
        </fieldset>
        <fieldset>
          <legend>Состояние</legend>
          <div className="dr-segments">
            {AURORA_STATES.map(item => <button type="button" key={item.id} aria-pressed={state === item.id} onClick={() => setState(item.id)} title={item.meaning}>{item.title}</button>)}
          </div>
        </fieldset>
      </div>
      <AzureStage preset={preset} variant={variant} finish={finish} state={state} setState={setState} />
      <div className="dr-audit-row">
        <div className="dr-audit-note"><ShieldAlert size={16} aria-hidden="true" />
          <p>{AURORA_VARIANTS.find(item => item.id === variant)!.message} {color.contrastPass
            ? 'Цвет подписей проверен на концах градиента; физические блики требуют проверки отрендеренного изображения.'
            : 'Эта историческая комбинация никогда не предлагается для внедрения без изменения подписи/пары.'}</p>
        </div>
        <div className="dr-audit-stat">
          <strong>{pairs.length}</strong><span>подлинных пар</span>
          <strong>{matrix.length}</strong><span>сочетаний пар, состояний и отделок в контролируемом перечне</span>
        </div>
      </div>
      <div className="dr-section-intro dr-intro-secondary">
        <div><h3>Все семейства, без случайных градиентов</h3><p>Выберите другую вкладку или семейство: макет и проверки переключатся на точные исходные цвета, без обязательного бронзового низа.</p></div>
      </div>
      <div className="dr-family-matrix">
        {ORIGINAL_FAMILIES.map(family =>
          <section key={family.id}>
            <h4>{family.label}</h4>
            <div className="dr-family-grid">
              {family.sections.map(part => <button type="button"
                key={part.name}
                aria-pressed={preset.family === family.id && preset.section === part.name}
                onClick={() => { onSelect({ family: family.id, section: part.name }); onVariant('family'); }}>
                <span style={{ background: 'linear-gradient(180deg, ' + part.top + ', ' + part.bottom + ')', color: part.ink }}>{part.name}</span>
                <small>{part.motif}</small>
              </button>)}
            </div>
          </section>
        )}
      </div>
      <div className="dr-provenance">
        {historicalSources.map(item => <a key={item.url} href={item.url} rel="noreferrer" target="_blank">{item.title} ↗</a>)}
      </div>
    </div>
  );
}

function PulseResearch({ preset }: { preset: LabPreset }) {
  const [layout, setLayout] = useState<PulseLayout>('hero');
  const [dept, setDept] = useState<string | null>(null);
  const [scale, setScale] = useState<'thousands' | 'millions'>('thousands');
  const chartColors = getChartColors(preset.mode === 'dark');
  const departments = useMemo(() => [...new Set(LAB_DEMO_ROWS.map(row => row.org))].map(name => ({
    id: name,
    name,
    value: LAB_DEMO_ROWS.filter(row => row.org === name).reduce((sum, row) => sum + row.planThousands, 0),
  })), []);
  const rows = dept ? LAB_DEMO_ROWS.filter(row => row.org === dept) : LAB_DEMO_ROWS;
  const segments = dept ? rows.map(row => ({ id: row.id, name: row.id + ' · ' + row.work.replace('ДЕМО · ', ''), value: row.planThousands })) : departments;
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const chartHeight = layout === 'current' ? 210 : layout === 'hero' ? 330 : 380;
  const innerRadius = layout === 'current' ? 58 : layout === 'hero' ? 96 : 114;
  const outerRadius = layout === 'current' ? 85 : layout === 'hero' ? 136 : 164;
  function money(value: number) {
    return fmt.format(scale === 'thousands' ? value : value / 1000) + (scale === 'thousands' ? ' тыс. ₽' : ' млн ₽');
  }
  return (
    <div className="dr-section">
      <div className="dr-section-intro">
        <div><h2>«Пульс»: вернуть масштаб главному показателю</h2><p>Текущее размещение — треть строки, круг 210 px. Три альтернативы, одна и та же учебная база и сохранённая логика раскрытия.</p></div>
        <a href="https://github.com/gaben1488/dash/blob/main/packages/web/src/components/charts/DrillPieChart.tsx#L811-L862"
          rel="noreferrer" target="_blank">Действующий компонент ↗</a>
      </div>
      <div className="dr-layout-options">
        {([
          ['current', 'Сейчас · малый', '210 px · радиус 85 · треть строки'],
          ['hero', 'Рекомендовано · крупный', '330 px · полная площадь карточки'],
          ['focus', 'Исследовать · акцент', '380 px · легенда и доказательства'],
        ] as const).map(([id, title, description]) =>
          <button type="button" key={id} aria-pressed={layout === id} onClick={() => { setLayout(id); setDept(null); }}>
            <strong>{title}</strong><span>{description}</span>
          </button>)}
      </div>
      <div className="dr-pulse-composition" data-layout={layout}>
        <div className="dr-pulse-heading">
          <div><span>ДЕМО · ПЛАН ПО УПРАВЛЕНИЯМ</span><h3>{dept ? 'Состав ' + dept : 'Доли по управлениям'}</h3>
            <p>Показатель: план, сумма складывается из исходных строк. Ни проценты исполнения, ни фактическая экономия здесь не выдумываются.</p>
          </div>
          <div className="dr-pulse-units" role="group" aria-label="Единицы отображения">
            <button type="button" aria-pressed={scale === 'thousands'} onClick={() => setScale('thousands')}>тыс. ₽</button>
            <button type="button" aria-pressed={scale === 'millions'} onClick={() => setScale('millions')}>млн ₽</button>
          </div>
        </div>
        <div className="dr-pulse-data">
          <div className="dr-pulse-chart" aria-label="Учебная круговая диаграмма">
            <ResponsiveContainer width="100%" height={chartHeight}>
              <PieChart>
                <Pie data={segments} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={innerRadius} outerRadius={outerRadius} paddingAngle={1.5}
                  isAnimationActive={preset.motion}>
                  {segments.map((entry, i) => <Cell key={entry.id} fill={chartColors[i % chartColors.length]} stroke={preset.mode === 'dark' ? '#141412' : '#f8f5ec'} strokeWidth={2} />)}
                </Pie>
                <Tooltip formatter={(value: number) => money(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="dr-pulse-center" aria-hidden="true"><span>{dept ?? 'Всего · план'}</span><strong>{money(total)}</strong><small>{segments.length} {segments.length === 1 ? 'часть' : 'части'}</small></div>
          </div>
          <div className="dr-pulse-legend">
            {dept && <button type="button" className="dr-back" onClick={() => setDept(null)}>← Все управления</button>}
            {segments.map((part,i) => <button type="button" key={part.id}
              onClick={() => { if (!dept) setDept(part.id); }}
              aria-label={dept ? 'Учебная строка ' + part.id : 'Открыть состав ' + part.id}
              title={dept ? 'На этом уровне строки только учебные' : 'Нажмите для раскрытия в этом же блоке'}>
              <span className="dr-slice-dot" style={{ background: chartColors[i % chartColors.length] }} aria-hidden="true" />
              <span className="dr-legend-name">{part.name}</span>
              <strong>{money(part.value)}</strong>
              <em>{total > 0 ? fmt.format(part.value * 100 / total) : '—'}%</em>
            </button>)}
            <p>Сумма срезов: {money(total)}. Источник в демонстрации: {rows.length} учебные строки из единого набора. В рабочем Dash нужен реальный MDM, периметр и ссылка на исходный лист.</p>
          </div>
        </div>
        <div className="dr-pulse-footer">
          <span><CircleHelp size={14} aria-hidden="true" /> Детализация без перехода; возврат одним действием; масштаб изменяет только представление.</span>
          <span>Рабочий DrillPieChart обладает также разрезами бюджета, способа и исполнения. Их необходимо сохранить при внедрении.</span>
        </div>
      </div>
      <div className="dr-pulse-compare">
        <div><strong>Что запрещено терять при увеличении</strong><p>Период расчёта, ГРБС/подведы, бюджеты, способ, стек раскрытия, штриховки, отрицательные/нулевые срезы, несоответствие суммы частей целому, источник числа, клавиатурные переходы.</p></div>
        <div><strong>Что улучшается</strong><p>Круг занимает заметную часть содержимого, название доступно полностью, проценты и суммы читаются в отдельной легенде. Раскрытие происходит в карточке без незаметного глобального фильтра.</p></div>
      </div>
    </div>
  );
}

function WorkflowResearch({ onOpenCommands }: { onOpenCommands: () => void }) {
  const [phase, setPhase] = useState<'seen' | 'read' | 'checked'>('seen');
  const [detail, setDetail] = useState(false);
  return <div className="dr-section">
    <div className="dr-section-intro">
      <div><h2>Важная механика прежде украшений</h2><p>Выбор, сохранение контекста, источник, реакция на отказ, возврат и действия — всё в одном понятном потоке.</p></div>
    </div>
    <div className="dr-workflow-grid">
      <section>
        <span className="dr-overline">ЛУЧШЕ КИЛОМЕТРА КНОПОК</span>
        <h3>Контекстная палитра команд</h3>
        <p>На экране только главные действия; редкие инструменты ищутся по задаче. Команда меняет исключительно состояние лаборатории.</p>
        <button className="dr-command-trigger" type="button" onClick={onOpenCommands}><Search size={17} /> Найти действие <kbd>Ctrl / ⌘ K</kbd></button>
        <p>Основано на командных меню Linear: контекст и поиск вместо размножения однотипных кнопок.</p>
      </section>
      <section>
        <span className="dr-overline">ДОКАЗАТЕЛЬСТВО РЯДОМ С ДЕЙСТВИЕМ</span>
        <h3>Увидено ≠ прочитано ≠ проверено</h3>
        <p>Учебная версия v1 остаётся активной до явного подтверждения. Никакого запроса в реальный API.</p>
        <div className="dr-workflow-steps">
          <span aria-current={phase === 'seen' ? 'step' : undefined}>1 · Замечено</span>
          <span aria-current={phase === 'read' ? 'step' : undefined}>2 · Прочитано</span>
          <span aria-current={phase === 'checked' ? 'step' : undefined}>3 · Проверено</span>
        </div>
        {phase === 'seen' && <button type="button" onClick={() => setPhase('read')}>Прочитать основание</button>}
        {phase === 'read' && <><p>Источник: ДЕМО · D14 · сумма 4 200 тыс. ₽; отмечена необходимость уточнить основание.</p>
          <button type="button" onClick={() => setPhase('checked')}>Подтвердить учебную проверку</button></>}
        {phase === 'checked' && <p role="status">Учебное действие отмечено; это не официальное изменение источника.</p>}
        <button type="button" className="dr-secondary" onClick={() => setPhase('seen')}>Повторить сценарий</button>
      </section>
      <section>
        <span className="dr-overline">ПРОГРЕССИВНОЕ РАСКРЫТИЕ</span>
        <h3>Знать причину, не уходя со страницы</h3>
        <p>Показать только полезное по умолчанию, но не скрывать доказательства за техническими вкладками.</p>
        <button type="button" aria-expanded={detail} onClick={() => setDetail(!detail)}>
          {detail ? 'Свернуть доказательства' : 'Открыть доказательства'} <Layers size={15} />
        </button>
        {detail && <dl className="dr-source-details">
          <div><dt>Запись</dt><dd>УО · 173/1</dd></div>
          <div><dt>Источник</dt><dd>ДЕМО · строка 14 · D14</dd></div>
          <div><dt>Примечание</dt><dd>Уточнить основание суммы</dd></div>
          <div><dt>Обсуждение</dt><dd>Ожидается ответ исполнителя</dd></div>
        </dl>}
      </section>
      <section>
        <span className="dr-overline">МАТЕРИАЛ ПО РОЛИ</span>
        <h3>Не делать все карточки стеклянными</h3>
        <p>Стекло — барабаны и управление. Кэнди — выбранный предмет. Мат — длинные таблицы. Ксираллик — крайне редкое подтверждённое событие.</p>
        <div className="dr-roles">
          <span>Стекло · навигация</span><span>Мат · данные</span><span>Кэнди · выбор</span><span>Глина · предупреждение</span>
        </div>
      </section>
    </div>
  </div>;
}

function CommandPalette({ onClose, onView, onFamily, onVariant }: {
  onClose: () => void;
  onView: (view: ResearchView) => void;
  onFamily: (family: FamilyId) => void;
  onVariant: (variant: AuroraVariantId) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  function action(f: () => void) { f(); onClose(); }
  return <div className="dr-command-backdrop">
    <div className="dr-command-dialog" role="dialog" aria-label="Поиск действий" aria-modal="true">
      <Command label="Найти действие">
        <div className="dr-command-top"><Search size={18} aria-hidden="true" />
          <Command.Input ref={input} placeholder="Что сделать в лаборатории?" aria-label="Искать команду" />
          <button type="button" onClick={onClose} aria-label="Закрыть поиск"><X size={18} /></button>
        </div>
        <Command.List>
          <Command.Empty>Нет такого действия — уточните запрос.</Command.Empty>
          <Command.Group heading="Разделы">
            <Command.Item onSelect={() => action(() => onView('aurora'))}>Исследовать лазурь и палитры</Command.Item>
            <Command.Item onSelect={() => action(() => onView('pulse'))}>Сравнить крупный круг «Пульса»</Command.Item>
            <Command.Item onSelect={() => action(() => onView('workflows'))}>Изучить механики и кнопки</Command.Item>
          </Command.Group>
          <Command.Group heading="Проверяемые цвета">
            <Command.Item onSelect={() => action(() => { onVariant('recovered'); onView('aurora'); })}>Вернуть читаемую лазурь 7 августа</Command.Item>
            <Command.Item onSelect={() => action(() => { onVariant('twilight'); onView('aurora'); })}>Проверить глубокую ночную зарю</Command.Item>
            <Command.Item onSelect={() => action(() => { onVariant('cream'); onView('aurora'); })}>Сравнить кремовую редакцию 14 августа</Command.Item>
          </Command.Group>
          <Command.Group heading="Семейства">
            {ORIGINAL_FAMILIES.map(family => <Command.Item key={family.id}
              onSelect={() => action(() => { onFamily(family.id); onView('aurora'); onVariant('family'); })}>
              Выбрать семейство {family.label}
            </Command.Item>)}
          </Command.Group>
        </Command.List>
      </Command>
      <div className="dr-command-bottom">↑↓ выбрать · Enter выполнить · Esc закрыть · только демонстрация</div>
    </div>
  </div>;
}

export function DesignResearch({ preset, onPresetChange }: {
  preset: LabPreset;
  onPresetChange: (update: Partial<LabPreset>) => void;
}) {
  const [view, setView] = useState<ResearchView>('aurora');
  const [commandOpen, setCommandOpen] = useState(false);
  const launch = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, select, [contenteditable="true"]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen(open => !open);
      } else if (e.key === '/' && !editing && !e.altKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setCommandOpen(true);
      } else if (e.key === 'Escape') {
        setCommandOpen(false);
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const [commandVariant, setCommandVariant] = useState<AuroraVariantId>('recovered');

  return <div className="dr-root">
    <div className="dr-topline">
      <div><span>ОСНОВАНО НА КОДЕ DASH И РАЗБОРЕ APPLE / LINEAR</span><h2>Мастерская продукта</h2>
        <p>Реальные исходные цвета и существующие компоненты. Варианты не меняют рабочую систему без принятия.</p>
      </div>
      <button ref={launch} type="button" onClick={() => setCommandOpen(true)} className="dr-command-open">
        <CommandIcon size={16} /> Команды <kbd>⌘ K</kbd>
      </button>
    </div>
    <div className="dr-view-tabs" role="group" aria-label="Исследования">
      {([
        ['aurora', 'Лазурь и отделки'],
        ['pulse', 'Большой круг «Пульса»'],
        ['workflows', 'Механизмы'],
      ] as const).map(([key,label]) =>
        <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>
      )}
    </div>
    {view === 'aurora' && <AuroraResearch preset={preset} onSelect={onPresetChange} variant={commandVariant} onVariant={setCommandVariant} />}
    {view === 'pulse' && <PulseResearch preset={preset} />}
    {view === 'workflows' && <WorkflowResearch onOpenCommands={() => setCommandOpen(true)} />}
    {commandOpen && <CommandPalette onClose={() => { setCommandOpen(false); launch.current?.focus(); }}
      onView={setView} onFamily={family => onPresetChange({ family })} onVariant={setCommandVariant} />}
    <span className="dr-sr" aria-live="polite">Выбранное историческое направление: {commandVariant}</span>
  </div>;
}
