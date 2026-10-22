import { useMemo, useState } from 'react';
import { ChevronRight, ExternalLink, Search, ShieldCheck, ShieldAlert, Workflow } from 'lucide-react';

/**
 * The light screen-level view of the ONE source-generated UI atlas.
 * Counts are from the 10.10.2026 AST run (design-lab full-source QA #2).
 * Machine truth and exact file:line addresses belong to packages/web/scripts/
 * ui-atomic-atlas.mjs and its GitHub Actions artifact, not this handoff view.
 * This human contract map must not be mistaken for runtime/API certification.
 */
interface AtomContract {
  id: string;
  label: string;
  owner: string;
  jsx: number;
  actions: number;
  dependencies: number;
  people: string;
  components: readonly string[];
  protects: readonly string[];
  opportunity: string;
  auditSource: string;
}

export const ATOM_CONTRACTS: readonly AtomContract[] = [
  { id:'dashboard',label:'Пульс',owner:'Dashboard.tsx',jsx:740,actions:57,dependencies:61,
    people:'Понять ситуацию за выбранный период, раскрыть число и найти исходную строку',
    components:['HeroKPICard','DrillPieChart','OrgStrip','Header','BlindSpotsWidget'],
    protects:['Взаимозависимые фильтры и период','Многомерный круг и журнал разрезов','Достоверность показателей и источники'],
    opportunity:'Вернуть крупный круг как ведущий предмет страницы; барабаны, щит и выбор подведов не заменять.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/pult.md' },
  { id:'report',label:'Отчёт',owner:'Report.tsx',jsx:753,actions:78,dependencies:65,
    people:'Сформировать и проверить воспроизводимый отчёт, сохранив источники расчётов',
    components:['ReportPage','ChangesSection','BudgetTriple','Word export','Org selector'],
    protects:['Word-выгрузки и тот же расчёт','Период и версия данных','Формулы, ссылки и контур рекомендаций'],
    opportunity:'Сгруппировать подготовку, объяснения и выпуск по стадиям; не переизобретать генератор.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/otchet-svod.md' },
  { id:'svod',label:'Свод',owner:'SvodView.tsx',jsx:336,actions:25,dependencies:42,
    people:'Сверить показатели с официальными источниками и открыть основание расхождения',
    components:['SvodView','BookAddress','Budget breakdown','Data table'],
    protects:['Официальные и пересчитанные значения раздельно','Единицы измерения','Применимость периоду'],
    opportunity:'Один читаемый узел сверки «наша сумма / официальная / расхождение / источник».',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/otchet-svod.md' },
  { id:'data',label:'Реестр',owner:'DataBrowser.tsx',jsx:672,actions:65,dependencies:60,
    people:'Найти закупку, понять исходные поля и проверить действие без потери контекста',
    components:['DataBrowser','RowDetailCard','DataTable','Filters','Origin'],
    protects:['№ п/п не равен устойчивому ID','Адрес и формула исходной ячейки','Сортировка, выгрузка, виртуализация'],
    opportunity:'Инспектор закупки сбоку только с возвратом фокуса и прежним отбором.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/reestr.md' },
  { id:'unfunded',label:'Не обеспеченные',owner:'DataBrowser.tsx',jsx:672,actions:65,dependencies:60,
    people:'Показать отсутствие финансирования в рамках той же закупочной модели',
    components:['DataBrowser','Class filter','DataTable','RowDetailCard'],
    protects:['Собственная корзина, не новый источник','Нельзя переносить колонку как дефект без доказательства','Сохранение выбранного года'],
    opportunity:'Показать причину включения строки в корзину рядом с её адресом и доступным шагом.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/reestr.md' },
  { id:'yearlong',label:'В течение года',owner:'DataBrowser.tsx',jsx:672,actions:65,dependencies:60,
    people:'Работать с сериями закупок в течение года, не объявляя их нарушениями',
    components:['DataBrowser','Stage filter','DataTable','RowDetailCard'],
    protects:['«В течение года» — стадия, не сигнал нарушения','Составной номер сохраняется строкой','Не выдавать число без периода'],
    opportunity:'Отдельное объяснение стадии, продолжения и группировки без дополнительных штрафных бейджей.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/reestr.md' },
  { id:'monitoring',label:'Мониторинг',owner:'Monitoring.tsx',jsx:1671,actions:115,dependencies:91,
    people:'Отследить ход определения поставщика, связь с источником и следующую работу',
    components:['MonitoringPage','DirectoryTable','JournalTable','BookStatusStrip','MoneyFlow'],
    protects:['Отдельная процедурная книга и её периоды','Исходные деньги в рублях','Связь процедуры и основной строки'],
    opportunity:'Свести действия к контексту одной процедуры без дополнительной псевдосущности.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/monitoring.md' },
  { id:'economy',label:'Экономия',owner:'Economy.tsx',jsx:538,actions:27,dependencies:56,
    people:'Отличить подтверждённую экономию, плановый резерв и невыясненную сумму',
    components:['EconomyCharts','EconomyDeptTable','EconomyConflictRows','Origin'],
    protects:['AD-gate и суммы по ФБ/КБ/МБ','Не экономия = план − факт','Подтверждённость метода расчёта'],
    opportunity:'Крупный блок «итог, основание, статус подтверждения» без лишнего рейтинга.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/economy-competition.md' },
  { id:'competition',label:'Конкуренция',owner:'Competition.tsx',jsx:385,actions:16,dependencies:60,
    people:'Сравнить закупочные способы и увидеть обоснование, без ложных выводов',
    components:['EpShare','EpJustification','CostOfRefusal','MergeCandidates'],
    protects:['ЕП ≠ автоматически нарушение','ЕП и КП не перекрашивать цветом бюджета','Разрезы должны иметь единую базу'],
    opportunity:'Больше визуального веса сопоставлению двух методов и одному проверяемому выводу.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/economy-competition.md' },
  { id:'discipline',label:'Дисциплина',owner:'Discipline.tsx',jsx:814,actions:55,dependencies:62,
    people:'Найти просрочки и узнать применимый период, статус и ответственное действие',
    components:['DisciplinePage','ActionCard','PeriodBadge','DataTable'],
    protects:['Ненаступивший период не просрочка','Факт и прогноз разные','Двойной адрес до строки'],
    opportunity:'Показывать серьёзность вместе с причиной и следующей операцией.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/discipline-quality.md' },
  { id:'quality',label:'Контроль',owner:'Quality.tsx',jsx:1517,actions:84,dependencies:88,
    people:'Разобрать проблему, происхождение, доверие, замечание и журнал решения',
    components:['Quality','Issues','Recs','Trust','Journal','Recon'],
    protects:['Замечание, сигнал, рекомендация и факт не одно и то же','Без доказательства нет нарушения','Исторические решения и комментарии не теряются'],
    opportunity:'Один понятный рабочий маршрут «обнаружено → доказательство → решение → проверка».',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/discipline-quality.md' },
  { id:'analytics',label:'Аналитика',owner:'Analytics.tsx',jsx:795,actions:52,dependencies:58,
    people:'Проверить гипотезу на данных с известными базой, временем и неопределённостью',
    components:['AnalyticsCard','AnomalyFindings','Timeline','Multiple charts'],
    protects:['Процент требует подтверждённого знаменателя','Прогноз не равен факту','Доступ к первичным строкам'],
    opportunity:'Пояснения и границы метода сделать доступными без лишней плотности текста.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/analytics-timeline-system.md' },
  { id:'settings',label:'Система',owner:'Settings.tsx',jsx:477,actions:39,dependencies:25,
    people:'Понять работоспособность источника, изменить настройку с реальным сохранением',
    components:['Settings','Source passport','Permission controls','Audit feedback'],
    protects:['Конфигурация runtime ≠ записана на диск','Ошибочный persist ≠ успех','Недостаток доступа требует конкретной причины'],
    opportunity:'Сгруппировать сохранение, подтверждённую версию и шаг восстановления.',
    auditSource:'docs/superpowers/audits/2026-08-20-cards-map/analytics-timeline-system.md' },
] as const;

const root = 'https://github.com/gaben1488/dash/blob/main/';
const atlasWorkflow = 'https://github.com/gaben1488/dash/actions/workflows/dash-ui-atomic-atlas.yml';

export function AtomAtlas() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('dashboard');
  const [details, setDetails] = useState(false);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru');
    return ATOM_CONTRACTS.filter(x =>
      !needle || [x.label, x.people, x.owner, x.opportunity, ...x.components, ...x.protects]
        .some(t => t.toLocaleLowerCase('ru').includes(needle)));
  }, [query]);
  const entry = matches.find(x => x.id === selected) ?? matches[0] ?? null;
  return <section className="dr-atlas">
    <div className="dr-section-intro">
      <div><h2>Атомы интерфейса и зависимости</h2>
        <p>Настоящие 13 маршрутов, связанные компоненты, защищённые действия и адреса кода. Факты исходников отделены от идей.</p></div>
      <a href={atlasWorkflow} rel="noopener noreferrer" target="_blank">
        Живой полный граф <ExternalLink size={13} aria-hidden="true" />
      </a>
    </div>
    <div className="dr-atlas-counter" aria-label="Измеренный срез репозитория">
      <span><strong>328</strong> исходных файлов</span>
      <span><strong>8 145</strong> JSX-элементов</span>
      <span><strong>709</strong> мест взаимодействия</span>
      <span><strong>13</strong> маршрутов</span>
    </div>
    <p className="dr-atlas-caveat"><ShieldAlert size={15} aria-hidden="true" />
      Цифры — срез AST на 10.10.2026, а не живые данные и не сертификация всех функций.
      После изменения исходников граф пересчитывается в CI; до удаления элемента проверяйте свежий артефакт.</p>
    <div className="dr-atlas-layout">
      <aside className="dr-atlas-directory" aria-label="Маршруты и их владельцы">
        <label><Search size={15} aria-hidden="true" /><span className="dr-sr">Поиск элемента или задачи</span>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Вкладка, действие, компонент" />
        </label>
        <div className="dr-atlas-list">
          {matches.map(x => <button key={x.id} type="button"
            aria-pressed={entry?.id === x.id} onClick={() => { setSelected(x.id); setDetails(false); }}>
            <span><strong>{x.label}</strong><small>{x.owner} · {x.jsx} JSX</small></span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>)}
          {matches.length === 0 && <p role="status">По этому поиску разделов нет.</p>}
        </div>
      </aside>
      {entry ? <article className="dr-atlas-inspector" aria-label={'Контракт раздела ' + entry.label}>
        <div className="dr-atlas-title"><span>Исходный экран · {entry.id}</span><h3>{entry.label}</h3>
          <p>{entry.people}</p></div>
        <div className="dr-atlas-stats">
          <span>{entry.jsx} JSX</span><span>{entry.actions} событий</span>
          <span>{entry.dependencies} файлов в графе</span>
        </div>
        <div className="dr-atlas-section">
          <h4><Workflow size={14} aria-hidden="true" /> Текущие участники экрана</h4>
          <div className="dr-atlas-tags">{entry.components.map(x => <span key={x}>{x}</span>)}</div>
        </div>
        <div className="dr-atlas-section">
          <h4><ShieldCheck size={14} aria-hidden="true" /> Что нельзя потерять при переплавке</h4>
          <ul>{entry.protects.map(x => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className="dr-atlas-opportunity">
          <strong>Направление улучшения — не принятая правка</strong>
          <p>{entry.opportunity}</p>
        </div>
        <button className="dr-atlas-more" type="button" aria-expanded={details}
          onClick={() => setDetails(v => !v)}>
          {details ? 'Свернуть адреса и проверки' : 'Адреса исходников и проверок'}
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {details && <div className="dr-atlas-references">
          <a href={root + 'packages/web/src/pages/' + entry.owner} target="_blank" rel="noopener noreferrer">
            Текущая React-страница <ExternalLink size={12} aria-hidden="true" /></a>
          <a href={root + entry.auditSource} target="_blank" rel="noopener noreferrer">
            Предыдущая карта функций <ExternalLink size={12} aria-hidden="true" /></a>
          <a href={atlasWorkflow} target="_blank" rel="noopener noreferrer">
            Атомы, поля, события, зависимости и точные file:line — последний артефакт CI
            <ExternalLink size={12} aria-hidden="true" /></a>
          <p>Автоматическая связь по импорту показывает возможное влияние, но не заменяет проверку на настоящих данных, клавиатуре и реальном серверном ответе.</p>
        </div>}
      </article> : <div className="dr-atlas-inspector" role="status">Измените запрос, чтобы выбрать маршрут.</div>}
    </div>
  </section>;
}
