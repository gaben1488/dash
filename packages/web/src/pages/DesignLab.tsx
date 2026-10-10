import { useMemo, useState, type CSSProperties } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowLeft, Check, Copy, Download, Eye, FileCode2, Layers,
  RotateCcw, Save, Search, ShieldCheck, Trash2, TriangleAlert,
} from 'lucide-react';
import {
  EXPERIMENTAL_SURFACES, FINISHES, LAYOUTS, NAV_SECTIONS, ORIGINAL_FAMILIES,
  findFamily, findPair, findSurface, type FamilyId, type FinishId,
  type LayoutId, type NavSection, type SurfaceId,
} from './design-lab/catalog';
import {
  DEFAULT_PRESET, buildScopedCSS, evaluateContrast, exportPresetPack,
  parsePresetPackJSON, readStoredPresets, upsertPreset, writeStoredPresets,
  type LabPreset,
} from './design-lab/presets';
import { PatternGallery } from './design-lab/PatternGallery';
import './design-lab.css';

type Mode = 'ready' | 'pending' | 'error' | 'empty';
type Dept = 'all' | 'УО' | 'УКСиМП';
type Feedback = { kind: 'ok' | 'error' | 'note'; text: string } | null;
interface PreviewSession {
  query: string;
  dept: Dept;
  selectedRow: string | null;
  sourceOpen: boolean;
  updatePhase: 'seen' | 'read' | 'applied';
}
const INITIAL_SESSION: PreviewSession = {
  query: '', dept: 'all', selectedRow: '173/1', sourceOpen: false, updatePhase: 'seen',
};

const DEMO_ROWS = [
  { id: '173/1', org: 'УО', work: 'ДЕМО · Оснащение школы', plan: '4 200', state: 'Нужен источник', issue: true, source: 'Учебный лист · D14', formula: 'D14: 4 200 тыс. ₽; источник не подтверждён', note: 'Примечание ячейки: уточнить основание суммы', discussion: 'Обсуждение: вопрос направлен исполнителю, ответа нет', action: 'Сверить исходную ячейку и основание суммы.' },
  { id: '173/2', org: 'УКСиМП', work: 'ДЕМО · Ремонт учреждения', plan: '7 800', state: 'Проверено', issue: false, source: 'Учебный лист · D15', formula: 'D15: 7 800 тыс. ₽ (учебный пример)', note: 'Примечаний нет', discussion: 'Обсуждений нет', action: 'В этом учебном примере дополнительных действий нет.' },
  { id: '174', org: 'УО', work: 'ДЕМО · Приобретение оборудования', plan: '1 620', state: 'Нужен комментарий', issue: true, source: 'Учебный лист · D16', formula: 'D16: 1 620 тыс. ₽ (учебный пример)', note: 'Примечание ячейки: ожидаем пояснение', discussion: 'Обсуждение: уточнить срок и ответственное лицо', action: 'Запросить пояснение к строке 174.' },
] as const;

function previewStyle(recipe: LabPreset): CSSProperties {
  const pair = findPair(recipe.family, recipe.section);
  const surface = findSurface(recipe.surface)[recipe.mode];
  return {
    '--dl-bg': surface.bg,
    '--dl-card': surface.card,
    '--dl-raised': surface.raised,
    '--dl-ink': surface.ink,
    '--dl-muted': surface.muted,
    '--dl-line': surface.line,
    '--dl-top': pair.top,
    '--dl-bottom': pair.bottom,
    '--dl-accent-ink': pair.ink,
  } as CSSProperties;
}

function ContrastLabel({ preset }: { preset: LabPreset }) {
  const ratio = evaluateContrast(preset);
  return (
    <span className={'dl-contrast ' + (ratio.passes ? 'is-pass' : 'is-fail')}>
      {ratio.passes ? <Check size={13} aria-hidden="true" /> : <TriangleAlert size={13} aria-hidden="true" />}
      Текст / концы градиента: {ratio.top.toFixed(2)} / {ratio.bottom.toFixed(2)} : 1
      {ratio.passes ? ' · ≥ 4,5' : ' · нужна коррекция'}
    </span>
  );
}

function Preview({
  recipe, onSelectSection, demoMode, onMode, session, onSessionChange, readOnly = false,
}: {
  recipe: LabPreset;
  onSelectSection?: (section: NavSection) => void;
  demoMode: Mode;
  onMode?: (mode: Mode) => void;
  readOnly?: boolean;
  session: PreviewSession;
  onSessionChange?: (change: Partial<PreviewSession>) => void;
}) {
  const { query, dept, selectedRow, sourceOpen, updatePhase } = session;
  const changeSession = (change: Partial<PreviewSession>) => onSessionChange?.(change);
  const filtered = DEMO_ROWS.filter((row) =>
    (dept === 'all' || row.org === dept) &&
    (row.id.toLocaleLowerCase('ru') + ' ' + row.work.toLocaleLowerCase('ru'))
      .includes(query.trim().toLocaleLowerCase('ru'))
  );
  const rows = demoMode === 'empty' ? [] : filtered;
  const issues = rows.filter((row) => row.issue).length;
  const checked = rows.length - issues;
  const activeRow = rows.find((row) => row.id === selectedRow) ?? rows[0] ?? null;
  const pair = findPair(recipe.family, recipe.section);

  return (
    <div
      className="dash-design-preview"
      data-finish={recipe.finish}
      data-layout={recipe.layout}
      data-density={recipe.density}
      data-motion={recipe.motion ? 'on' : 'off'}
      data-scheme={recipe.mode}
      style={previewStyle(recipe)}
    >
      <div className="dl-preview-identity">
        <div>
          <span className="dl-eyebrow">ИЗОЛИРОВАННАЯ ПРОБА · ДЕМО</span>
          <h3>ДЭШ <span>· {recipe.section}</span></h3>
        </div>
        <div className="dl-preview-identity-right">
          <span>Образ: {pair.motif}</span>
          <span>Без подключения к данным и API</span>
        </div>
      </div>

      <div className="dl-nav-window" aria-label="Проверка исходных 13 разделов">
        <div className="dl-nav-track">
          {findFamily(recipe.family).sections.map((part) => (
            <button
              className="dl-nav-chip"
              type="button"
              key={part.name}
              aria-pressed={recipe.section === part.name}
              disabled={readOnly}
              onClick={() => onSelectSection?.(part.name)}
              style={{
                '--dl-chip-top': part.top, '--dl-chip-bottom': part.bottom,
                '--dl-chip-ink': part.ink,
              } as CSSProperties}
            >
              {part.name}
            </button>
          ))}
        </div>
      </div>

      <div className="dl-preview-body">
        <section className="dl-preview-summary" aria-label="Обзор тестовых данных">
          <span className="dl-small-label">Срез данных</span>
          <div className="dl-big-number" aria-live="polite">{rows.length} <span>учебные строки в отборе</span></div>
          <p>Эти записи вымышлены. Номер 173/1 не превращается в 173 и не считается дублем без доказательства.</p>
          <div className="dl-summary-metrics">
            <div><strong>{issues}</strong><span>нужны действия</span></div>
            <div><strong>{checked}</strong><span>проверены</span></div>
          </div>
          <ContrastLabel preset={recipe} />
        </section>

        <section className="dl-preview-main" aria-label="Демонстрация рабочего реестра">
          <div className="dl-section-heading">
            <div>
              <span className="dl-small-label">Рабочая зона</span>
              <h4>{recipe.layout === 'inspection' ? 'Проверка и исправление' : 'Реестр закупок'}</h4>
            </div>
            <span className="dl-caption">План, тыс. ₽ · демонстрация</span>
          </div>
          <div className="dl-demo-tools">
            <label className="dl-search">
              <Search size={15} aria-hidden="true" />
              <span className="dl-sr">Поиск по демонстрационным строкам</span>
              <input
                value={query}
                onChange={(event) => changeSession({ query: event.target.value })}
                placeholder="Номер или предмет"
                disabled={readOnly}
              />
            </label>
            <select
              aria-label="Фильтр демо-организаций"
              value={dept}
              onChange={(event) => changeSession({ dept: event.target.value as Dept })}
              disabled={readOnly}
            >
              <option value="all">Все ГРБС</option>
              <option value="УО">УО</option>
              <option value="УКСиМП">УКСиМП</option>
            </select>
            {!readOnly && (
              <button className="dl-tool-button" type="button"
                onClick={() => { changeSession({ query: '', dept: 'all', selectedRow: '173/1', sourceOpen: false }); onMode?.('ready'); }}>
                <RotateCcw size={13} aria-hidden="true" /> Сброс
              </button>
            )}
          </div>

          {demoMode === 'error' && (
            <div className="dl-inline-alert" role="alert">
              <TriangleAlert size={17} aria-hidden="true" />
              <div>
                <strong>Новую версию не удалось прочитать</strong>
                <p>Старые строки остаются видны. Не выдаём их за обновлённые.</p>
              </div>
              {!readOnly && <button type="button" onClick={() => onMode?.('ready')}>Повторить</button>}
            </div>
          )}
          {demoMode === 'pending' && (
            <div className="dl-inline-pending" role="status">Идёт получение нового снимка. Старая версия пока показана ниже.</div>
          )}

          <div className="dl-table-scroll">
            <table className="dl-demo-table">
              <thead><tr>
                <th>№ п/п</th><th>ГРБС</th><th>Наименование</th><th className="dl-numeric">План</th><th>Что требуется</th>
              </tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-selected={activeRow?.id === row.id}>
                    <td>
                      <button type="button" disabled={readOnly} onClick={() => changeSession({ selectedRow: row.id, sourceOpen: true })}>
                        {row.id}
                      </button>
                    </td>
                    <td>{row.org}</td>
                    <td>{row.work}</td>
                    <td className="dl-numeric">{row.plan}</td>
                    <td><span className={'dl-row-state ' + (row.issue ? 'needs-work' : 'is-verified')}>{row.state}</span></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="dl-empty-cell">Нет строк под этим отбором. Снимок и фильтры не сброшены автоматически.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="dl-table-foot">
            <span>Показано: {rows.length} из 3 · режим: {demoMode === 'empty' ? 'нет данных' : 'учебная версия'}</span>
            {sourceOpen && selectedRow && (
              <button type="button" onClick={() => changeSession({ sourceOpen: false })}>Скрыть основание</button>
            )}
          </div>
        </section>

        <aside className="dl-preview-evidence" aria-label="Основание и следующие действия">
          <span className="dl-small-label">Объяснения</span>
          <h4>{activeRow?.issue ? 'Что исправить' : activeRow ? 'Результат проверки' : 'Нет выбранной строки'}</h4>
          <p>{activeRow?.action ?? 'Под этим отбором учебных записей нет. Измените фильтр, чтобы открыть основание.'}</p>
          <button className="dl-feature-action" type="button" disabled={readOnly || !activeRow}
            onClick={() => changeSession({ selectedRow: activeRow?.id ?? null, sourceOpen: !sourceOpen })}>
            <Eye size={15} aria-hidden="true" /> {sourceOpen ? 'Скрыть источник' : 'Показать источник'}
          </button>
          {sourceOpen && activeRow && (
            <div className="dl-source-detail">
              <strong>ДЕМО · Строка {activeRow.id}</strong>
              <dl className="dl-source-evidence">
                <div><dt>Адрес исходной ячейки</dt><dd>{activeRow.source}</dd></div>
                <div><dt>Значение / формула</dt><dd>{activeRow.formula}</dd></div>
                <div><dt>Примечание ячейки</dt><dd>{activeRow.note}</dd></div>
                <div><dt>Обсуждение</dt><dd>{activeRow.discussion}</dd></div>
              </dl>
              <span>Поля учебные, рабочая книга не читалась.</span>
            </div>
          )}
        </aside>
      </div>

      <div className="dl-update-bar" role="status">
        <div>
          <span className="dl-status-dot" aria-hidden="true" />
          <strong>{updatePhase === 'applied' ? 'Учебная версия v2 применена' : 'Учебная версия v1 активна'}</strong>
          <span>{updatePhase === 'seen' ? ' Изменение замечено, но не прочитано' : updatePhase === 'read' ? ' Прочитано, но ещё не применено' : ' Можно снова проверить этапы'}</span>
        </div>
        {!readOnly && (updatePhase === 'seen'
          ? <button type="button" onClick={() => changeSession({ updatePhase: 'read' })}>Прочитал</button>
          : updatePhase === 'read'
            ? <button type="button" disabled={demoMode === 'error' || demoMode === 'pending'} onClick={() => changeSession({ updatePhase: 'applied' })}>Применить ДЕМО</button>
            : <button type="button" onClick={() => changeSession({ updatePhase: 'seen' })}>Повторить сценарий</button>)}
      </div>
    </div>
  );
}

function Field({
  title, note, children,
}: { title: string; note?: string; children: React.ReactNode }) {
  return <div className="dl-field"><span className="dl-field-title">{title}</span>{children}{note && <span className="dl-field-note">{note}</span>}</div>;
}

export function DesignLabPage({ onExit }: { onExit: () => void }) {
  const [preset, setPreset] = useState<LabPreset>(DEFAULT_PRESET);
  const [panel, setPanel] = useState('palettes');
  const [mode, setMode] = useState<Mode>('ready');
  const [session, setSession] = useState<PreviewSession>(INITIAL_SESSION);
  const changeSession = (change: Partial<PreviewSession>) => setSession((prev) => ({ ...prev, ...change }));
  const [compareFamily, setCompareFamily] = useState<FamilyId>('kamchatka');
  const [compareSurface, setCompareSurface] = useState<SurfaceId>('ocean');
  const [saved, setSaved] = useState<LabPreset[]>(() => {
    try { return readStoredPresets(localStorage); } catch { return []; }
  });
  const [name, setName] = useState(DEFAULT_PRESET.name);
  const [rawImport, setRawImport] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [undo, setUndo] = useState<LabPreset | null>(null);
  const css = useMemo(() => buildScopedCSS(preset), [preset]);

  const update = (fields: Partial<LabPreset>) => setPreset((previous) => ({ ...previous, ...fields }));

  const notify = (kind: 'ok' | 'error' | 'note', text: string) => setFeedback({ kind, text });
  const persist = (list: LabPreset[], success: string) => {
    try {
      writeStoredPresets(localStorage, list);
      setSaved(list);
      notify('ok', success);
    } catch (error) {
      notify('error', 'Не удалось сохранить в браузере: ' + (error instanceof Error ? error.message : 'неизвестная ошибка'));
    }
  };

  const save = () => {
    try {
      const candidate = { ...preset, name: name.trim() };
      persist(upsertPreset(saved, candidate), 'Набор сохранён локально. Рабочий Dash не изменился.');
      update({ name: candidate.name });
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Неверный набор.'); }
  };

  const importText = (raw: string) => {
    try {
      const items = parsePresetPackJSON(raw);
      let next = saved;
      for (const item of items) next = upsertPreset(next, item);
      persist(next, 'Принято наборов: ' + items.length + '. Данные и настройки Dash не затронуты.');
      if (items[0]) { setPreset(items[0]); setName(items[0].name); }
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Импорт отклонён.'); }
  };

  const fileImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 131072) throw new Error('Файл больше 128 КБ.');
      importText(await file.text());
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Файл не прочитан.'); }
  };

  const downloadJSON = () => {
    try {
      const body = exportPresetPack(saved.length ? saved : [{ ...preset, name }]);
      const url = URL.createObjectURL(new Blob([body], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'dash-design-lab-presets.json';
      link.click();
      URL.revokeObjectURL(url);
      notify('note', 'Запрошена выгрузка набора JSON. Содержит только параметры оформления.');
    } catch (error) { notify('error', error instanceof Error ? error.message : 'Экспорт не выполнен.'); }
  };

  const copyCSS = async () => {
    try {
      await navigator.clipboard.writeText(css);
      notify('ok', 'CSS-рецепт скопирован. Он ограничен классом .dash-design-preview.');
    } catch { notify('error', 'Автоматическое копирование недоступно. Выделите текст CSS ниже.'); }
  };

  const deleteSaved = (item: LabPreset) => {
    const next = saved.filter((p) => p.name !== item.name);
    try {
      writeStoredPresets(localStorage, next);
      setSaved(next);
      setUndo(item);
      notify('note', 'Набор удалён из браузера. Можно отменить.');
    } catch { notify('error', 'Удаление не удалось: браузер отказал в записи.'); }
  };

  return (
    <div className="dl-root" data-scheme={preset.mode}>
      <header className="dl-header">
        <button className="dl-back" type="button" onClick={onExit}>
          <ArrowLeft size={16} aria-hidden="true" /> Витрина компонентов
        </button>
        <div className="dl-header-main">
          <div>
            <span className="dl-overline">ДЭШ / ВНУТРЕННИЕ ИНСТРУМЕНТЫ</span>
            <h1>Дизайн-лаборатория</h1>
            <p>Исследуем внешний вид на вымышленных данных. Оригиналы сохраняются; предложения сравниваем, а не выдаём за внедрение.</p>
          </div>
          <div className="dl-summary-stamp">
            <strong>39 + 7</strong>
            <span>исходных цветовых пар и новых подложек</span>
          </div>
        </div>
      </header>
      <div className="dl-workspace">
        <aside className="dl-controls" aria-label="Управление визуальным рецептом">
          <div className="dl-control-heading">
            <Layers size={16} aria-hidden="true" />
            <div><strong>Рецепт внешнего вида</strong><span>Изменения только в этой пробе</span></div>
          </div>
          <Field title="Семейство вкладок" note="Три исходных семейства · 13 разделов">
            <select value={preset.family} aria-label="Семейство вкладок"
              onChange={(event) => update({ family: event.target.value as FamilyId })}>
              {ORIGINAL_FAMILIES.map((item) => <option key={item.id} value={item.id}>{item.label} · оригинал</option>)}
            </select>
          </Field>
          <Field title="Раздел">
            <select value={preset.section} aria-label="Раздел для проверки"
              onChange={(event) => update({ section: event.target.value as NavSection })}>
              {NAV_SECTIONS.map((section) => <option key={section} value={section}>{section}</option>)}
            </select>
          </Field>
          <Field title="Подложка" note="Семь экспериментальных поверхностей, не часть первоначальной палитры">
            <select value={preset.surface} aria-label="Подложка"
              onChange={(event) => update({ surface: event.target.value as SurfaceId })}>
              {EXPERIMENTAL_SURFACES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </Field>
          <Field title="Отделка" note={FINISHES.find((item) => item.id === preset.finish)?.role}>
            <select value={preset.finish} aria-label="Отделка"
              onChange={(event) => update({ finish: event.target.value as FinishId })}>
              {FINISHES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </Field>
          <Field title="Компоновка">
            <select value={preset.layout} aria-label="Компоновка"
              onChange={(event) => update({ layout: event.target.value as LayoutId })}>
              {LAYOUTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </Field>
          <fieldset className="dl-toggle-field">
            <legend>Свет</legend>
            <button type="button" aria-pressed={preset.mode === 'dark'}
              onClick={() => update({ mode: 'dark' })}>Ночь</button>
            <button type="button" aria-pressed={preset.mode === 'light'}
              onClick={() => update({ mode: 'light' })}>День</button>
          </fieldset>
          <fieldset className="dl-toggle-field">
            <legend>Плотность</legend>
            <button type="button" aria-pressed={preset.density === 'compact'}
              onClick={() => update({ density: 'compact' })}>Плотно</button>
            <button type="button" aria-pressed={preset.density === 'comfortable'}
              onClick={() => update({ density: 'comfortable' })}>Свободно</button>
          </fieldset>
          <button type="button" className="dl-motion-button" aria-pressed={preset.motion}
            onClick={() => update({ motion: !preset.motion })}>
            {preset.motion ? <Check size={14} aria-hidden="true" /> : <span aria-hidden="true" className="dl-motion-spacer" />}
            Живая заря внутри предмета
          </button>
          <div className="dl-control-foot">
            <ContrastLabel preset={preset} />
            <p>Показатель проверяет только концы градиента. Отделку, эффекты и реальное масштабирование проверяют отдельно.</p>
          </div>
          <button className="dl-reset" type="button" onClick={() => {
            setPreset(DEFAULT_PRESET); setName(DEFAULT_PRESET.name); setMode('ready'); setSession(INITIAL_SESSION); notify('note', 'Исходный рецепт восстановлен.');
          }}>
            <RotateCcw size={14} aria-hidden="true" /> Вернуть исходный вид
          </button>
        </aside>

        <main className="dl-content">
          <Tabs.Root value={panel} onValueChange={setPanel}>
            <Tabs.List className="dl-tabs" aria-label="Разделы лаборатории">
              <Tabs.Trigger value="palettes">Палитры</Tabs.Trigger>
              <Tabs.Trigger value="patterns">Компоненты и практики</Tabs.Trigger>
              <Tabs.Trigger value="states">Состояния</Tabs.Trigger>
              <Tabs.Trigger value="layouts">Компоновки</Tabs.Trigger>
              <Tabs.Trigger value="compare">Сравнение</Tabs.Trigger>
              <Tabs.Trigger value="code">Код и наборы</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="patterns" className="dl-tab-panel">
              <PatternGallery preset={preset} />
            </Tabs.Content>

            <Tabs.Content value="palettes" className="dl-tab-panel">
              <div className="dl-panel-intro">
                <div><h2>Материалы в контексте</h2><p>Цвет не отделён от предмета: проверяем на названиях, строках и сообщениях.</p></div>
                <span className="dl-origin-label">Три семьи — оригинал · подложки — предложения</span>
              </div>
              <div className="dl-sample-strip">
                {ORIGINAL_FAMILIES.map((family) => {
                  const sample = family.sections.find((item) => item.name === preset.section)!;
                  return <button key={family.id} type="button"
                    aria-pressed={preset.family === family.id}
                    className="dl-family-option"
                    onClick={() => update({ family: family.id })}
                  >
                    <span className="dl-family-color" style={{ background: 'linear-gradient(180deg, ' + sample.top + ', ' + sample.bottom + ')', color: sample.ink }}>{preset.section}</span>
                    <strong>{family.label}</strong><small>{sample.motif}</small>
                  </button>;
                })}
              </div>
              <Preview recipe={preset} onSelectSection={(section) => update({ section })} demoMode={mode} onMode={setMode} session={session} onSessionChange={changeSession} />
            </Tabs.Content>

            <Tabs.Content value="states" className="dl-tab-panel">
              <div className="dl-panel-intro"><div><h2>Состояния и реакции</h2><p>Не только картинка: включение, частичный выбор, ожидание, отказ, отсутствие данных и восстановление.</p></div></div>
              <div className="dl-state-row">
                {([['ready', 'Обычное'], ['pending', 'Ожидание'], ['error', 'Ошибка'], ['empty', 'Нет данных']] as const).map(([key, label]) => (
                  <button type="button" key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>
                ))}
              </div>
              <div className="dl-state-specimens">
                <div><span className="dl-small-label">ВЫБРАНО</span><span className="dl-specimen dl-specimen-selected">УО · выбрано</span></div>
                <div><span className="dl-small-label">ЧАСТИЧНО</span><span className="dl-specimen dl-specimen-mixed">2026 · частично</span></div>
                <div><span className="dl-small-label">НЕДОСТУПНО</span><span className="dl-specimen dl-specimen-disabled">Нет полномочий</span></div>
                <div><span className="dl-small-label">ТРЕБУЕТ ДЕЙСТВИЯ</span><span className="dl-specimen dl-specimen-danger">Уточнить источник</span></div>
              </div>
              <Preview recipe={preset} onSelectSection={(section) => update({ section })} demoMode={mode} onMode={setMode} session={session} onSessionChange={changeSession} />
            </Tabs.Content>

            <Tabs.Content value="layouts" className="dl-tab-panel">
              <div className="dl-panel-intro"><div><h2>Три организации рабочей области</h2><p>Одинаковые данные, разная расстановка акцентов; маршруты продукта остаются прежними.</p></div></div>
              <div className="dl-layout-options">
                {LAYOUTS.map((item) => <button key={item.id} type="button" aria-pressed={preset.layout === item.id}
                  onClick={() => update({ layout: item.id })}><Layers size={15} aria-hidden="true" /><strong>{item.label}</strong><span>{item.use}</span></button>)}
              </div>
              <Preview recipe={preset} onSelectSection={(section) => update({ section })} demoMode={mode} onMode={setMode} session={session} onSessionChange={changeSession} />
            </Tabs.Content>

            <Tabs.Content value="compare" className="dl-tab-panel">
              <div className="dl-panel-intro"><div><h2>Бок о бок</h2><p>Сравнивайте не абстрактные квадраты, а одни и те же строки и задачи.</p></div></div>
              <div className="dl-compare-controls">
                <label>Второе семейство
                  <select value={compareFamily} onChange={(event) => setCompareFamily(event.target.value as FamilyId)}>
                    {ORIGINAL_FAMILIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label>Вторая подложка
                  <select value={compareSurface} onChange={(event) => setCompareSurface(event.target.value as SurfaceId)}>
                    {EXPERIMENTAL_SURFACES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="dl-compare-grid">
                <div><h3>Вариант A · редактируемый</h3><Preview recipe={preset} onSelectSection={(section) => update({ section })} demoMode="ready" session={session} onSessionChange={changeSession} /></div>
                <div><h3>Вариант Б · сравнение</h3><Preview recipe={{ ...preset, family: compareFamily, surface: compareSurface }}
                  demoMode="ready" readOnly session={session} /></div>
              </div>
            </Tabs.Content>

            <Tabs.Content value="code" className="dl-tab-panel">
              <div className="dl-panel-intro"><div><h2>Переносимые рецепты</h2><p>Сохранение и обмен только параметрами оформления, без данных организаций и закупок.</p></div></div>
              <div className="dl-code-columns">
                <section className="dl-code-card">
                  <h3><Save size={16} aria-hidden="true" /> Наборы</h3>
                  <label>Название текущего набора
                    <input maxLength={64} value={name} onChange={(event) => setName(event.target.value)} />
                  </label>
                  <button className="dl-primary" type="button" onClick={save}><Save size={14} aria-hidden="true" /> Сохранить</button>
                  <div className="dl-presets" aria-label="Локально сохранённые наборы">
                    {saved.map((item) => <div className="dl-saved" key={item.name}>
                      <button type="button" onClick={() => { setPreset(item); setName(item.name); notify('note', 'Набор применён только к лаборатории.'); }}>
                        {item.name}<small>{item.family} / {item.finish}</small>
                      </button>
                      <button type="button" aria-label={'Удалить набор ' + item.name} onClick={() => deleteSaved(item)}><Trash2 size={15} aria-hidden="true" /></button>
                    </div>)}
                    {saved.length === 0 && <p>Наборов пока нет. Ваш выбор уже можно сохранить.</p>}
                  </div>
                  {undo && <button className="dl-quiet" type="button" onClick={() => {
                    try { persist(upsertPreset(saved, undo), 'Удаление отменено.'); setUndo(null); } catch (error) { notify('error', error instanceof Error ? error.message : 'Ошибка восстановления.'); }
                  }}>Вернуть удалённый набор</button>}
                  <div className="dl-file-controls">
                    <button type="button" onClick={downloadJSON}><Download size={15} aria-hidden="true" /> Экспорт JSON</button>
                    <label>Импорт из файла
                      <input type="file" accept=".json,application/json" onChange={(event) => {
                        void fileImport(event.currentTarget.files?.[0]); event.currentTarget.value = '';
                      }} />
                    </label>
                  </div>
                  <label>Или вставьте JSON
                    <textarea rows={5} spellCheck={false} value={rawImport}
                      onChange={(event) => setRawImport(event.target.value)} placeholder={'{"version":1,"name":"..."}'} />
                  </label>
                  <button className="dl-quiet" type="button" onClick={() => importText(rawImport)}>Проверить и импортировать</button>
                </section>
                <section className="dl-code-card">
                  <h3><FileCode2 size={16} aria-hidden="true" /> CSS-переменные</h3>
                  <p>Стили ограничены демонстрационной областью; ни одного глобального переключения темы.</p>
                  <pre className="dl-code-preview"><code>{css}</code></pre>
                  <button type="button" onClick={() => { void copyCSS(); }}><Copy size={15} aria-hidden="true" /> Копировать CSS</button>
                  <p className="dl-code-tip"><ShieldCheck size={15} aria-hidden="true" /> До переноса нужны сверка исходников, доступность, регрессионные сценарии и отдельная приёмка.</p>
                </section>
              </div>
            </Tabs.Content>
          </Tabs.Root>
          {feedback && <div className={'dl-feedback is-' + feedback.kind} role={feedback.kind === 'error' ? 'alert' : 'status'}>
            {feedback.text}<button type="button" onClick={() => setFeedback(null)} aria-label="Закрыть сообщение">×</button>
          </div>}
          <footer className="dl-footer">
            <span>Исходники: zarya-vystavka · otdelki · pulse · ugol-varianty · Kit</span>
            <span><ShieldCheck size={14} aria-hidden="true" /> Не изменяет рабочие реестры, API и настройки приложения</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
