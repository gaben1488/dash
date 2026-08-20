// ── Витрина облика: все примитивы, все состояния, обе темы, обе плотности.
//
//    Зачем она есть. Дизайн-система, которую нельзя увидеть целиком на
//    одном экране, разъезжается молча: правку карточки замечают, правку
//    пустого состояния — нет, потому что пустое состояние в рабочем
//    продукте показывается раз в месяц и обычно не тому, кто правил код.
//    Здесь всё редкое показано рядом с частым и в один взгляд: пустота,
//    ожидание, расхождение с источником, отсутствие «№ п/п», ненастроенная
//    сверка. Это дешёвый способ увидеть, что тёмная тема разъехалась со
//    светлой, — до того, как это увидит начальник на проекторе.
//
//    Витрина живёт ТОЛЬКО в разработке: подключается из `main.tsx` под
//    `import.meta.env.DEV` и в собранный продукт не попадает — ветка с
//    ложным условием выбрасывается сборщиком вместе со всем, что она
//    тянет. Открывается по адресу `#/kit`.
//
//    Числа здесь выдуманные и намеренно неправдоподобные по составу
//    (управление «Образец»), чтобы ни один снимок экрана отсюда нельзя
//    было принять за настоящий отчёт.

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, RefreshCw, Trash2 } from 'lucide-react';

import { Card, CardHeader, CardDivider, CardFooter } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { Chip } from '@/components/ui/chip';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Origin } from '@/components/ui/origin';
import { FreshnessMark, type FreshnessInfo } from '@/components/ui/freshness';
import { ChartFrame, SharePair, MONEY_SCALE_HINT, type MoneyScale } from '@/components/ui/chart-frame';
import {
  DataTable, THead, TBody, Tr, Th, Td, RowAddress, RowSignals,
} from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { Drawer } from '@/components/ui/drawer';
import { notifyDone, notifyProblem, notifyWorking, notifyReplaceDone } from '@/components/ui/toast';
import { EmptyState } from '@/components/EmptyState';
import { useDensity } from '@/components/ui/density';
import { useTheme, useThemeInit } from '@/components/ThemeProvider';
import { gridProps, axisProps, tooltipProps, toneFill, seriesFill } from '@/components/ui/chart-theme';
import { CATEGORICAL_TOKENS, DATA_TOKENS, TEXT_SCALE, type Density } from '@/components/ui/tokens';

/** Раздел витрины: заголовок, объяснение зачем, содержимое. */
function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-[var(--space-8)]">
      <h2 className="ds-text-lg font-[var(--weight-strong)] text-[var(--ink-strong)]">{title}</h2>
      <p className="ds-text-2xs ds-prose mt-1 text-[var(--ink-muted)]">{note}</p>
      <div className="mt-[var(--space-4)]">{children}</div>
    </section>
  );
}

/** Подпись к образцу — что именно демонстрируется. */
function Sample({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 ds-text-3xs text-[var(--ink-faint)]">{label}</div>
      {children}
    </div>
  );
}

const CHART_DATA = [
  { name: 'янв', план: 420, факт: 380 },
  { name: 'фев', план: 510, факт: 495 },
  { name: 'мар', план: 480, факт: 520 },
  { name: 'апр', план: 610, факт: 540 },
  { name: 'май', план: 560, факт: 575 },
];

const FRESHNESS_SAMPLES: readonly FreshnessInfo[] = [
  { state: 'verified', reason: 'сверено с листом «СВОД ТД-ПМ» вручную 18.08, сошлось до копейки' },
  { state: 'fresh', reason: 'снимок прочитан сегодня в 09:14, лист с тех пор не менялся' },
  {
    state: 'stale',
    reason: 'последний снимок старше суток — лист мог уйти вперёд',
    whatToDo: 'нажать «Обновить» в шапке, чтобы перечитать книгу',
  },
  {
    state: 'failed',
    reason: 'наш счёт разошёлся с итогом листа на 1,4 млн ₽',
    whatToDo: 'открыть «Контроль» и посмотреть, какие строки дали расхождение',
  },
  {
    state: 'unmeasurable',
    reason: 'итоговая строка листа пуста, сверять не с чем',
    whatToDo: 'проверить, что в книге проставлена строка «Итого»',
  },
  {
    state: 'uncovered',
    reason: 'для этого показателя сверка с источником не настроена',
    whatToDo: 'назвать источник в карте происхождения, иначе число нечем подтвердить',
  },
];

export function KitPage() {
  // Витрина открывается отдельно от приложения, поэтому класс темы на
  // корень документа ставит она сама — иначе тёмная тема здесь не
  // включится и половина проверки потеряет смысл.
  useThemeInit();
  const [density, setDensity] = useDensity();
  const { theme, toggleTheme } = useTheme();
  const [scale, setScale] = useState<MoneyScale>('тыс');
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="mx-auto max-w-[80rem] p-[var(--space-6)]">
      <PageHeader
        title="Витрина облика"
        lead="Все примитивы продукта в одном месте: обычные состояния рядом с редкими — пустотой, ожиданием, расхождением с источником. Витрина открывается только в разработке и в собранный продукт не попадает."
        scope="только разработка · #/kit"
        actions={
          <>
            <Segmented<Density>
              legend="Плотность"
              options={[
                { value: 'compact', label: 'Плотно', hint: 'строка ниже, отступы меньше — режим работы за столом' },
                { value: 'comfortable', label: 'Просторно', hint: 'строка выше — режим показа на проекторе' },
              ]}
              value={density}
              onChange={setDensity}
            />
            <Button tone="secondary" size="sm" onClick={toggleTheme}>
              {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            </Button>
          </>
        }
      />

      {/* ── Роли цвета ───────────────────────────────────────────── */}
      <Section
        title="Роли цвета"
        note="Разметка называет роль, а не краску: обе темы правятся в одном месте. Цвет положен данным; хром интерфейса живёт на акценте и чернилах."
      >
        <Card>
          <CardHeader title="Цвет данных" note="Пять ролей со смыслом. Больше цветов у данных нет." />
          <div className="flex flex-wrap gap-[var(--space-4)]">
            {DATA_TOKENS.map((token) => (
              <Sample key={token} label={token.replace('--data-', '')}>
                <div
                  className="h-8 w-20 rounded-[var(--radius-badge)] border border-[var(--line-soft)]"
                  style={{ backgroundColor: `var(${token})` }}
                />
              </Sample>
            ))}
          </div>
          <CardDivider />
          <CardHeader
            title="Категориальный ряд"
            note="Восемь красок без собственного смысла: управления, организации. Уведены по тону от бюджетной тройки, иначе круг по управлениям читался бы как круг по бюджетам."
          />
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {CATEGORICAL_TOKENS.map((token, i) => (
              <div
                key={token}
                className="h-8 w-12 rounded-[var(--radius-badge)]"
                style={{ backgroundColor: seriesFill(i) }}
                title={token}
              />
            ))}
          </div>
        </Card>
      </Section>

      {/* ── Шкала кегля ──────────────────────────────────────────── */}
      <Section
        title="Шкала кегля"
        note="Девять ступеней от приписки под числом до главного числа экрана. Кегль, межстрочное и межбуквенное едут вместе — порознь они всегда разъезжаются. Плотность меняет высоту строки и отступы, но НЕ размер шрифта: текст остаётся читаемым в обоих режимах."
      >
        <Card>
          <div className="space-y-2">
            {TEXT_SCALE.map((token) => {
              const step = token.replace('--text-', '');
              return (
                <div key={token} className="flex items-baseline gap-[var(--space-4)]">
                  <span className="w-16 shrink-0 ds-text-3xs text-[var(--ink-faint)]">{step}</span>
                  <span className={`ds-text-${step} text-[var(--ink-strong)]`}>
                    Закупки управления образования
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </Section>

      {/* ── Кнопки ───────────────────────────────────────────────── */}
      <Section
        title="Кнопка"
        note="Главная кнопка — акцент, а не синяя заливка: синий, красный и зелёный заняты данными. Необратимое действие обведено тревожным, но не залито им. Ожидание не меняет ширину кнопки, нажатие ничего не сжимает."
      >
        <Card>
          <div className="flex flex-wrap items-end gap-[var(--space-4)]">
            <Sample label="главное">
              <Button tone="primary">Обновить снимок</Button>
            </Sample>
            <Sample label="обычное">
              <Button tone="secondary" icon={<Download size={14} />}>Выгрузить</Button>
            </Sample>
            <Sample label="тихое">
              <Button tone="quiet">Свернуть</Button>
            </Sample>
            <Sample label="необратимое">
              <Button tone="danger" icon={<Trash2 size={14} />}>Снять снимок</Button>
            </Sample>
            <Sample label="недоступно">
              <Button tone="secondary" disabled>Сверить</Button>
            </Sample>
            <Sample label="идёт работа">
              <Button tone="primary" busy={busy} onClick={() => { setBusy(true); window.setTimeout(() => setBusy(false), 1600); }}>
                Перечитать книгу
              </Button>
            </Sample>
            <Sample label="только значок">
              <Button tone="secondary" iconOnly aria-label="Обновить" icon={<RefreshCw size={14} />} />
            </Sample>
          </div>
          <CardDivider />
          <div className="flex flex-wrap items-end gap-[var(--space-3)]">
            <Sample label="малая"><Button size="sm">Малая</Button></Sample>
            <Sample label="обычная"><Button size="md">Обычная</Button></Sample>
            <Sample label="крупная"><Button size="lg">Крупная</Button></Sample>
          </div>
          <CardFooter>
            Кольцо фокуса рисуется общим правилом: пройдите по кнопкам табуляцией — оно обязано быть видно в обеих темах.
          </CardFooter>
        </Card>
      </Section>

      {/* ── Число-показатель ─────────────────────────────────────── */}
      <Section
        title="Число-показатель"
        note="У числа четыре обязанности: подпись, скоуп (за какой период и на какой момент прочитано), честная пустота вместо нуля и словесный дубль направления изменения."
      >
        <div className="grid gap-[var(--space-3)] md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <Stat
              label="Исполнение плана"
              value="72,4"
              unit="%"
              scope="2026 · год · на 18.08"
              size="hero"
              delta={{ text: '+4,1 п.п.', tone: 'good', meaning: 'больше, чем неделю назад' }}
            />
          </Card>
          <Card>
            <Stat
              label="Нарушений срока"
              value="14"
              unit="шт."
              tone="bad"
              scope="1 кв · на 18.08"
              delta={{ text: '+3', tone: 'bad', meaning: 'больше, чем неделю назад' }}
              hint="Срок считается от даты размещения извещения до даты заключения контракта."
            />
          </Card>
          <Card>
            <Stat
              label="Экономия по торгам"
              value={null}
              emptyReason="НМЦК в книге мониторинга не проставлена — считать не от чего"
              scope="2026 · год"
            />
          </Card>
          <Card>
            <Stat
              label="Средняя конкуренция"
              value="3,2"
              unit="заявки"
              scope="2 кв · на 18.08"
              tone="info"
              delta={{ text: '−0,4', tone: 'bad', meaning: 'меньше, чем в первом квартале' }}
            />
          </Card>
        </div>
      </Section>

      {/* ── Происхождение и доверие ──────────────────────────────── */}
      <Section
        title="Происхождение числа и доверие к нему"
        note="Вопрос «откуда это взялось» возникает в момент чтения числа, поэтому ответ висит на самом числе, а не на отдельной вкладке. Метка доверия знает шесть состояний: ненастроенная и несостоявшаяся сверка идут тревожным тоном, потому что «мы не знаем» — это не «всё хорошо»."
      >
        <div className="grid gap-[var(--space-3)] lg:grid-cols-2">
          <Card>
            <CardHeader title="Откуда число" note="Нажмите на число — раскроется источник, формула листа и двойной адрес." />
            <div className="flex flex-wrap items-baseline gap-[var(--space-6)]">
              <Origin
                metric="Плановая сумма закупок"
                source="Книга «Свод», лист «СВОД ТД-ПМ»"
                howSourceCounts="=СУММ(K5:K318) по строкам управления"
                match="exact"
                sheetRef="СВОД ТД-ПМ · K319"
                rowAddress="строка 319 · итог листа"
                readAt="18.08.2026, 09:14"
              >
                <span className="ds-text-2xl font-[var(--weight-strong)] tabular-nums text-[var(--ink-strong)]">
                  1 240,5
                </span>
                <span className="ds-text-2xs text-[var(--ink-muted)]">млн ₽</span>
              </Origin>

              <Origin
                metric="Экономия по торгам"
                source="Книга «Ежедневный мониторинг»"
                howSourceCounts="НМЦК минус цена победителя по состоявшимся процедурам"
                match="divergent"
                sheetRef="Мониторинг · R145"
                rowAddress="строка 218 · № п/п 145"
                readAt="18.08.2026, 09:14"
                note="Отчёт считает экономию против плановой суммы, мы — против НМЦК. Против плана экономия растворяется, когда план правят задним числом."
              >
                <span className="ds-text-2xl font-[var(--weight-strong)] tabular-nums text-[var(--data-warn)]">
                  84,2
                </span>
                <span className="ds-text-2xs text-[var(--ink-muted)]">млн ₽</span>
              </Origin>
            </div>
            <CardFooter>
              Точка у числа темнеет до тревожного тона, когда наш счёт расходится со счётом источника.
            </CardFooter>
          </Card>

          <Card>
            <CardHeader title="Доверие к числу" note="Шесть состояний. Одно на карточку — по наихудшему; полный перечень отдаётся раскрытию." />
            <div className="space-y-2">
              {FRESHNESS_SAMPLES.map((info) => (
                <div key={info.state} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line-soft)] pb-2 last:border-b-0">
                  <FreshnessMark info={info} readAt="18.08, 09:14" />
                  <span className="ds-text-3xs ds-prose text-[var(--ink-faint)]">
                    {info.whatToDo ?? 'действия не требуется'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Section>

      {/* ── Чипы ─────────────────────────────────────────────────── */}
      <Section
        title="Чип: метка и переключатель фильтра"
        note="Метка просто говорит слово; переключатель становится настоящей кнопкой с состоянием, потому что выбранный фильтр обязан быть слышен диктору, а не только виден по заливке."
      >
        <Card>
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <Chip>обычная метка</Chip>
            <Chip tone="good">исполнено</Chip>
            <Chip tone="warn">срок близко</Chip>
            <Chip tone="bad">срок нарушен</Chip>
            <Chip tone="info">на согласовании</Chip>
            <Chip tone="accent">выбранный фильтр</Chip>
          </div>
          <CardDivider />
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <Chip pressed onClick={() => {}}>Единственный поставщик</Chip>
            <Chip onClick={() => {}}>Электронный аукцион</Chip>
            <Chip onClick={() => {}}>Запрос котировок</Chip>
          </div>
        </Card>
      </Section>

      {/* ── Шкала денег и доля ───────────────────────────────────── */}
      <Section
        title="Две шкалы денег и двойная доля"
        note="Книга мониторинга ведёт суммы в рублях, свод и отчёт — в тысячах. Столбик высотой «1 200» без названной единицы — это либо тысяча двести рублей, либо миллион двести тысяч. Доля бывает счётной и денежной, и они расходятся в разы."
      >
        <div className="grid gap-[var(--space-3)] lg:grid-cols-2">
          <Card>
            <CardHeader
              title="План и факт по месяцам"
              scope="2026 · на 18.08"
              actions={
                <Segmented<MoneyScale>
                  legend="Шкала денег"
                  options={(['руб', 'тыс', 'млн'] as const).map((value) => ({
                    value,
                    label: value,
                    hint: MONEY_SCALE_HINT[value],
                  }))}
                  value={scale}
                  onChange={setScale}
                />
              }
            />
            <ChartFrame
              unit={scale === 'руб' ? '₽' : scale === 'тыс' ? 'тыс ₽' : 'млн ₽'}
              summary="Факт держится вблизи плана четыре месяца подряд; в марте и мае факт выше плана, что означает правку плана задним числом, а не перевыполнение."
              height={200}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={CHART_DATA} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis {...axisProps} />
                  <Tooltip {...tooltipProps} />
                  <Bar dataKey="план" fill={toneFill('neutral')} radius={0} />
                  <Bar dataKey="факт" fill={toneFill('info')} radius={0} />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>

          <div className="space-y-[var(--space-3)]">
            <Card>
              <CardHeader title="График без данных" note="Пустое полотно с осями читается как «все значения нулевые» — поэтому оно не рисуется вовсе." />
              <ChartFrame
                unit="тыс ₽"
                emptyReason="За выбранную неделю в книге нет ни одной завершённой процедуры — рисовать нечего. Смените период либо снимите фильтр по управлению."
                summary="Данных за период нет; причина названа выше."
                height={140}
              />
            </Card>
            <Card>
              <CardHeader title="Доля единственного поставщика" scope="2026 · год · на 18.08" />
              <SharePair
                byCount="80,4 %"
                byMoney="12,1 %"
                of="закупки у единственного поставщика по ст. 93 44-ФЗ"
              />
            </Card>
          </div>
        </div>
      </Section>

      {/* ── Таблица ──────────────────────────────────────────────── */}
      <Section
        title="Реестровая таблица"
        note="Шапка не уезжает при прокрутке, числа набраны табличными цифрами, формульные колонки помечены знаком «равно», адрес строки двойной, а замечания живут в самой строке, а не отдельным списком на отдельной вкладке."
      >
        <Card bare>
          <DataTable
            caption="Закупки управления «Образец» · 2026 год · на 18.08 · суммы в тыс ₽"
            maxHeight="18rem"
          >
            <THead>
              <tr>
                <Th>Адрес строки</Th>
                <Th>Предмет закупки</Th>
                <Th numeric>План</Th>
                <Th numeric>Факт</Th>
                <Th numeric formula>Экономия</Th>
                <Th numeric formula>Исполнение, %</Th>
                <Th>Замечания</Th>
              </tr>
            </THead>
            <TBody>
              <Tr>
                <Td><RowAddress sheet="СВОД ТД-ПМ" row={214} seq="141" /></Td>
                <Td>Поставка учебной литературы</Td>
                <Td numeric>4 200,0</Td>
                <Td numeric>4 018,4</Td>
                <Td numeric formula muted>181,6</Td>
                <Td numeric formula muted>95,7</Td>
                <Td><RowSignals signals={[]} /></Td>
              </Tr>
              <Tr signalTone="warn">
                <Td><RowAddress sheet="СВОД ТД-ПМ" row={218} seq="145" /></Td>
                <Td>Текущий ремонт кровли</Td>
                <Td numeric>12 500,0</Td>
                <Td numeric>12 500,0</Td>
                <Td numeric formula muted>0,0</Td>
                <Td numeric formula muted>100,0</Td>
                <Td><RowSignals signals={[{ label: 'экономии нет при конкурентной процедуре', tone: 'warn' }]} /></Td>
              </Tr>
              <Tr signalTone="bad">
                <Td><RowAddress sheet="СВОД ТД-ПМ" row={231} seq={null} /></Td>
                <Td>Услуги охраны</Td>
                <Td numeric>3 100,0</Td>
                <Td numeric>—</Td>
                <Td numeric formula muted>—</Td>
                <Td numeric formula muted>—</Td>
                <Td>
                  <RowSignals
                    signals={[
                      { label: 'не обеспечено финансированием', tone: 'bad' },
                      { label: '«№ п/п» не проставлен', tone: 'warn' },
                    ]}
                  />
                </Td>
              </Tr>
              <Tr marked>
                <Td><RowAddress sheet="СВОД ТД-ПМ" row={240} seq="167" /></Td>
                <Td>Поставка компьютерной техники</Td>
                <Td numeric>8 900,0</Td>
                <Td numeric>7 640,2</Td>
                <Td numeric formula muted>1 259,8</Td>
                <Td numeric formula muted>85,8</Td>
                <Td><RowSignals signals={[]} /></Td>
              </Tr>
            </TBody>
          </DataTable>
        </Card>
      </Section>

      {/* ── Пустые состояния ─────────────────────────────────────── */}
      <Section
        title="Три семьи пустоты"
        note="«Ничего нет», «фильтр вычел всё» и «сломалось» — три разные новости с тремя разными действиями. Строка «Нет данных» не отличает их и потому запрещена."
      >
        <div className="grid gap-[var(--space-3)] lg:grid-cols-3">
          <Card>
            <EmptyState
              size="compact"
              title="За неделю не заключено ни одного контракта"
              description="Это не сбой: в выбранной неделе управление не завершило ни одной процедуры. Возьмите более широкий период."
              action={{ label: 'Показать за квартал' }}
            />
          </Card>
          <Card>
            <EmptyState
              size="compact"
              title="Фильтры вычли все строки"
              description="Из 318 строк реестра под текущий набор фильтров не подошла ни одна. Чаще всего лишний фильтр — период."
              action={{ label: 'Сбросить фильтры' }}
              secondaryAction={{ label: 'Снять только период' }}
            />
          </Card>
          <Card>
            <EmptyState
              size="compact"
              tone="problem"
              title="Сервер не назвал ни одной книги"
              description="Список источников не получен, поэтому показывать нечего. Числа при этом не потеряны — они в книге."
              action={{ label: 'Повторить запрос' }}
              detail="ECONNREFUSED 127.0.0.1:3000"
            />
          </Card>
        </div>
      </Section>

      {/* ── Уведомления и шторка ─────────────────────────────────── */}
      <Section
        title="Уведомления и шторка снизу"
        note="Уведомление говорит «получилось» или «не получилось и вот что делать»; подробность остаётся на экране, потому что уведомление уезжает. Отказ не уезжает сам — читатель мог смотреть в другую часть экрана. Шторка выезжает снизу и смахивается вниз: на телефоне низ экрана — единственное место, куда дотягивается большой палец."
      >
        <Card>
          <div className="flex flex-wrap items-center gap-[var(--space-3)]">
            <Button
              tone="secondary"
              onClick={() => notifyDone('Снимок обновлён', { detail: 'прочитано 318 строк, из них новых 4' })}
            >
              Показать «получилось»
            </Button>
            <Button
              tone="secondary"
              onClick={() =>
                notifyProblem('Книгу прочитать не удалось', {
                  reason: 'сервер не ответил за тридцать секунд',
                  whatToDo: 'проверьте, что служба запущена, и повторите',
                  where: 'вкладка «Система», раздел «Источники»',
                  action: { label: 'Повторить', onClick: () => notifyDone('Снимок обновлён') },
                })
              }
            >
              Показать отказ
            </Button>
            <Button
              tone="secondary"
              onClick={() => {
                const id = notifyWorking('Читаем книгу мониторинга…');
                window.setTimeout(() => notifyReplaceDone(id, 'Книга прочитана', '1 204 строки'), 1800);
              }}
            >
              Показать долгую работу
            </Button>
            <Button tone="primary" onClick={() => setSheetOpen(true)}>
              Открыть шторку
            </Button>
          </div>
          <CardFooter>
            Сузьте окно до ширины телефона и потяните шторку за ручку вниз — ниже трети хода она закрывается.
          </CardFooter>
        </Card>

        <Drawer
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title="Текущий ремонт кровли"
          description="Строка 218 · № п/п 145 · управление «Образец»"
          footer={
            <div className="flex justify-end gap-[var(--space-2)]">
              <Button tone="quiet" onClick={() => setSheetOpen(false)}>Закрыть</Button>
              <Button tone="primary" onClick={() => setSheetOpen(false)}>Открыть в книге</Button>
            </div>
          }
        >
          <dl className="space-y-2">
            {[
              ['Плановая сумма', '12 500,0 тыс ₽'],
              ['Фактическая сумма', '12 500,0 тыс ₽'],
              ['Экономия', '0,0 тыс ₽'],
              ['Способ определения поставщика', 'электронный аукцион'],
              ['Дата заключения контракта', '14.05.2026'],
            ].map(([term, value]) => (
              <div key={term} className="flex items-baseline justify-between gap-[var(--space-3)] border-b border-[var(--line-soft)] pb-1 last:border-b-0">
                <dt className="ds-text-2xs text-[var(--ink-muted)]">{term}</dt>
                <dd className="ds-text-2xs tabular-nums text-[var(--ink-strong)]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-[var(--space-3)] ds-text-3xs ds-prose text-[var(--ink-faint)]">
            Экономии нет при конкурентной процедуре — цена победителя совпала с начальной. Это не ошибка
            ввода сама по себе, но повод посмотреть протокол.
          </p>
        </Drawer>
      </Section>

      {/* ── Поверхности ──────────────────────────────────────────── */}
      <Section
        title="Поверхности"
        note="Четыре высоты и запрет карточки в карточке: вложенная поверхность даёт третью границу подряд и съедает ширину. Вложенная карточка рисуется плоской сама, не полагаясь на память автора страницы."
      >
        <div className="grid gap-[var(--space-3)] md:grid-cols-3">
          <Card>
            <CardHeader title="Приподнятая" note="Главный блок экрана." />
            <p className="ds-text-2xs text-[var(--ink-muted)]">Тень первого уровня, крепкая граница.</p>
          </Card>
          <Card tone="flat">
            <CardHeader title="Плоская" note="Блок внутри уже существующей поверхности." />
            <p className="ds-text-2xs text-[var(--ink-muted)]">Без тени.</p>
          </Card>
          <Card tone="sunken">
            <CardHeader title="Утопленная" note="Подложка для перечня внутри карточки." />
            <p className="ds-text-2xs text-[var(--ink-muted)]">Мягкая граница, фон ниже страницы.</p>
          </Card>
        </div>
      </Section>

      <p className="mt-[var(--space-10)] ds-text-3xs ds-prose text-[var(--ink-faint)]">
        Проверка витрины: пройти табуляцией по всем кнопкам, чипам-переключателям и раскрытиям
        происхождения — кольцо фокуса обязано быть видно везде и в обеих темах; переключить тему и
        плотность — ни один блок не должен изменить высоту сам по себе; сузить окно до ширины
        телефона — ни одна таблица не должна вытолкнуть страницу вбок.
      </p>
    </div>
  );
}
