import { useMemo, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Copy, ExternalLink, FileCode2, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardDivider, CardFooter } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Stat } from '@/components/ui/stat';
import { Origin } from '@/components/ui/origin';
import { FreshnessMark, worstState, type FreshnessInfo } from '@/components/ui/freshness';
import { DataTable, THead, TBody, Tr, Th, Td, RowAddress, RowSignals } from '@/components/ui/data-table';
import { EmptyState } from '@/components/EmptyState';
import { Segmented } from '@/components/ui/segmented';
import { FINISHES, findPair, findSurface } from './catalog';
import type { LabPreset } from './presets';
import { COMPONENT_INDEX, UI_RECIPES, searchRecipes, type RecipeId, type UiRecipe } from './recipes';
import './patterns.css';

type Category = UiRecipe['category'] | 'all';
const categories: readonly Category[] = ['all', 'Основания', 'Рабочие действия', 'Состояния', 'Облик'];
const repoRoot = 'https://github.com/gaben1488/dash/blob/main/';

/** Isolated tokens for real production components shown with an experimental palette. */
export function recipeStageStyle(preset: LabPreset): CSSProperties {
  const pair = findPair(preset.family, preset.section);
  const skin = findSurface(preset.surface)[preset.mode];
  return {
    '--surface-page': skin.bg, '--surface-card': skin.card,
    '--surface-sunken': skin.bg, '--surface-raised': skin.raised,
    '--surface-overlay': skin.card, '--line-soft': skin.line,
    '--line-strong': skin.muted, '--line-card': skin.line,
    '--ink': skin.ink, '--ink-strong': skin.ink,
    '--ink-muted': skin.muted, '--ink-faint': skin.muted,
    '--accent': pair.top, '--accent-hover': pair.bottom,
    '--accent-ink': pair.ink,
    '--accent-soft': 'color-mix(in srgb, ' + pair.top + ' 18%, transparent)',
    '--accent-line': 'color-mix(in srgb, ' + pair.top + ' 45%, transparent)',
    '--row-h': preset.density === 'compact' ? '34px' : '44px',
    '--cell-pad-x': preset.density === 'compact' ? '8px' : '12px',
    '--cell-pad-y': preset.density === 'compact' ? '5px' : '9px',
    '--card-pad': preset.density === 'compact' ? '12px' : '18px',
    backgroundColor: skin.bg, color: skin.ink,
  } as CSSProperties;
}

/** Each interaction is a safe local demonstration, not a mock server mutation. */
function LiveRecipe({ id, preset }: { id: RecipeId; preset: LabPreset }) {
  const [dept, setDept] = useState<'all' | 'УО' | 'УКСиМП'>('all');
  const [triage, setTriage] = useState<'start' | 'opened' | 'checked'>('start');
  const [phase, setPhase] = useState<'seen' | 'read' | 'applied'>('seen');
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState(false);
  const [rate, setRate] = useState<'norm' | 'live'>('norm');
  const [actionStep, setActionStep] = useState<'idle' | 'pending' | 'confirmed'>('idle');
  const [deleteStep, setDeleteStep] = useState<'idle' | 'ask' | 'done'>('idle');
  const [scale, setScale] = useState<'thousand' | 'million'>('thousand');
  const [confidence, setConfidence] = useState<'fact' | 'inferred' | 'unknown'>('inferred');


  if (id === 'action-hierarchy') return (
    <Card>
      <CardHeader title="Только одно главное действие" scope="ДЕМО · не запись"
        note="Кнопки используются из рабочего Button. Состояние «сохранено» требует отдельного подтверждения." />
      <div className="dl-pat-actions">
        {actionStep === 'idle' && <Button tone="primary" onClick={() => setActionStep('pending')}>Сохранить изменения</Button>}
        {actionStep === 'pending' && <>
          <Button tone="primary" busy>Сохранить изменения</Button>
          <Button tone="secondary" onClick={() => setActionStep('confirmed')}>Подтвердить учебный результат</Button>
        </>}
        {actionStep === 'confirmed' && <Chip tone="good">Учебное подтверждение получено</Chip>}
        <Button tone="secondary" onClick={() => setActionStep('idle')}>Начать заново</Button>
        <Button tone="quiet" onClick={() => setActionStep('idle')}>Отменить</Button>
      </div>
      <CardDivider />
      <div className="dl-pat-actions">
        {deleteStep === 'idle' && <Button tone="danger" onClick={() => setDeleteStep('ask')}>Запросить удаление</Button>}
        {deleteStep === 'ask' && <>
          <strong className="dl-pat-muted">Подтвердите удаление учебной строки</strong>
          <Button tone="danger" onClick={() => setDeleteStep('done')}>Подтвердить в демо</Button>
          <Button tone="secondary" onClick={() => setDeleteStep('idle')}>Отказаться</Button>
        </>}
        {deleteStep === 'done' && <>
          <span role="status">Строка помечена удалённой только в демо.</span>
          <Button tone="secondary" onClick={() => setDeleteStep('idle')}>Повторить</Button>
        </>}
        <Button tone="secondary" disabled>Нет полномочий</Button>
      </div>
      <CardFooter>Ни одно действие не обращается к серверу. В настоящем Dash подтверждение должно исходить от сохранения и повторного чтения.</CardFooter>
    </Card>
  );

  if (id === 'signal-priority') {
    const infos: readonly FreshnessInfo[] = [
      { state: 'verified', reason: 'ДЕМО · значение сверено с исходным полем' },
      { state: 'uncovered', reason: 'Для вторичного показателя сверка не настроена', whatToDo: 'Определить источник и процедуру проверки' },
      { state: 'stale', reason: 'Учебный снимок старше даты контроля', whatToDo: 'Перечитать исходную запись и проверить расхождение' },
    ];
    const worst = worstState(infos.map(info => info.state));
    const info = infos.find(item => item.state === worst)!;
    return <Card>
      <CardHeader title="Состояние доверия к показателю" scope="Учебный срез"
        note="Главный индикатор — только самый серьёзный из реально известных." />
      <FreshnessMark info={info} readAt="Дата учебного примера" />
      <details className="dl-pat-disclosure">
        <summary>Все проверки · {infos.length}</summary>
        <ul>{infos.map(item => <li key={item.state}><FreshnessMark info={item} /></li>)}</ul>
      </details>
      <CardFooter>Цвет не заменяет объяснение. При ненастроенной проверке нельзя показывать подтверждённый статус.</CardFooter>
    </Card>;
  }

  if (id === 'measured-zero') return (
    <Card>
      <CardHeader title="Одно место, два принципиально разных случая" scope="ДЕМО · 2026"
        note="0 — результат измерения, null — отсутствие известного значения." />
      <div className="dl-pat-row">
        <Stat label="Проверенное отклонение" value="0" unit="тыс. ₽"
          scope="2026 · пример" tone="neutral" hint="Источник сообщает измеренное нулевое значение." />
        <Stat label="План без подтверждённой базы" value={null} unit="тыс. ₽"
          scope="2026 · пример" emptyReason="Исходный лист не прочитан — число неизвестно" />
      </div>
      <CardFooter>Неизвестное не участвует в итоговой сумме как якобы измеренный ноль.</CardFooter>
    </Card>
  );

  if (id === 'unit-scale') {
    const amount = 7800; // only a fictitious demo value in thousands
    const formatted = scale === 'thousand' ? amount.toLocaleString('ru-RU')
      : (amount / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
    return <Card>
      <CardHeader title="Одна величина, две единицы" scope="ДЕМО · 3 строки"
        note="Режим меняет представление, а не состав записей." />
      <Segmented<'thousand' | 'million'> legend="Единицы денежного итога"
        value={scale} onChange={setScale} options={[
          { value: 'thousand', label: 'Тысячи', hint: 'Показать исходное демо-значение в тысячах рублей' },
          { value: 'million', label: 'Миллионы', hint: 'Показать то же значение в миллионах рублей' },
        ]} />
      <div className="dl-pat-figure"><Stat label="План, из одной базы" value={formatted}
        unit={scale === 'thousand' ? 'тыс. ₽' : 'млн ₽'} scope="2026 · три учебные строки" /></div>
      <CardFooter>Исходная величина: 7 800 тыс. ₽. Количество строк остаётся 3.</CardFooter>
    </Card>;
  }

  if (id === 'long-content') return (
    <Card bare>
      <div className="dl-pat-padded">
        <CardHeader title="Длинные названия не пропадают" scope="ДЕМО · 2026"
          note="Таблицу можно прокрутить горизонтально с клавиатуры; текст остаётся целым." />
      </div>
      <DataTable caption="ДЕМО · организации, предметы, номера и суммы">
        <THead><Tr><Th>№ п/п</Th><Th>Наименование учреждения</Th><Th>Предмет закупки</Th><Th numeric>План, тыс. ₽</Th></Tr></THead>
        <TBody>
          <Tr><Td><RowAddress row={42} seq="173/1" /></Td>
            <Td className="dl-pat-longname">Муниципальное бюджетное общеобразовательное учреждение «Средняя общеобразовательная школа № 3 имени выдающегося исследователя Камчатского края»</Td>
            <Td className="dl-pat-longname">Приобретение и установка оборудования для специализированных учебных кабинетов с обеспечением обслуживания</Td>
            <Td numeric>7 800</Td></Tr>
        </TBody>
      </DataTable>
      <p className="dl-pat-under">Текст перенесён, не скрыт многоточием. Для 200% увеличения необходим реальный браузерный тест.</p>
    </Card>
  );

  if (id === 'evidence-confidence') {
    const info: FreshnessInfo = confidence === 'fact'
      ? { state: 'verified', reason: 'ДЕМО · значение вручную сверено с учебной строкой' }
      : confidence === 'inferred'
        ? { state: 'uncovered', reason: 'ДЕМО · это косвенный вывод, официальная строка не проверена', whatToDo: 'Проверить первоисточник прежде чем принимать решение' }
        : { state: 'unmeasurable', reason: 'Источник не был прочитан, статус определить нельзя', whatToDo: 'Получить исходный снимок и повторить проверку' };
    return <Card>
      <CardHeader title="Статус доказательства, а не украшение" scope="Учебная запись 173/1" />
      <div className="dl-pat-actions">
        <Chip tone="accent" pressed={confidence === 'fact'} onClick={() => setConfidence('fact')}>Подтверждено</Chip>
        <Chip tone="accent" pressed={confidence === 'inferred'} onClick={() => setConfidence('inferred')}>Предположение</Chip>
        <Chip tone="accent" pressed={confidence === 'unknown'} onClick={() => setConfidence('unknown')}>Неизвестно</Chip>
      </div>
      <div className="dl-pat-figure"><FreshnessMark info={info} /></div>
      <p className="dl-pat-muted">Признаки классификатора не превращают вывод в факт из официальной книги.</p>
    </Card>;
  }

  if (id === 'source-metric') return (
    <Card aria-label="Учебная карточка числа и происхождения">
      <CardHeader title="Оснащение учреждения" scope="ДЕМО · 2026"
        note="Число и адрес источника рядом. Данные вымышлены." />
      <div className="dl-pat-row">
        <Stat label="План" value="7 800" unit="тыс. ₽" scope="Учебный период · 2026"
          hint="Пример без подключения к реестрам." />
        <div className="dl-pat-support">
          <FreshnessMark info={{ state: 'uncovered', reason: 'Сверка учебного поля не настроена', whatToDo: 'Откройте учебный источник' }} />
          <Origin metric="План" source="ДЕМО · учебная книга" howSourceCounts="Берём значение D14 без пересчёта"
            match="initiative" sheetRef="ДЕМО · D14" rowAddress="строка 14 · № п/п 173/1"
            readAt="Дата не применяется" note="Выгрузка не содержит настоящих записей">
            <span className="dl-pat-link">Показать происхождение</span>
          </Origin>
        </div>
      </div>
      <CardFooter>Если значения нет, Stat показывает объяснение, а не ноль.</CardFooter>
    </Card>
  );

  if (id === 'source-row') return (
    <Card bare aria-label="Учебный реестр с адресами">
      <DataTable caption="ДЕМО · адреса, формулы и замечания">
        <THead><Tr><Th>Адрес</Th><Th>ГРБС</Th><Th numeric formula>План, тыс. ₽</Th><Th>Что проверить</Th></Tr></THead>
        <TBody>
          <Tr signalTone="warn">
            <Td><RowAddress sheet="ДЕМО" row={14} seq="173/1" /></Td><Td>УО</Td><Td numeric formula>7 800</Td>
            <Td><RowSignals signals={[{ label: 'Уточнить источник суммы', tone: 'warn' }]} /></Td>
          </Tr>
          <Tr><Td><RowAddress sheet="ДЕМО" row={15} seq="173/2" /></Td><Td>УКСиМП</Td>
            <Td numeric formula>5 200</Td><Td><RowSignals signals={[]} /></Td></Tr>
          <Tr signalTone="bad"><Td><RowAddress sheet="ДЕМО" row={16} seq={null} /></Td><Td>УО</Td>
            <Td numeric formula>—</Td>
            <Td><RowSignals signals={[{ label: 'Не проставлен № п/п', tone: 'bad' }]} /></Td>
          </Tr>
        </TBody>
      </DataTable>
      <p className="dl-pat-under">Составной номер остаётся строкой. У формульной колонки есть обозначение.</p>
    </Card>
  );

  if (id === 'triage') return (
    <Card>
      <CardHeader title="Уточните источник суммы" scope="ДЕМО · строка 173/1"
        note="Что произошло → что сделать → где основание."
        actions={<Chip tone={triage === 'checked' ? 'good' : 'warn'}>{triage === 'checked' ? 'Учебный шаг выполнен' : 'Нужен источник'}</Chip>} />
      <CardDivider />
      <ol className="dl-pat-steps">
        <li>Откройте строку и прочитайте формулу</li>
        <li>Сравните значение и единицы</li>
        <li>Подтвердите основание в вашей рабочей системе</li>
      </ol>
      <div className="dl-pat-actions">
        {triage === 'start' && <Button tone="primary" onClick={() => setTriage('opened')}>Открыть учебный источник</Button>}
        {triage === 'opened' && <>
          <span className="dl-pat-muted">ДЕМО · D14 = 7 800 тыс. ₽</span>
          <Button tone="primary" onClick={() => setTriage('checked')}>Отметить шаг в демо</Button>
        </>}
        {triage === 'checked' && <Button tone="secondary" onClick={() => setTriage('start')}>Повторить упражнение</Button>}
      </div>
      <CardFooter>Подтверждение здесь не записывает ничего в рабочий Dash.</CardFooter>
    </Card>
  );

  if (id === 'filters') {
    const rows = [{ seq: '173/1', org: 'УО' }, { seq: '173/2', org: 'УКСиМП' }, { seq: '174', org: 'УО' }];
    const result = rows.filter(row => dept === 'all' || row.org === dept);
    return (
      <Card>
        <CardHeader title="Отбор по управлению" note="Строки остаются в исходном списке, меняется только видимый срез." />
        <div className="dl-pat-actions">
          <Chip tone="accent" pressed={dept === 'all'} onClick={() => setDept('all')}>Все ГРБС</Chip>
          <Chip tone="accent" pressed={dept === 'УО'} onClick={() => setDept('УО')}>УО</Chip>
          <Chip tone="accent" pressed={dept === 'УКСиМП'} onClick={() => setDept('УКСиМП')}>УКСиМП</Chip>
          <Button size="sm" tone="quiet" icon={<RotateCcw size={13} />} onClick={() => setDept('all')}>Сброс</Button>
        </div>
        <p className="dl-pat-result" role="status">Показано {result.length} из 3: {result.map(row => row.seq).join(', ')}</p>
        <CardDivider />
        <Segmented<'norm' | 'live'> legend="Учебный режим счёта" value={rate} onChange={setRate}
          options={[
            { value: 'norm', label: 'Норма', hint: 'Учебный нормативный режим без изменения записей' },
            { value: 'live', label: 'По факту', hint: 'Учебный фактический режим без изменения записей' },
          ]} />
        <p className="dl-pat-muted">Режим: {rate === 'norm' ? 'норма' : 'по факту'}. На реальные суммы не влияет.</p>
      </Card>
    );
  }

  if (id === 'reliable-update') return (
    <Card>
      <CardHeader title="Принятие новой версии" scope="ДЕМО"
        note="Обнаружение изменения не обновляет открытый рабочий срез." />
      <p className="dl-pat-version">Показано: <strong>v{phase === 'applied' ? '2' : '1'}</strong> · Новая версия: v2</p>
      {failed && <p role="alert" className="dl-pat-error">Учебное чтение не удалось. Сохранена прежняя версия.</p>}
      <div className="dl-pat-actions">
        {phase === 'seen' && <Button tone="primary" onClick={() => { setFailed(false); setPhase('read'); }}>Прочитать изменение</Button>}
        {phase === 'read' && <Button tone="primary" onClick={() => { setFailed(false); setPhase('applied'); }}>Применить ДЕМО</Button>}
        {phase === 'applied' && <Button tone="secondary" onClick={() => { setFailed(false); setPhase('seen'); }}>Начать заново</Button>}
        {phase !== 'applied' && <Button tone="quiet" onClick={() => setFailed(true)}>Смоделировать отказ</Button>}
      </div>
      <CardFooter>Реальный протокол обновления живёт в LiveUpdateBar. Это только проверка интерфейса.</CardFooter>
    </Card>
  );

  if (id === 'honest-empty') return (
    <Card>
      <CardHeader title="Два разных отсутствия данных" note="Успешный пустой поиск и неудачный запрос — не одно и то же." />
      <div className="dl-pat-actions">
        <Chip tone="accent" pressed={!problem} onClick={() => setProblem(false)}>Нулевой результат</Chip>
        <Chip tone="accent" pressed={problem} onClick={() => setProblem(true)}>Ошибка чтения</Chip>
      </div>
      {problem
        ? <EmptyState tone="problem" size="compact" title="Учебный источник не ответил"
            description="Неизвестно, сколько записей есть в источнике."
            detail="ДЕМО · ошибка чтения"
            action={{ label: 'Повторить в демо', onClick: () => setProblem(false) }} />
        : <EmptyState size="compact" title="По заданному условию строк нет"
            description="Снимок получен, но фильтр не дал ни одной записи."
            action={{ label: 'Проверить отказ чтения', onClick: () => setProblem(true) }} />}
      <CardFooter>Это действующий EmptyState; его исторические hardcoded-цвета требуют отдельного исправления.</CardFooter>
    </Card>
  );

  if (id === 'typography') return (
    <Card>
      <CardHeader title="Шкала кегля и цифровой набор" scope="Inter / Geist Mono"
        note="Плотность меняет промежутки, но не размер шрифта." />
      <div className="dl-pat-type-samples">
        <p className="ds-text-3xl tabular-nums font-[var(--weight-strong)]">12 345 678 <span className="ds-text-xs">тыс. ₽</span></p>
        <p className="ds-text-xl">Капитальный ремонт учреждения</p>
        <p className="ds-text-lg">Проверка источников</p>
        <p className="ds-text-base">Содержательный текст о закупке без обрыва важных слов.</p>
        <p className="ds-text-sm">Точная дата и период всегда возле показателя.</p>
        <p className="ds-text-xs tabular-nums">173/1 · 2026 · 7 800,00</p>
        <p className="ds-text-2xs">ДЕМО · лист · строка 14 · № п/п 173/1</p>
        <p className="ds-text-3xs">Служебное примечание к учебному источнику.</p>
      </div>
      <CardFooter>Используются настоящие ds-text-* и tabular-nums из проекта.</CardFooter>
    </Card>
  );

  const finish = FINISHES.find(x => x.id === preset.finish)!;
  const pair = findPair(preset.family, preset.section);
  return (
    <Card>
      <CardHeader title="Материал выделенного предмета" scope="Схематический стенд"
        note="Эффект относится к контролу, но не заменяет семантический цвет предупреждения." />
      <div className="dl-pat-material">
        <span data-finish={preset.finish}
          style={{ backgroundImage: 'linear-gradient(180deg,' + pair.top + ',' + pair.bottom + ')', color: pair.ink }}>
          {preset.section}
        </span>
        <div><strong>{finish.label}</strong><p>{finish.role}</p><p>Ограничение: {finish.avoid}.</p></div>
      </div>
      <CardFooter>Физический оригинал отделки — otdelki.html. Не использовать этот образец вместо барабана.</CardFooter>
    </Card>
  );
}

export function PatternGallery({ preset }: { preset: LabPreset }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [selected, setSelected] = useState<RecipeId>('source-metric');
  const [copied, setCopied] = useState<'idle' | 'yes' | 'blocked'>('idle');
  const results = useMemo(() =>
    searchRecipes(query, category === 'all' ? undefined : category),
    [query, category],
  );
  const recipe = results.find((item) => item.id === selected) ?? results[0] ?? null;
  const components = recipe ? COMPONENT_INDEX.filter(x => recipe.components.includes(x.id)) : [];
  const copy = async () => {
    if (!recipe) return;
    try { await navigator.clipboard.writeText(recipe.code); setCopied('yes'); }
    catch { setCopied('blocked'); }
  };
  return (
    <div className="dl-pattern-gallery">
      <div className="dl-panel-intro">
        <div><h2>Библиотека рабочих практик</h2><p>14 рецептов и 21 существующий компонент: поведение, основания, ошибки, композиция и материал.</p></div>
        <span className="dl-origin-label">Все значения в образцах вымышленные</span>
      </div>
      <div className="dl-pat-columns">
        <aside className="dl-pat-directory" aria-label="Каталог рецептов">
          <label className="dl-pat-search"><Search size={15} aria-hidden="true" />
            <span className="dl-sr">Найти рецепт</span>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Задача, ошибка или элемент" />
          </label>
          <label className="dl-pat-category"><span>Категория</span>
            <select value={category} onChange={e => setCategory(e.target.value as Category)}>
              {categories.map(x => <option key={x} value={x}>{x === 'all' ? 'Все категории' : x}</option>)}
            </select>
          </label>
          <div className="dl-pat-links">
            {results.map(x => (
              <button type="button" key={x.id} aria-pressed={recipe?.id === x.id}
                onClick={() => { setSelected(x.id); setCopied('idle'); }}>
                <strong>{x.title}</strong>
                <small>{x.category} · {x.status === 'production-parts' ? 'рабочие элементы' : 'концепция'}</small>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            ))}
            {results.length === 0 && <p role="status">Совпадений нет. Измените фильтр.</p>}
          </div>
        </aside>
        {recipe ? <div className="dl-pat-details">
          <div className="dl-pat-description">
            <span className="dl-small-label">{recipe.category}</span>
            <h3>{recipe.title}</h3><p><strong>{recipe.answer}</strong></p><p>{recipe.rationale}</p>
          </div>
          {preset.mode === 'light' && (recipe.id === 'source-metric' || recipe.id === 'honest-empty') && (
            <p className="dl-pat-theme-warning" role="note">
              Ограничение исходного компонента: источник открывается через портал в body, а EmptyState наследует глобальную тему.
              Внешний вид здесь нельзя считать проверенным в светлом режиме — сравните также в исходном Kit.
            </p>
          )}
          <div className="dl-pat-stage" data-scheme={preset.mode} data-density={preset.density}
            style={recipeStageStyle(preset)}>
            <span className="dl-pat-stage-label">Живой пример · ДЕМО</span>
            <LiveRecipe key={recipe.id} id={recipe.id} preset={preset} />
          </div>
          <div className="dl-pat-acceptance">
            <section><h4>Что нельзя повторять</h4><p>{recipe.mistake}</p></section>
            <section><h4>Критерии приёмки</h4>
              <ul>{recipe.criteria.map(c => <li key={c}><Check size={13} aria-hidden="true" />{c}</li>)}</ul>
            </section>
          </div>
          <div className="dl-pat-code-header">
            <strong><FileCode2 size={15} aria-hidden="true" /> Иллюстративный фрагмент кода</strong>
            <Button tone="secondary" size="sm" icon={<Copy size={13} />} onClick={() => { void copy(); }}>Копировать фрагмент</Button>
          </div>
          {copied !== 'idle' && <p role="status" className="dl-pat-copy">{copied === 'yes' ? 'Код скопирован.' : 'Буфер обмена недоступен — выделите код ниже.'}</p>}
          <p className="dl-pat-copy">Для включения в продукт требуются обработчики действий, предметная логика и проверка поведения. Это не готовый самостоятельный компонент.</p>
          <pre className="dl-pat-code"><code>{recipe.code}</code></pre>
          <div className="dl-pat-sources"><strong>Файлы настоящих компонентов</strong><div>
            {components.map(item => (
              <a key={item.id} href={repoRoot + item.path} target="_blank" rel="noopener noreferrer">
                {item.title}<ExternalLink size={11} aria-hidden="true" />
              </a>
            ))}
          </div></div>
        </div> : <div className="dl-pat-details dl-pat-none" role="status">
          <strong>Под заданный поиск рецептов нет</strong>
          <p>Измените запрос или категорию. Прежний рецепт не показывается как найденный.</p>
        </div>}
      </div>
    </div>
  );
}
