// ── Страница «Система»: три вкладки — источники данных, соответствие ячеек,
//    подключение к Google Таблицам.
//
//    08.08.2026, продуктовая переплавка. Что здесь принципиально изменилось и
//    почему (чтобы правки не откатили обратно):
//
//    1. Отказы больше не проглатываются. Раньше `.catch(() => {})` стоял на
//       чтении источников и соответствий: сервер молчал — экран показывал
//       пустоту без единого слова, и читатель не мог отличить «данных нет» от
//       «запрос не дошёл». Теперь у каждого чтения есть состояние ошибки с
//       причиной и кнопкой «Повторить».
//    2. Счётчик замечаний считался дважды. `globalValidation.totalIssues`
//       накапливал итог валидации И одновременно тот же итог приходил из
//       `validationResults` — полоса показывала удвоенное число. Счётчик
//       остался один, выведенный из результатов проверок.
//    3. Различие «сервер жив, но не настроен» / «сервера нет» ловилось
//       подстрокой `String(e).includes('API error')`. Текст ошибок стал
//       русским — проверка замолчала, и живой ненастроенный сервер рисовался
//       как выключенный. Теперь различие читается полем `ApiError.status`.
//    4. Правка адреса ячейки отправляла на сервер «Лист!D14», а сервер ждёт
//       «D14» (регулярное выражение в routes/mapping.ts) — правка молча
//       отваливалась с кодом 400. Теперь редактируется только адрес ячейки,
//       лист показан рядом и не редактируется, а отказ виден.
//    5. Закрытый ключ не показывается целиком ни при каких условиях: поле
//       всегда закрыто, по требованию открывается только начало и конец.
//       Заглушка «ключ уже на сервере» больше не может уехать в .env вместо
//       настоящего ключа — сохранение в этом состоянии заблокировано.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Database, Map as MapIcon, Key, RefreshCw, CheckCircle2, AlertTriangle, Clock,
  ExternalLink, Save, Eye, EyeOff, HelpCircle, Wifi, WifiOff, Loader2,
  Copy, Download, Info, Search,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError, humanizeRequestError } from '../api';
import { useStore } from '../store';
import { SVOD_SPREADSHEET_ID } from '@aemr/shared';
import { pluralRu } from '../lib/economy-copy';
import { SkeletonCard, SkeletonTable, SkeletonStatusPanel } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { HelpButton } from '../lib/help/HelpButton';

type SourceStatus = 'ok' | 'warning' | 'error' | 'unknown';

interface SheetSource {
  id: string;
  name: string;
  /** Идентификатор книги Google Таблиц; null — источник не привязан к книге. */
  spreadsheetId: string | null;
  status: SourceStatus;
  /** Уточнение состояния от сервера («Демо», «Не загружена», текст отказа). */
  statusDetail: string | null;
  /** Момент последнего успешного чтения; null — книга ещё ни разу не читалась. */
  lastReadAt: string | null;
  /** Строк прочитано; null — сервер не сообщил (не то же самое, что ноль строк). */
  rows: number | null;
}

interface MappingEntry {
  metricKey: string;
  label: string;
  /** Лист книги СВОД — задаётся каноном отчёта, вручную не правится. */
  sheet: string;
  /** Адрес ячейки внутри листа — единственное, что можно переназначить. */
  cell: string;
  currentValue: string | number | null;
  group: string;
  isOverridden: boolean;
  readStatus: 'ok' | 'empty' | 'error' | 'unknown';
}

type FeedbackState = 'idle' | 'loading' | 'success' | 'error';

interface Feedback {
  state: FeedbackState;
  message?: string;
}

type TabId = 'sources' | 'mapping' | 'connection';

/**
 * Точка состояния — только дубль к слову, которое стоит рядом. Сама по себе
 * она ничего не сообщает: чёрно-белая печать и цветовая слепота делают цвет
 * недоступным, поэтому состояние всегда прочитывается текстом (канон DESIGN.md).
 */
const TONE_DOT: Record<DiagnosticTone, string> = {
  ok: 'bg-emerald-500',
  problem: 'bg-red-500',
  wait: 'bg-blue-400 animate-pulse',
  unknown: 'bg-zinc-300 dark:bg-zinc-600',
};

const TABS: { id: TabId; label: string; icon: typeof Database; description: string }[] = [
  { id: 'sources', label: 'Источники данных', icon: Database, description: 'Книги Google Таблиц, из которых берутся числа: доступны ли они и когда читались' },
  { id: 'mapping', label: 'Соответствие ячеек', icon: MapIcon, description: 'Из какой ячейки листа СВОД берётся каждый официальный показатель' },
  { id: 'connection', label: 'Подключение', icon: Key, description: 'Доступ приложения к Google Таблицам: сервисный аккаунт и ключ' },
];

const STATUS_CONFIG: Record<SourceStatus, { label: string; bg: string; text: string; icon: typeof CheckCircle2 }> = {
  ok: { label: 'Читается', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  warning: { label: 'Читается частично', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', icon: Clock },
  error: { label: 'Не читается', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', icon: AlertTriangle },
  unknown: { label: 'Ещё не проверялась', bg: 'bg-zinc-50 dark:bg-zinc-950/30', text: 'text-zinc-500 dark:text-zinc-400', icon: HelpCircle },
};

/**
 * Адрес ячейки, который принимает сервер: буквы столбца + номер строки
 * (D14, AA255). Ровно то же выражение стоит в routes/mapping.ts — проверяем
 * здесь, чтобы отказ был мгновенным и на понятном языке, а не кодом 400.
 */
export const CELL_ADDRESS_RE = /^[A-Z]{1,3}\d{1,4}$/;

/**
 * Заглушка вместо ключа, уже лежащего на сервере. Прочитать ключ обратно
 * нельзя (и не нужно), поэтому заглушка — маркер состояния «ключ есть, но он
 * не у нас в руках», а не значение. Сохранять её в .env запрещено: раньше это
 * приводило к тому, что нажатие «Сохранить» после правки одного лишь порта
 * записывало в файл строку из точек вместо рабочего ключа.
 */
const KEY_ON_SERVER = '(ключ уже сохранён на сервере)';

/**
 * Сколько времени прошло — русской фразой.
 *
 * Момент «сейчас» передаётся снаружи, чтобы диагностику можно было проверить
 * тестом: иначе выражение зависит от часов машины и проверяемо только на глаз.
 */
function timeAgo(dateStr: string | null, now: number = Date.now()): string {
  if (!dateStr) return 'никогда';
  const diff = now - new Date(dateStr).getTime();
  if (diff < 0) return 'только что';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'только что';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  return `${days} ${pluralRu(days, 'день', 'дня', 'дней')} назад`;
}

/**
 * Показать ключ можно только фрагментом: начало и конец, середина скрыта.
 * Этого достаточно, чтобы убедиться «вставил тот файл», и недостаточно, чтобы
 * ключ утёк со скриншота или через плечо.
 */
export function maskSecret(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= 24) return '•'.repeat(Math.max(compact.length, 8));
  return `${compact.slice(0, 14)} … ${compact.slice(-10)}`;
}

/** Короткий вид идентификатора книги: он длинный и в карточку не помещается. */
function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 14)}…` : id;
}

/**
 * Ответ сервера о книгах → карточки страницы.
 *
 * Две вещи здесь принципиальны и потому вынесены из компонента под тест:
 * 1. `rowCount: null` («сервер не сообщил») отличается от нуля строк — иначе
 *    непрочитанная книга выглядит как прочитанная и пустая;
 * 2. подпись состояния берётся из словаря, а причина отказа (её сервер
 *    вкладывает в `statusLabel` как «Ошибка: …», и текст там английский —
 *    его формирует библиотека Google) уезжает в отдельное поле, чтобы не
 *    попасть в бейдж состояния.
 */
export function parseSourcesResponse(data: unknown): SheetSource[] {
  const list = (data as { sources?: unknown[] } | null)?.sources ?? [];
  return list.map((raw): SheetSource => {
    const s = raw as Record<string, unknown>;
    const rawLabel = typeof s.statusLabel === 'string' ? s.statusLabel : null;
    const detail = rawLabel && /^Ошибка:\s*/.test(rawLabel)
      ? rawLabel.replace(/^Ошибка:\s*/, '')
      : rawLabel && rawLabel !== 'Активна'
        ? rawLabel
        : null;
    return {
      id: String(s.name ?? ''),
      name: String(s.name ?? ''),
      spreadsheetId: typeof s.spreadsheetId === 'string' && s.spreadsheetId ? s.spreadsheetId : null,
      status: (s.status as SourceStatus) ?? 'unknown',
      statusDetail: detail,
      lastReadAt: typeof s.lastSuccess === 'string' ? s.lastSuccess : null,
      rows: typeof s.rowCount === 'number' ? s.rowCount : null,
    };
  });
}

/* ── Диагностика: что подключено, что сломано и что с этим делать ─────────
 *
 * Раньше вся эта правда была рассыпана по трём вкладкам: состояние сервера —
 * в «Подключении», число прочитанных строк — в «Источниках», признак «данные
 * так и не пришли» — в тонкой полосе наверху. Человек, у которого экран пуст,
 * должен был обойти три места и сложить ответ сам.
 *
 * Здесь ответ собран в одном списке и построен по одному правилу: предмет →
 * состояние словами → что сделать. Строка без действия допустима только
 * тогда, когда делать действительно нечего.
 *
 * Функция намеренно чистая: она не спрашивает сервер и не читает часы (момент
 * «сейчас» передают снаружи), поэтому её поведение закреплено тестами —
 * см. Settings.logic.test.ts.
 */

/** Тон строки диагностики. Это разные новости, а не оттенки одной. */
export type DiagnosticTone = 'ok' | 'problem' | 'wait' | 'unknown';

export interface DiagnosticLine {
  /** О чём строка: «Сервер данных», «Книги-источники». */
  subject: string;
  /** Состояние словами — утверждение, читаемое без легенды. */
  state: string;
  /** Что сделать. null — делать нечего, всё в порядке или ответ ещё не пришёл. */
  action: string | null;
  tone: DiagnosticTone;
}

export interface DiagnosticsInput {
  /** Ответил ли сервер на опрос состояния; null — ещё не спрашивали. */
  serverOnline: boolean | null;
  /** Сервер сообщает, что доступ к Google Таблицам настроен полностью. */
  sheetsConfigured: boolean;
  /** Ключ доступа к серверу, найденный в этом браузере; null — не сохранён. */
  accessKey: string | null;
  /** Книги-источники в том виде, в каком их вернул сервер. */
  sources: Pick<SheetSource, 'status' | 'rows'>[];
  /** Спрашивали ли уже список книг: «не спрашивали» ≠ «книг нет». */
  sourcesLoadedOnce: boolean;
  /** Момент последнего успешного перечитывания книг. */
  lastRefreshed: string | null;
  /** Отказ загрузки данных дэша, если он был. */
  dataError: string | null;
  /** Данные дэша уже пришли хотя бы раз. */
  hasData: boolean;
  /** Момент «сейчас» — передаётся ради проверяемости. */
  now?: number;
}

/**
 * Ключ доступа показывается только хвостом: четырёх последних знаков хватает,
 * чтобы убедиться «это тот самый ключ», и не хватает, чтобы им воспользоваться
 * по снимку экрана или через плечо. Короткий ключ закрывается целиком —
 * по его хвосту слишком легко достроить остальное.
 */
export function maskAccessKey(key: string): string {
  const compact = key.trim();
  if (compact.length === 0) return '';
  if (compact.length < 12) return '•'.repeat(8);
  return `••••${compact.slice(-4)}`;
}

export function buildDiagnostics(input: DiagnosticsInput): DiagnosticLine[] {
  const now = input.now ?? Date.now();
  const lines: DiagnosticLine[] = [];

  /* 1. Сервер данных — без него бессмысленно всё остальное. */
  lines.push(
    input.serverOnline === null
      ? { subject: 'Сервер данных', state: 'спрашиваем о состоянии', action: null, tone: 'wait' }
      : input.serverOnline
        ? { subject: 'Сервер данных', state: 'отвечает на запросы', action: null, tone: 'ok' }
        : {
            subject: 'Сервер данных',
            state: 'не отвечает',
            action: 'Запустите сервер и обновите страницу — пока он молчит, числа брать неоткуда',
            tone: 'problem',
          },
  );

  /* 2. Доступ к Google Таблицам. Пока сервер молчит, ответа на этот вопрос
        нет вовсе — и врать «настроен» нельзя. */
  lines.push(
    input.serverOnline !== true
      ? {
          subject: 'Доступ к Google Таблицам',
          state: 'неизвестен, пока сервер не ответил',
          action: null,
          tone: 'unknown',
        }
      : input.sheetsConfigured
        ? { subject: 'Доступ к Google Таблицам', state: 'настроен', action: null, tone: 'ok' }
        : {
            subject: 'Доступ к Google Таблицам',
            state: 'настроен не полностью',
            action: 'Откройте вкладку «Подключение» и заполните почту сервисного аккаунта, закрытый ключ и идентификатор книги',
            tone: 'problem',
          },
  );

  /* 3. Ключ доступа к серверу. Требует ли его сервер — знает только сервер,
        поэтому отсутствие ключа объявляется возможной, а не точной причиной. */
  lines.push(
    input.accessKey
      ? {
          subject: 'Ключ доступа к серверу',
          state: `сохранён в этом браузере: ${maskAccessKey(input.accessKey)}`,
          action: null,
          tone: 'ok',
        }
      : {
          subject: 'Ключ доступа к серверу',
          state: 'в этом браузере не сохранён',
          action: 'Если сервер закрыт ключом, запросы будут отклоняться — возьмите ключ у того, кто настраивал сервер',
          tone: 'unknown',
        },
  );

  /* 4. Книги-источники. */
  const total = input.sources.length;
  const okCount = input.sources.filter(s => s.status === 'ok').length;
  const errorCount = input.sources.filter(s => s.status === 'error').length;
  if (!input.sourcesLoadedOnce) {
    lines.push({
      subject: 'Книги-источники',
      state: 'список ещё не запрашивался',
      action: 'Откройте вкладку «Источники данных» — список придёт с сервера',
      tone: 'unknown',
    });
  } else if (total === 0) {
    lines.push({
      subject: 'Книги-источники',
      state: 'сервер не назвал ни одной книги',
      action: 'Так бывает, когда доступ к Google Таблицам ещё не настроен — проверьте вкладку «Подключение»',
      tone: 'problem',
    });
  } else if (errorCount > 0) {
    lines.push({
      subject: 'Книги-источники',
      state: `не читаются: ${errorCount} из ${total}`,
      action: 'Нажмите «Проверить связь» в карточке книги — там будет названа причина отказа',
      tone: 'problem',
    });
  } else {
    lines.push({
      subject: 'Книги-источники',
      state: okCount === total ? `читаются все ${total}` : `читаются ${okCount} из ${total}`,
      action: okCount === total ? null : 'Остальные ещё ни разу не читались — нажмите «Прочитать книги заново»',
      tone: okCount === total ? 'ok' : 'wait',
    });
  }

  /* 5. Строки. Книга, не сообщившая число строк, в сумму не входит — иначе
        сумма выглядит полной, будучи частичной. */
  const known = input.sources.filter(s => s.rows !== null);
  const rows = known.reduce((sum, s) => sum + (s.rows ?? 0), 0);
  lines.push(
    known.length === 0
      ? {
          subject: 'Строк прочитано',
          state: 'сервер ещё не сообщал число строк',
          action: null,
          tone: 'unknown',
        }
      : {
          subject: 'Строк прочитано',
          state: known.length === total
            ? `${rows.toLocaleString('ru-RU')} по всем книгам`
            : `${rows.toLocaleString('ru-RU')} по ${known.length} ${pluralRu(known.length, 'книге', 'книгам', 'книгам')} из ${total}; остальные число строк не сообщили`,
          action: null,
          tone: 'ok',
        },
  );

  /* 6. Когда книги читались. */
  lines.push(
    input.lastRefreshed
      ? {
          subject: 'Последнее чтение книг',
          state: timeAgo(input.lastRefreshed, now),
          action: null,
          tone: 'ok',
        }
      : {
          subject: 'Последнее чтение книг',
          state: 'в этой сессии книги ещё не читались',
          action: 'Нажмите «Прочитать книги заново» — это займёт несколько секунд',
          tone: 'wait',
        },
  );

  /* 7. Данные на экране — то, ради чего всё остальное. */
  lines.push(
    input.dataError
      ? {
          subject: 'Данные на экране',
          state: input.dataError,
          action: 'Повторите запрос кнопкой в шапке; если отказ повторяется — причина выше по списку',
          tone: 'problem',
        }
      : input.hasData
        ? { subject: 'Данные на экране', state: 'загружены без отказов', action: null, tone: 'ok' }
        : { subject: 'Данные на экране', state: 'ещё не запрашивались', action: null, tone: 'wait' },
  );

  return lines;
}

/**
 * Заголовок диагностики — утверждение о состоянии, а не «Диагностика».
 * Читатель должен понять, есть ли беда, не разбирая список построчно.
 */
export function summarizeDiagnostics(lines: DiagnosticLine[]): { problems: number; headline: string } {
  const problems = lines.filter(l => l.tone === 'problem').length;
  if (problems === 0) {
    const waiting = lines.some(l => l.tone === 'wait' || l.tone === 'unknown');
    return {
      problems: 0,
      headline: waiting
        ? 'Поломок не видно, но проверено ещё не всё'
        : 'Всё, что проверяется, работает',
    };
  }
  return {
    problems,
    headline: `Сломано: ${problems} ${pluralRu(problems, 'место', 'места', 'мест')} из ${lines.length}`,
  };
}

/**
 * Текст отказа от Google приходит на английском (его формирует их библиотека).
 * Наружу идёт русская рамка, английская подробность — в скобках мелким.
 */
function engineDetail(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : String(raw ?? '');
  return text.trim();
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('sources');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /* ── Источники ─────────────────────────────────────────── */
  const [sources, setSources] = useState<SheetSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [sourcesLoadedOnce, setSourcesLoadedOnce] = useState(false);

  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: any }>>({});
  const [validationResults, setValidationResults] = useState<Record<string, { loading: boolean; result?: any }>>({});
  const [validatingAll, setValidatingAll] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [editSourceValue, setEditSourceValue] = useState('');
  const [saveSourceFeedback, setSaveSourceFeedback] = useState<Record<string, Feedback>>({});

  const [refreshFeedback, setRefreshFeedback] = useState<Feedback>({ state: 'idle' });
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Соответствие ячеек ────────────────────────────────── */
  const [mapping, setMapping] = useState<MappingEntry[]>([]);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingLoadedOnce, setMappingLoadedOnce] = useState(false);
  const [mappingSearch, setMappingSearch] = useState('');
  const [editingMetric, setEditingMetric] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [checkingCells, setCheckingCells] = useState(false);
  const [cellCheckError, setCellCheckError] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  /* ── Подключение ───────────────────────────────────────── */
  const [showKeyFragment, setShowKeyFragment] = useState(false);
  const [connForm, setConnForm] = useState({
    spreadsheetId: SVOD_SPREADSHEET_ID,
    serviceAccountEmail: '',
    privateKey: '',
    port: '3000',
    host: '0.0.0.0',
  });
  const [serverStatus, setServerStatus] = useState<{
    online: boolean;
    configured: boolean;
    email?: string;
  } | null>(null);
  const [saveEnvFeedback, setSaveEnvFeedback] = useState<Feedback>({ state: 'idle' });
  const [sheetsTestFeedback, setSheetsTestFeedback] = useState<Feedback>({ state: 'idle' });

  /**
   * Ключ доступа к серверу лежит в браузере — его подставляет api.ts в
   * заголовок запроса. Читаем один раз при открытии страницы: между
   * перерисовками он не меняется, а сам ключ на экран целиком не попадает
   * ни при каких условиях (см. maskAccessKey).
   */
  const [accessKey] = useState<string | null>(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem('aemr_api_key') : null),
  );

  const refreshResult = useStore(s => s.refreshResult);
  const lastRefreshed = useStore(s => s.lastRefreshed);
  const storeError = useStore(s => s.error);
  const storeLoading = useStore(s => s.loading);
  const hasDashboardData = useStore(s => s.dashboardData !== null);

  /* ── Чтение источников ─────────────────────────────────── */

  const fetchSourcesData = useCallback(async () => {
    setSourcesLoading(true);
    setSourcesError(null);
    try {
      const data = await api.getSources();
      setSources(parseSourcesResponse(data));
    } catch (err) {
      setSourcesError(humanizeRequestError(err));
    } finally {
      setSourcesLoading(false);
      setSourcesLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'sources' && !sourcesLoadedOnce) void fetchSourcesData();
  }, [activeTab, sourcesLoadedOnce, fetchSourcesData]);

  // Обновление в шапке перечитало книги — карточки источников устарели.
  useEffect(() => {
    if (refreshResult && !refreshResult.loading && activeTab === 'sources' && sourcesLoadedOnce) {
      void fetchSourcesData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshResult?.loading]);

  /* ── Состояние сервера (вкладка «Подключение») ──────────── */

  // Форма заполняется значениями сервера ОДИН раз. Опрос идёт каждые 30 секунд,
  // и если заполнять каждый раз, набранный, но не сохранённый текст затирается
  // прямо под руками — человек правит идентификатор книги, отвлекается, и поле
  // молча возвращается к прежнему значению.
  const formHydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const data = await api.settingsStatus();
        if (cancelled) return;
        setServerStatus({ online: true, configured: !!data.configured, email: data.serviceAccountEmail ?? undefined });
        if (!formHydratedRef.current) {
          formHydratedRef.current = true;
          setConnForm(f => ({
            ...f,
            serviceAccountEmail: data.serviceAccountEmail ?? f.serviceAccountEmail,
            spreadsheetId: data.spreadsheetId ?? f.spreadsheetId,
            port: data.port != null ? String(data.port) : f.port,
            host: data.host ?? f.host,
            // Ключ с сервера не приходит и прийти не может: наружу отдаётся
            // только признак его наличия. Поле показывает состояние, не значение.
            privateKey: data.hasPrivateKey ? KEY_ON_SERVER : f.privateKey,
          }));
        }
      } catch (err) {
        if (cancelled) return;
        // ApiError = сервер ОТВЕТИЛ (жив, но отказал) — значит он запущен.
        // Всё прочее (сеть, оффлайн, порт закрыт) = сервера нет.
        setServerStatus({ online: err instanceof ApiError, configured: false });
      }
    };

    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  /* ── Действия: источники ───────────────────────────────── */

  const handleRefreshAll = async () => {
    if (refreshFeedback.state === 'loading') return;
    setRefreshFeedback({ state: 'loading', message: 'Читаем книги заново…' });
    if (refreshTimerRef.current) { clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; }

    try {
      const result = await api.refresh();
      const sourcesData = await api.getSources();
      const newSources = parseSourcesResponse(sourcesData);
      setSources(newSources);
      setSourcesError(null);
      setSourcesLoadedOnce(true);

      const okCount = newSources.filter(s => s.status === 'ok').length;
      // issueCount — то, что сервер реально возвращает из /api/refresh.
      // Прежний код читал result.issues.length, которого в ответе нет: счётчик
      // всегда выходил нулевым и создавал ложное «проблем нет».
      const issueCount: number | null = typeof result?.issueCount === 'number' ? result.issueCount : null;
      const rows = newSources.reduce((sum, s) => sum + (s.rows ?? 0), 0);
      setRefreshFeedback({
        state: 'success',
        message: `Прочитано книг: ${okCount} из ${newSources.length}. Строк: ${rows.toLocaleString('ru-RU')}`
          + (issueCount !== null ? `. Замечаний в сводке: ${issueCount}` : ''),
      });
      refreshTimerRef.current = setTimeout(() => setRefreshFeedback({ state: 'idle' }), 8000);
    } catch (err) {
      setRefreshFeedback({ state: 'error', message: `Книги не перечитаны. ${humanizeRequestError(err)}` });
      refreshTimerRef.current = setTimeout(() => setRefreshFeedback({ state: 'idle' }), 12000);
    }
  };

  useEffect(() => () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); }, []);

  const handleTestSource = async (name: string) => {
    setTestResults(prev => ({ ...prev, [name]: { loading: true } }));
    try {
      const result = await api.testSource(name);
      setTestResults(prev => ({ ...prev, [name]: { loading: false, result } }));
    } catch (err) {
      setTestResults(prev => ({ ...prev, [name]: { loading: false, result: { success: false, error: humanizeRequestError(err) } } }));
    }
  };

  const handleValidateSource = async (name: string) => {
    setValidationResults(prev => ({ ...prev, [name]: { loading: true } }));
    try {
      const result = await api.validateSource(name);
      setValidationResults(prev => ({ ...prev, [name]: { loading: false, result } }));
      setLastCheckedAt(new Date().toISOString());
    } catch (err) {
      setValidationResults(prev => ({ ...prev, [name]: { loading: false, result: { error: humanizeRequestError(err) } } }));
    }
  };

  const handleValidateAll = async () => {
    setValidatingAll(true);
    setValidationResults(prev => {
      const next = { ...prev };
      for (const s of sources) next[s.name] = { loading: true };
      return next;
    });
    try {
      const { results } = await api.validateAllSources();
      setValidationResults(() => {
        const next: Record<string, { loading: boolean; result?: any }> = {};
        for (const r of results ?? []) next[r.name] = { loading: false, result: r.success ? r : { error: r.error } };
        return next;
      });
      setLastCheckedAt(new Date().toISOString());
    } catch (err) {
      const message = humanizeRequestError(err);
      setValidationResults(prev => {
        const next = { ...prev };
        for (const s of sources) next[s.name] = { loading: false, result: { error: message } };
        return next;
      });
    } finally {
      setValidatingAll(false);
    }
  };

  const handleSaveSource = async (srcId: string, srcName: string, newSpreadsheetId: string) => {
    const value = newSpreadsheetId.trim();
    if (!value) {
      setSaveSourceFeedback(prev => ({ ...prev, [srcId]: { state: 'error', message: 'Идентификатор книги пуст — вставьте его из адреса таблицы' } }));
      return;
    }
    setSaveSourceFeedback(prev => ({ ...prev, [srcId]: { state: 'loading' } }));
    try {
      await api.updateSource(srcName, value);
      setSources(prev => prev.map(s => s.id === srcId ? { ...s, spreadsheetId: value } : s));
      setEditingSource(null);
      setSaveSourceFeedback(prev => ({ ...prev, [srcId]: { state: 'success', message: 'Сохранено' } }));
      setTimeout(() => setSaveSourceFeedback(prev => ({ ...prev, [srcId]: { state: 'idle' } })), 3000);
    } catch (err) {
      setSaveSourceFeedback(prev => ({ ...prev, [srcId]: { state: 'error', message: humanizeRequestError(err) } }));
    }
  };

  /* ── Действия: соответствие ячеек ──────────────────────── */

  const fetchMapping = useCallback(async () => {
    setMappingLoading(true);
    setMappingError(null);
    try {
      const data = await api.getMapping();
      const entries: MappingEntry[] = [];
      for (const group of (data?.groups ?? [])) {
        for (const m of (group.metrics ?? [])) {
          entries.push({
            metricKey: m.metricKey,
            label: m.label,
            sheet: m.sourceSheet ?? '',
            cell: m.sourceCell ?? '',
            currentValue: m.currentValue ?? null,
            group: group.name ?? 'Прочее',
            isOverridden: !!m.isOverridden,
            readStatus: 'unknown',
          });
        }
      }
      setMapping(entries);
    } catch (err) {
      setMappingError(humanizeRequestError(err));
    } finally {
      setMappingLoading(false);
      setMappingLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'mapping' && !mappingLoadedOnce) void fetchMapping();
  }, [activeTab, mappingLoadedOnce, fetchMapping]);

  const saveCellRef = async (metricKey: string, nextCell: string) => {
    const cell = nextCell.trim().toUpperCase();
    // Сервер принимает только адрес ячейки без имени листа. Проверяем здесь же,
    // чтобы отказ был мгновенным и понятным, а не кодом 400 из глубины.
    if (!CELL_ADDRESS_RE.test(cell)) {
      setEditError('Нужен адрес ячейки: буквы столбца и номер строки, например D14 или AA255');
      return;
    }
    try {
      await api.updateMapping(metricKey, cell);
      setMapping(prev => prev.map(item => item.metricKey === metricKey
        ? { ...item, cell, isOverridden: true, currentValue: null, readStatus: 'unknown' }
        : item));
      setEditingMetric(null);
      setEditValue('');
      setEditError(null);
    } catch (err) {
      setEditError(humanizeRequestError(err));
    }
  };

  const handleCheckCells = async () => {
    setCheckingCells(true);
    setCellCheckError(null);
    try {
      const res = await api.validateMapping();
      setMapping(prev => prev.map(m => {
        const r = (res?.results ?? []).find((x: any) => x.metricId === m.metricKey);
        return r ? { ...m, currentValue: r.value, readStatus: r.status ?? 'unknown' } : m;
      }));
    } catch (err) {
      setCellCheckError(humanizeRequestError(err));
    } finally {
      setCheckingCells(false);
    }
  };

  const handleResetMapping = async () => {
    setResetArmed(false);
    setMappingError(null);
    try {
      await api.resetMapping();
      setMappingLoadedOnce(false);
      setMapping([]);
    } catch (err) {
      setMappingError(`Возврат к исходным адресам не выполнен. ${humanizeRequestError(err)}`);
    }
  };

  /* ── Действия: подключение ─────────────────────────────── */

  const envText = useMemo(() => `# Google Таблицы
GOOGLE_SHEETS_SPREADSHEET_ID=${connForm.spreadsheetId}
GOOGLE_SERVICE_ACCOUNT_EMAIL=${connForm.serviceAccountEmail}
GOOGLE_PRIVATE_KEY="${connForm.privateKey}"

# Сервер
PORT=${connForm.port}
HOST=${connForm.host}
LOG_LEVEL=info

# База данных (SQLite для разработки)
SQLITE_PATH=./data/aemr.db
# DB_PROVIDER=postgresql
# DATABASE_URL=postgresql://user:pass@localhost:5432/aemr`, [connForm]);

  const keyIsPlaceholder = connForm.privateKey === KEY_ON_SERVER;
  const keyLooksTruncated = !!connForm.privateKey && !keyIsPlaceholder && !connForm.privateKey.includes('BEGIN');
  const canSaveEnv = !!connForm.serviceAccountEmail && !!connForm.privateKey && !keyIsPlaceholder;

  const handleSaveEnv = async () => {
    setSaveEnvFeedback({ state: 'loading', message: 'Сохраняем…' });
    try {
      await api.saveEnv(connForm as unknown as Record<string, string>);
      setServerStatus(s => s ? { ...s, configured: true, email: connForm.serviceAccountEmail } : s);
      setSaveEnvFeedback({ state: 'success', message: 'Файл .env перезаписан на сервере. Перезапустите сервер, чтобы новые значения вступили в силу.' });
    } catch (err) {
      // Сервер намеренно запрещает запись .env вне машины разработчика
      // (routes/settings.ts: только NODE_ENV=development и служебный заголовок).
      // Это не поломка, а защита — и читателю надо сказать именно это, вместе
      // с работающим обходным путём.
      const denied = err instanceof ApiError && err.status === 403;
      setSaveEnvFeedback({
        state: 'error',
        message: denied
          ? 'Сервер не разрешает переписывать .env из браузера — так защищён рабочий контур. Скопируйте текст ниже и положите файл .env в корень проекта вручную.'
          : `Файл .env не сохранён. ${humanizeRequestError(err)}`,
      });
    }
  };

  const handleCopyEnv = async () => {
    try {
      await navigator.clipboard.writeText(envText);
      setSaveEnvFeedback({ state: 'success', message: 'Текст .env скопирован в буфер обмена.' });
    } catch {
      setSaveEnvFeedback({ state: 'error', message: 'Браузер не дал доступ к буферу обмена — выделите текст ниже и скопируйте вручную.' });
    }
  };

  const handleDownloadEnv = () => {
    const blob = new Blob([envText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '.env';
    a.click();
    URL.revokeObjectURL(url);
    setSaveEnvFeedback({ state: 'success', message: 'Файл .env скачан. В нём закрытый ключ — положите его в корень проекта и не пересылайте.' });
  };

  const handleTestSheetsConnection = async () => {
    setSheetsTestFeedback({ state: 'loading', message: 'Проверяем доступ к Google Таблицам…' });
    try {
      const healthRes = await api.health();
      if (healthRes.status !== 'ok') {
        setSheetsTestFeedback({ state: 'error', message: 'Сервер отвечает, но сообщает о неполадке. Проверьте его журнал и перезапустите.' });
        return;
      }
      const testRes = await api.testSource('СВОД ТД-ПМ');
      if (testRes?.success) {
        setSheetsTestFeedback({
          state: 'success',
          message: `Доступ есть. Книга «${testRes.title ?? 'без названия'}», листов: ${testRes.sheetCount ?? 'не сообщено'}.`,
        });
      } else {
        const detail = engineDetail(testRes?.error);
        setSheetsTestFeedback({
          state: 'error',
          message: 'Книга СВОД не открылась. Проверьте, что она доступна сервисному аккаунту (право «Читатель»)'
            + (detail ? ` (${detail})` : ''),
        });
      }
    } catch (err) {
      setSheetsTestFeedback({
        state: 'error',
        message: err instanceof ApiError
          ? `Сервер отказал в проверке. ${err.message}`
          : `Проверка не выполнена. ${humanizeRequestError(err)}`,
      });
    }
  };

  /* ── Производные числа (единственный источник счёта) ────── */

  // Замечания считаются РОВНО один раз — по результатам проверок источников.
  // Прежде тот же итог параллельно копился в отдельном состоянии, и полоса
  // показывала удвоенное число.
  const checkedSources = Object.values(validationResults).filter(v => !v.loading && v.result && !v.result.error);
  const issuesFound = checkedSources.reduce((sum, v) => sum + (v.result.summary?.total ?? 0), 0);
  const rowsKnown = sources.filter(s => s.rows !== null);
  const totalRows = rowsKnown.reduce((sum, s) => sum + (s.rows ?? 0), 0);
  const okSources = sources.filter(s => s.status === 'ok').length;
  const errorSources = sources.filter(s => s.status === 'error').length;

  // Диагностика собирается из того же состояния, что и остальная страница —
  // второго источника правды о поломках не заводим.
  const diagnostics = useMemo(() => buildDiagnostics({
    serverOnline: serverStatus === null ? null : serverStatus.online,
    sheetsConfigured: !!serverStatus?.configured,
    accessKey,
    sources,
    sourcesLoadedOnce,
    lastRefreshed,
    dataError: storeError,
    hasData: hasDashboardData,
  }), [serverStatus, accessKey, sources, sourcesLoadedOnce, lastRefreshed, storeError, hasDashboardData]);
  const diagnosticsSummary = summarizeDiagnostics(diagnostics);

  /* ── Навигация по вкладкам с клавиатуры ────────────────── */

  const activeIndex = Math.max(0, TABS.findIndex(t => t.id === activeTab));
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const last = TABS.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = activeIndex === last ? 0 : activeIndex + 1;
    else if (event.key === 'ArrowLeft') next = activeIndex === 0 ? last : activeIndex - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[next];
    setActiveTab(target.id);
    tabRefs.current[target.id]?.focus();
  };

  return (
    <div className="space-y-6">
      {/* ── Диагностика: один ответ вместо обхода трёх вкладок ──────────
          Заголовок — утверждение о состоянии («Сломано: 2 места из 7»), а не
          слово «Диагностика»: читатель должен понять, есть ли беда, ещё до
          того, как начнёт разбирать список. */}
      <section
        aria-labelledby="diagnostics-title"
        className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200/60 dark:border-zinc-700/50"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={clsx('w-2 h-2 rounded-full flex-shrink-0',
                diagnosticsSummary.problems > 0 ? 'bg-red-500'
                  : storeLoading ? 'bg-blue-400 animate-pulse' : 'bg-emerald-500')}
              aria-hidden="true"
            />
            <h2
              id="diagnostics-title"
              className={clsx('text-sm font-semibold min-w-0',
                diagnosticsSummary.problems > 0 ? 'text-red-700 dark:text-red-300' : 'text-zinc-700 dark:text-zinc-200')}
            >
              {diagnosticsSummary.headline}
            </h2>
          </div>
          <HelpButton
            label="Как читать этот дэш"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          />
        </div>

        <dl className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
          {diagnostics.map(line => (
            <div key={line.subject} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5 text-xs">
              <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0 self-center', TONE_DOT[line.tone])} aria-hidden="true" />
              <dt className="w-52 flex-shrink-0 text-zinc-500 dark:text-zinc-400">{line.subject}</dt>
              <dd className="min-w-0 flex-1">
                <span className={clsx('font-medium',
                  line.tone === 'problem' ? 'text-red-700 dark:text-red-300' : 'text-zinc-700 dark:text-zinc-200')}>
                  {line.state}
                </span>
                {line.action && (
                  <span className="block mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Что делать: {line.action}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Итог проверок: показывается только когда есть что показать ── */}
      {checkedSources.length > 0 && (
        <div
          className={clsx(
            'flex flex-wrap items-center justify-between gap-3 px-5 py-3 rounded-xl border text-sm',
            issuesFound > 0
              ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
              : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
          )}
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            {issuesFound > 0 ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
            <span className="font-medium">
              {issuesFound > 0
                ? `Найдено ${issuesFound} ${pluralRu(issuesFound, 'замечание', 'замечания', 'замечаний')} в ${checkedSources.length} ${pluralRu(checkedSources.length, 'проверенной книге', 'проверенных книгах', 'проверенных книгах')}`
                : `Замечаний нет — проверено книг: ${checkedSources.length} из ${sources.length}`}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs opacity-80">
            {checkedSources.length < sources.length && (
              <span>Остальные книги не проверялись — в счёт не вошли</span>
            )}
            {lastCheckedAt && <span>Проверено: {timeAgo(lastCheckedAt)}</span>}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50">
        {/* ── Вкладки ──────────────────────────────────────── */}
        <div className="flex items-center border-b border-zinc-100 dark:border-zinc-700/50">
          {/* Кнопки действий держим ВНЕ tablist: внутри него по договорённости
              о ролях могут жить только сами вкладки, иначе диктор считает
              кнопку «Обновить» четвёртой вкладкой. */}
          <div role="tablist" aria-label="Разделы настроек системы" className="flex items-center">
            {TABS.map(tab => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  ref={el => { tabRefs.current[tab.id] = el; }}
                  id={`settings-tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`settings-panel-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={onTabKeyDown}
                  title={tab.description}
                  className={clsx(
                    'flex items-center gap-2 px-6 py-3.5 text-sm font-medium border-b-2 transition',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500',
                    isActive
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                  )}
                >
                  <Icon size={15} aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          {activeTab === 'sources' && (
            <div className="flex items-center gap-2 mr-4">
              <span aria-live="polite" className="contents">
                {refreshFeedback.state === 'success' && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={12} aria-hidden="true" /> {refreshFeedback.message}
                  </span>
                )}
                {refreshFeedback.state === 'error' && (
                  <span className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1 max-w-xs truncate" title={refreshFeedback.message}>
                    <AlertTriangle size={12} aria-hidden="true" /> {refreshFeedback.message}
                  </span>
                )}
              </span>
              <button
                onClick={handleRefreshAll}
                disabled={refreshFeedback.state === 'loading'}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
                  refreshFeedback.state === 'loading'
                    ? 'text-blue-400 bg-blue-100 dark:bg-blue-900/40 cursor-wait'
                    : 'text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                )}
              >
                {refreshFeedback.state === 'loading'
                  ? <><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Читаем…</>
                  : <><RefreshCw size={12} aria-hidden="true" /> Прочитать книги заново</>}
              </button>
            </div>
          )}
        </div>

        {/* ── Вкладка «Источники данных» ────────────────────── */}
        {activeTab === 'sources' && (
          <div className="p-5" role="tabpanel" id="settings-panel-sources" aria-labelledby="settings-tab-sources" tabIndex={-1}>
            {sourcesLoading && sources.length === 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
                <span className="sr-only">Читаем список источников</span>
                {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            )}

            {/* Отказ чтения — с причиной и действием, а не молчаливая пустота */}
            {!sourcesLoading && sourcesError && (
              <EmptyState
                tone="problem"
                title="Список источников не получен"
                description="Пока сервер не ответил, неизвестно даже, сколько книг подключено — это не значит, что книг нет."
                detail={sourcesError}
                action={{ label: 'Повторить запрос', onClick: () => void fetchSourcesData() }}
              />
            )}

            {/* Сервер ответил, но источников нет — тоже объяснимо */}
            {!sourcesLoading && !sourcesError && sources.length === 0 && sourcesLoadedOnce && (
              <EmptyState
                icon={Database}
                title="Сервер не назвал ни одной книги"
                description="Так бывает, когда доступ к Google Таблицам ещё не настроен: сервисный аккаунт создан, но книги ему не открыты."
                action={{ label: 'Перейти к подключению', onClick: () => setActiveTab('connection') }}
              />
            )}

            {sources.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-4 mb-4 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Книг: <strong className="text-zinc-700 dark:text-zinc-200">{sources.length}</strong></span>
                  <span>Читаются: <strong className="text-emerald-600 dark:text-emerald-400">{okSources}</strong></span>
                  {errorSources > 0 && (
                    <span>Не читаются: <strong className="text-red-600 dark:text-red-400">{errorSources}</strong></span>
                  )}
                  <span
                    title={rowsKnown.length < sources.length
                      ? 'Часть книг не сообщила число строк — они в сумму не вошли'
                      : undefined}
                  >
                    Строк прочитано: <strong className="text-zinc-700 dark:text-zinc-200 tabular-nums">{totalRows.toLocaleString('ru-RU')}</strong>
                    {rowsKnown.length < sources.length && (
                      <span className="text-zinc-400"> (по {rowsKnown.length} из {sources.length})</span>
                    )}
                  </span>
                  <button
                    onClick={handleValidateAll}
                    disabled={validatingAll}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/30 transition disabled:opacity-50 disabled:cursor-wait focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                  >
                    {validatingAll
                      ? <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                      : <CheckCircle2 size={11} aria-hidden="true" />}
                    Проверить данные во всех книгах
                  </button>
                  {lastRefreshed && <span className="ml-auto">Читались: {timeAgo(lastRefreshed)}</span>}
                  {sourcesLoading && <Loader2 size={12} className="animate-spin text-blue-500 ml-1" aria-label="Обновляем список" />}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sources.map(src => {
                    const cfg = STATUS_CONFIG[src.status] ?? STATUS_CONFIG.unknown;
                    const StatusIcon = cfg.icon;
                    const srcSaveFb = saveSourceFeedback[src.id];
                    const test = testResults[src.name];
                    const check = validationResults[src.name];
                    return (
                      <div key={src.id} className={clsx(
                        'rounded-xl border p-4 transition-all duration-200 hover:shadow-md',
                        src.status === 'error' ? 'border-red-200 dark:border-red-500/30 bg-red-50/30 dark:bg-red-500/5' :
                        src.status === 'warning' ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50/20 dark:bg-amber-500/5' :
                        'border-zinc-200 dark:border-zinc-700/50 hover:border-zinc-300 dark:hover:border-zinc-600'
                      )}>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{src.name}</h4>
                          <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0', cfg.bg, cfg.text)}>
                            <StatusIcon size={10} aria-hidden="true" /> {cfg.label}
                          </span>
                        </div>

                        {/* Причина состояния — отдельной строкой; текст движка
                            (он английский) остаётся мелким и в скобках */}
                        {src.statusDetail && (
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-2">
                            Причина: <span className="break-all">{src.statusDetail}</span>
                          </p>
                        )}

                        <div className="space-y-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          <div>
                            <div className="flex justify-between items-center gap-2">
                              <span>Идентификатор книги</span>
                              <button
                                onClick={() => {
                                  if (editingSource === src.id) {
                                    setEditingSource(null);
                                  } else {
                                    setEditingSource(src.id);
                                    setEditSourceValue(src.spreadsheetId ?? '');
                                  }
                                }}
                                className="text-[9px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-500"
                              >
                                {editingSource === src.id ? 'Отмена' : 'Изменить'}
                              </button>
                            </div>
                            {editingSource === src.id ? (
                              <div className="mt-1 flex gap-1">
                                <input
                                  type="text"
                                  value={editSourceValue}
                                  onChange={e => setEditSourceValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') void handleSaveSource(src.id, src.name, editSourceValue);
                                    if (e.key === 'Escape') setEditingSource(null);
                                  }}
                                  aria-label={`Идентификатор книги «${src.name}»`}
                                  className="flex-1 px-1.5 py-1 text-[10px] font-mono bg-white dark:bg-zinc-900/50 border border-blue-300 dark:border-blue-600 rounded text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  placeholder="Из адреса книги: docs.google.com/spreadsheets/d/ЭТО/edit"
                                  autoFocus
                                />
                                <button
                                  onClick={() => void handleSaveSource(src.id, src.name, editSourceValue)}
                                  disabled={srcSaveFb?.state === 'loading'}
                                  aria-label="Сохранить идентификатор книги"
                                  className="px-2 py-1 text-[10px] font-medium text-white bg-blue-600 rounded hover:bg-blue-700 active:bg-blue-800 transition disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500"
                                >
                                  {srcSaveFb?.state === 'loading'
                                    ? <Loader2 size={10} className="animate-spin" aria-hidden="true" />
                                    : <Save size={10} aria-hidden="true" />}
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <span className="font-mono text-zinc-600 dark:text-zinc-300 truncate block max-w-full" title={src.spreadsheetId ?? undefined}>
                                  {src.spreadsheetId ? shortId(src.spreadsheetId) : 'не задан'}
                                </span>
                                {srcSaveFb?.state === 'success' && (
                                  <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0" aria-label="Сохранено" />
                                )}
                              </div>
                            )}
                            {srcSaveFb?.state === 'error' && (
                              <p className="mt-1 text-[9px] text-red-600 dark:text-red-400" role="alert">{srcSaveFb.message}</p>
                            )}
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>Последнее чтение</span>
                            <span className="text-zinc-600 dark:text-zinc-300 text-right">
                              {src.lastReadAt
                                ? new Date(src.lastReadAt).toLocaleString('ru-RU')
                                : 'ещё не читалась'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>Строк</span>
                            <span className="font-medium text-zinc-700 dark:text-zinc-200 tabular-nums">
                              {src.rows !== null ? src.rows.toLocaleString('ru-RU') : 'сервер не сообщил'}
                            </span>
                          </div>
                        </div>

                        {/* Результат проверки связи */}
                        {test?.result && (
                          <div className={clsx('mt-2 px-2.5 py-1.5 rounded-lg text-[10px]',
                            test.result.success
                              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                              : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                          )}>
                            {test.result.success
                              ? `Книга открывается: «${test.result.title}», листов: ${test.result.sheetCount}`
                              : <>Книга не открылась — проверьте доступ сервисного аккаунта{engineDetail(test.result.error) && <span className="text-zinc-500 dark:text-zinc-400"> ({engineDetail(test.result.error)})</span>}</>}
                          </div>
                        )}

                        {/* Результат проверки данных */}
                        {check?.result && !check.result.error && (
                          <div className={clsx('mt-2 px-2.5 py-2 rounded-lg text-[10px] space-y-1',
                            (check.result.summary?.total ?? 0) === 0
                              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                          )}>
                            {(check.result.summary?.total ?? 0) === 0 ? (
                              <div className="flex items-center gap-1">
                                <CheckCircle2 size={10} aria-hidden="true" /> Замечаний не найдено
                                {check.result.rowsChecked > 0 && (
                                  <span className="text-zinc-400">· проверено строк: {check.result.rowsChecked}</span>
                                )}
                              </div>
                            ) : (
                              <>
                                <div className="font-medium">
                                  Замечаний: {check.result.summary.total}
                                  {check.result.resolvedSheetName && (
                                    <span className="font-normal text-zinc-400"> · лист «{check.result.resolvedSheetName}» · строк: {check.result.rowsChecked}</span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-3">
                                  {check.result.summary.critical > 0 && (
                                    <span className="text-red-600 dark:text-red-400">Критичных: {check.result.summary.critical}</span>
                                  )}
                                  {check.result.summary.warning > 0 && <span>Предупреждений: {check.result.summary.warning}</span>}
                                  {check.result.summary.info > 0 && <span className="text-zinc-400">Справочных: {check.result.summary.info}</span>}
                                </div>
                                {/* Первые замечания построчно — прозрачность вместо голого счётчика */}
                                <ul className="mt-1 space-y-0.5 text-zinc-500 dark:text-zinc-400">
                                  {(check.result.issues ?? []).slice(0, 6).map((iss: any, k: number) => (
                                    <li key={k}>стр. {iss.row}: {iss.message}</li>
                                  ))}
                                  {(check.result.issues?.length ?? 0) > 6 && (
                                    <li className="italic">… и ещё {check.result.issues.length - 6}</li>
                                  )}
                                </ul>
                              </>
                            )}
                          </div>
                        )}
                        {check?.result?.error && (
                          <p className="mt-2 px-2.5 py-1.5 rounded-lg text-[10px] bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" role="alert">
                            Данные проверить не удалось. {check.result.error}
                          </p>
                        )}

                        <div className="flex gap-2 mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-700/50">
                          <button
                            onClick={() => void handleTestSource(src.name)}
                            disabled={test?.loading}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition disabled:opacity-50 disabled:cursor-wait focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500"
                          >
                            {test?.loading
                              ? <><Loader2 size={10} className="animate-spin" aria-hidden="true" /> Проверяем…</>
                              : <><Wifi size={10} aria-hidden="true" /> Проверить связь</>}
                          </button>
                          <button
                            onClick={() => void handleValidateSource(src.name)}
                            disabled={check?.loading}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition disabled:opacity-50 disabled:cursor-wait focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-500"
                          >
                            {check?.loading
                              ? <><Loader2 size={10} className="animate-spin" aria-hidden="true" /> Проверяем…</>
                              : <><CheckCircle2 size={10} aria-hidden="true" /> Проверить данные</>}
                          </button>
                          {src.spreadsheetId && (
                            <a
                              href={`https://docs.google.com/spreadsheets/d/${src.spreadsheetId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Открыть книгу «${src.name}» в Google Таблицах (в новой вкладке)`}
                              className="flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-600/50 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500"
                            >
                              <ExternalLink size={10} aria-hidden="true" /> Открыть
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Вкладка «Соответствие ячеек» ──────────────────── */}
        {activeTab === 'mapping' && (
          <div role="tabpanel" id="settings-panel-mapping" aria-labelledby="settings-tab-mapping" tabIndex={-1}>
            <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                Каждый официальный показатель отчёта берётся из конкретной ячейки книги СВОД. Здесь видно, из какой именно,
                и сюда же вносится правка, если в книге показатель переехал.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  placeholder="Поиск по названию показателя"
                  value={mappingSearch}
                  onChange={e => setMappingSearch(e.target.value)}
                  aria-label="Поиск по названию показателя"
                  className="px-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
                />
                <button
                  onClick={() => void handleCheckCells()}
                  disabled={checkingCells || mapping.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                  title={mapping.length === 0 ? 'Список показателей пуст — проверять нечего' : undefined}
                >
                  {checkingCells
                    ? <Loader2 className="animate-spin" size={13} aria-hidden="true" />
                    : <CheckCircle2 size={13} aria-hidden="true" />}
                  Прочитать значения из книги
                </button>

                {/* Возврат к исходным адресам необратим — спрашиваем подтверждение
                    здесь же, а не системным окном браузера */}
                {resetArmed ? (
                  <span className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                    Вернуть все адреса к исходным?
                    <button
                      onClick={() => void handleResetMapping()}
                      className="px-2 py-1 font-medium text-white bg-amber-600 rounded hover:bg-amber-700 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-500"
                    >
                      Да, вернуть
                    </button>
                    <button
                      onClick={() => setResetArmed(false)}
                      className="px-2 py-1 font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 rounded hover:bg-zinc-200 dark:hover:bg-zinc-600 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500"
                    >
                      Отмена
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setResetArmed(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/30 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    Вернуть исходные адреса
                  </button>
                )}

                <div className="ml-auto text-xs text-zinc-400">
                  {mapping.length} {pluralRu(mapping.length, 'показатель', 'показателя', 'показателей')}
                  {mapping.filter(m => m.isOverridden).length > 0 && (
                    <span className="ml-2 text-amber-500">
                      {mapping.filter(m => m.isOverridden).length} переназначено вручную
                    </span>
                  )}
                </div>
              </div>
              {cellCheckError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
                  Значения из книги не прочитаны. {cellCheckError}
                </p>
              )}
            </div>

            {mappingLoading && mapping.length === 0 && (
              <div className="p-5" aria-busy="true">
                <span className="sr-only">Читаем список показателей</span>
                <SkeletonTable rows={8} />
              </div>
            )}

            {!mappingLoading && mappingError && (
              <EmptyState
                tone="problem"
                title="Список показателей не получен"
                description="Соответствие ячеек хранится на сервере: пока он не ответил, неизвестно, из каких ячеек читаются официальные числа."
                detail={mappingError}
                action={{ label: 'Повторить запрос', onClick: () => void fetchMapping() }}
              />
            )}

            {!mappingLoading && !mappingError && mapping.length === 0 && mappingLoadedOnce && (
              <EmptyState
                icon={MapIcon}
                title="Сервер не назвал ни одного показателя"
                description="Карта отчёта на сервере пуста. Это настройка расчёта, а не данных: своими силами со страницы её не заполнить — сообщите разработчику."
              />
            )}

            {mapping.length > 0 && (() => {
              const search = mappingSearch.trim().toLowerCase();
              const filtered = mapping.filter(m => !search || m.label.toLowerCase().includes(search));
              if (filtered.length === 0) {
                return (
                  <EmptyState
                    icon={Search}
                    title={`По запросу «${mappingSearch}» показателей нет`}
                    description={`Всего показателей: ${mapping.length}. Поиск идёт по названию целиком — попробуйте его часть, например «экономия» или «конкурентн».`}
                    action={{ label: 'Показать все', onClick: () => setMappingSearch('') }}
                  />
                );
              }
              const groups = [...new Set(filtered.map(m => m.group))];
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Показатели отчёта и ячейки книги СВОД, из которых они читаются
                    </caption>
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        <th scope="col" className="px-5 py-3 text-left">Показатель</th>
                        <th scope="col" className="px-4 py-3 text-left">Лист</th>
                        <th scope="col" className="px-4 py-3 text-left">Ячейка</th>
                        <th scope="col" className="px-4 py-3 text-right">Значение в книге</th>
                        <th scope="col" className="px-4 py-3 text-left w-40">Прочиталось</th>
                        <th scope="col" className="px-4 py-3 text-center w-24">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                      {groups.map(group => {
                        const items = filtered.filter(m => m.group === group);
                        return [
                          <tr key={`group-${group}`}>
                            <th
                              scope="colgroup"
                              colSpan={6}
                              className="px-5 py-2 bg-zinc-100/80 dark:bg-zinc-800/80 text-xs font-semibold text-left text-zinc-600 dark:text-zinc-300 uppercase tracking-wider"
                            >
                              {group} <span className="text-zinc-400 font-normal">({items.length})</span>
                            </th>
                          </tr>,
                          ...items.map(m => {
                            const isEditing = editingMetric === m.metricKey;
                            const readLabel =
                              m.readStatus === 'ok' ? 'значение есть' :
                              m.readStatus === 'empty' ? 'ячейка пуста' :
                              m.readStatus === 'error' ? 'книга не открылась' :
                              'ещё не читали';
                            const readColor =
                              m.readStatus === 'ok' ? 'text-emerald-600 dark:text-emerald-400' :
                              m.readStatus === 'empty' ? 'text-amber-600 dark:text-amber-400' :
                              m.readStatus === 'error' ? 'text-red-600 dark:text-red-400' :
                              'text-zinc-400 dark:text-zinc-500';
                            return (
                              <tr key={m.metricKey} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition">
                                <th scope="row" className="px-5 py-3 text-left font-medium text-zinc-700 dark:text-zinc-200">
                                  {m.label}
                                  {m.isOverridden && (
                                    <span
                                      className="ml-2 inline-block w-2 h-2 rounded-full bg-amber-400 align-middle"
                                      title="Адрес переназначен вручную — отличается от исходного"
                                      aria-label="Адрес переназначен вручную"
                                    />
                                  )}
                                  {/* Служебное имя показателя нужно разработчику при
                                      разборе расхождений. Читателю оно ничего не
                                      говорит, поэтому живёт мелкой подписью, а не
                                      отдельной колонкой наравне с данными. */}
                                  <span className="block text-[10px] font-mono font-normal text-zinc-400 dark:text-zinc-500">
                                    служебное имя: {m.metricKey}
                                  </span>
                                </th>
                                <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">{m.sheet || '—'}</td>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        value={editValue}
                                        onChange={e => { setEditValue(e.target.value); setEditError(null); }}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') void saveCellRef(m.metricKey, editValue);
                                          if (e.key === 'Escape') { setEditingMetric(null); setEditError(null); }
                                        }}
                                        aria-label={`Адрес ячейки для показателя «${m.label}»`}
                                        placeholder="D14"
                                        className="px-2 py-1 text-xs border border-blue-300 dark:border-blue-600 rounded bg-white dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono w-24"
                                        autoFocus
                                      />
                                      <button
                                        onClick={() => void saveCellRef(m.metricKey, editValue)}
                                        aria-label="Сохранить адрес ячейки"
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-500"
                                      >
                                        Сохранить
                                      </button>
                                      <button
                                        onClick={() => { setEditingMetric(null); setEditError(null); }}
                                        aria-label="Отменить правку адреса"
                                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-500"
                                      >
                                        Отмена
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">{m.cell || '—'}</span>
                                  )}
                                  {isEditing && editError && (
                                    <p className="mt-1 text-[10px] text-red-600 dark:text-red-400" role="alert">{editError}</p>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                                  {m.currentValue !== null
                                    ? typeof m.currentValue === 'number'
                                      ? m.currentValue.toLocaleString('ru-RU')
                                      : String(m.currentValue)
                                    : <span className="text-xs text-zinc-400 dark:text-zinc-500">не читали</span>}
                                </td>
                                <td className={clsx('px-4 py-3 text-xs', readColor)}>
                                  <span className="inline-flex items-center gap-1">
                                    {m.readStatus === 'ok' && <CheckCircle2 size={13} aria-hidden="true" />}
                                    {m.readStatus === 'error' && <AlertTriangle size={13} aria-hidden="true" />}
                                    {readLabel}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <button
                                    onClick={() => { setEditingMetric(m.metricKey); setEditValue(m.cell); setEditError(null); }}
                                    aria-label={`Изменить адрес ячейки для показателя «${m.label}»`}
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-500"
                                  >
                                    Изменить
                                  </button>
                                </td>
                              </tr>
                            );
                          }),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Вкладка «Подключение» ─────────────────────────── */}
        {activeTab === 'connection' && (
          <div className="p-5 space-y-6" role="tabpanel" id="settings-panel-connection" aria-labelledby="settings-tab-connection" tabIndex={-1}>
            {/* Состояние сервера */}
            {serverStatus === null ? (
              // Заглушка держит форму будущей плашки состояния, поэтому при
              // ответе сервера текст ниже не подпрыгивает. Слова «Загрузка»
              // здесь нет намеренно: она ничего не обещает и не резервирует
              // места под то, что появится.
              <div aria-busy="true">
                <span className="sr-only">Спрашиваем сервер о его состоянии</span>
                <SkeletonStatusPanel />
              </div>
            ) : (
              <div className={clsx(
                'flex items-start gap-3 p-4 rounded-xl border transition-all',
                serverStatus.online && serverStatus.configured
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                  : serverStatus.online
                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                    : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700'
              )}>
                {serverStatus.online
                  ? <Wifi size={18} className={clsx('mt-0.5', serverStatus.configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')} aria-hidden="true" />
                  : <WifiOff size={18} className="mt-0.5 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />}
                <div className="flex-1 min-w-0">
                  {/* «Настроен» на сервере = почта сервисного аккаунта + закрытый
                      ключ + идентификатор книги (routes/settings.ts). Поэтому
                      подпись говорит именно про доступ к Google Таблицам. */}
                  <p className={clsx('text-sm font-medium',
                    serverStatus.online && serverStatus.configured ? 'text-emerald-800 dark:text-emerald-300'
                      : serverStatus.online ? 'text-amber-800 dark:text-amber-300'
                        : 'text-zinc-600 dark:text-zinc-300')}>
                    {serverStatus.online && serverStatus.configured
                      ? 'Сервер работает, доступ к Google Таблицам настроен'
                      : serverStatus.online
                        ? 'Сервер работает, но доступ к Google Таблицам настроен не полностью'
                        : 'Сервер не отвечает — числа на экране показать неоткуда'}
                  </p>
                  {serverStatus.email && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 break-all">
                      Сервисный аккаунт: {serverStatus.email}
                    </p>
                  )}
                  {serverStatus.online && !serverStatus.configured && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      Заполните форму ниже: без почты сервисного аккаунта, закрытого ключа и идентификатора книги приложение читать таблицы не сможет.
                    </p>
                  )}
                  {!serverStatus.online && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Запустите сервер командой{' '}
                      <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded text-zinc-800 dark:text-zinc-200">pnpm --filter @aemr/server dev</code>
                      {' '}и обновите страницу.
                    </p>
                  )}
                </div>
                <div className="text-right text-[10px] text-zinc-400 dark:text-zinc-500 space-y-0.5 flex-shrink-0">
                  {lastRefreshed && <div>Книги читались: {timeAgo(lastRefreshed)}</div>}
                  <div>Состояние обновляется каждые 30 секунд</div>
                </div>
              </div>
            )}

            {/* Результат проверки доступа */}
            {sheetsTestFeedback.state !== 'idle' && (
              <div
                role={sheetsTestFeedback.state === 'error' ? 'alert' : undefined}
                aria-live="polite"
                className={clsx(
                  'flex items-start gap-2 p-3 rounded-lg border',
                  sheetsTestFeedback.state === 'loading' ? 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700' :
                  sheetsTestFeedback.state === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' :
                  'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
                )}
              >
                {sheetsTestFeedback.state === 'loading' ? <Loader2 size={16} className="text-blue-500 animate-spin mt-0.5" aria-hidden="true" />
                  : sheetsTestFeedback.state === 'success' ? <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 mt-0.5" aria-hidden="true" />
                    : <AlertTriangle size={16} className="text-red-600 dark:text-red-400 mt-0.5" aria-hidden="true" />}
                <span className={clsx('text-xs font-medium',
                  sheetsTestFeedback.state === 'loading' ? 'text-zinc-600 dark:text-zinc-300' :
                  sheetsTestFeedback.state === 'success' ? 'text-emerald-700 dark:text-emerald-300' :
                  'text-red-700 dark:text-red-300'
                )}>
                  {sheetsTestFeedback.message}
                </span>
              </div>
            )}

            {/* Пошаговая инструкция */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-2 mb-3">
                <HelpCircle size={16} aria-hidden="true" />
                Как выдать приложению доступ к Google Таблицам
              </h3>
              <p className="text-xs text-blue-700 dark:text-blue-400 mb-3">
                Приложение читает таблицы не от вашего имени, а от имени служебной учётной записи Google — «сервисного аккаунта».
                Названия пунктов в консоли Google даны в кавычках так, как они там написаны.
              </p>
              <ol className="space-y-2.5 text-xs text-blue-700 dark:text-blue-400">
                {[
                  <>Откройте консоль Google Cloud — адрес console.cloud.google.com — под учётной записью, у которой есть доступ к нужным таблицам.</>,
                  <>Создайте проект или выберите существующий. Имя произвольное, например <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">aemr-analytics</code>.</>,
                  <>Включите доступ к API Таблиц: раздел «APIs &amp; Services» → «Library» → найдите «Google Sheets API» → «Enable».</>,
                  <>Создайте служебную учётную запись: «IAM &amp; Admin» → «Service Accounts» → «Create Service Account». Имя — например <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">aemr-reader</code>.</>,
                  <>Выпустите для неё ключ: откройте созданную запись → «Keys» → «Add Key» → «Create new key» → формат JSON. Браузер скачает файл — храните его как пароль.</>,
                  <>Из скачанного файла возьмите два поля: <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">client_email</code> — это почта сервисного аккаунта, и <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">private_key</code> — это закрытый ключ.</>,
                  <>Откройте каждую книгу в Google Таблицах и дайте этой почте доступ на чтение (право «Читатель»). Без этого шага ключ бесполезен: аккаунт есть, а книг он не видит.</>,
                  <>Заполните форму ниже и сохраните файл .env в корень проекта, затем перезапустите сервер.</>,
                ].map((text, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center text-[10px] font-bold" aria-hidden="true">{i + 1}</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Форма подключения */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Параметры подключения</h3>

              <div>
                <label htmlFor="conn-spreadsheet" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                  Идентификатор книги СВОД
                </label>
                <input
                  id="conn-spreadsheet"
                  type="text"
                  value={connForm.spreadsheetId}
                  onChange={e => setConnForm(f => ({ ...f, spreadsheetId: e.target.value }))}
                  placeholder={SVOD_SPREADSHEET_ID}
                  className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">
                  Берётся из адреса книги: docs.google.com/spreadsheets/d/<strong>вот эта часть</strong>/edit
                </p>
              </div>

              <div>
                <label htmlFor="conn-email" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                  Почта сервисного аккаунта
                </label>
                <input
                  id="conn-email"
                  type="email"
                  value={connForm.serviceAccountEmail}
                  onChange={e => setConnForm(f => ({ ...f, serviceAccountEmail: e.target.value }))}
                  placeholder="aemr-reader@имя-проекта.iam.gserviceaccount.com"
                  className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">
                  Поле <code>client_email</code> из скачанного файла ключа
                </p>
              </div>

              <div>
                <label htmlFor="conn-key" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                  Закрытый ключ сервисного аккаунта
                </label>
                <div className="relative">
                  {/* Поле ВСЕГДА закрыто: текст прозрачный, курсор невидим.
                      Целиком ключ не показывается ни при каком переключателе —
                      по требованию к странице. Обратная связь о вводе даётся
                      числом символов, а по кнопке — началом и концом. */}
                  <textarea
                    id="conn-key"
                    value={connForm.privateKey}
                    onChange={e => setConnForm(f => ({ ...f, privateKey: e.target.value }))}
                    placeholder={'-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----'}
                    rows={4}
                    aria-describedby="conn-key-hint"
                    className={clsx(
                      'w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none transition',
                      connForm.privateKey && 'text-transparent selection:text-transparent'
                    )}
                    style={connForm.privateKey ? { caretColor: 'transparent' } : undefined}
                  />
                  {connForm.privateKey && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-10">
                      <span className="text-xs text-zinc-400 text-center">
                        {keyIsPlaceholder
                          ? 'Ключ уже сохранён на сервере — прочитать его обратно нельзя'
                          : `Ключ скрыт · символов: ${connForm.privateKey.length.toLocaleString('ru-RU')}`}
                      </span>
                    </div>
                  )}
                  {!!connForm.privateKey && !keyIsPlaceholder && (
                    <button
                      onClick={() => setShowKeyFragment(v => !v)}
                      aria-label={showKeyFragment ? 'Скрыть фрагмент ключа' : 'Показать начало и конец ключа'}
                      title={showKeyFragment ? 'Скрыть фрагмент ключа' : 'Показать начало и конец ключа'}
                      className="absolute top-2 right-2 p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                    >
                      {showKeyFragment ? <EyeOff size={14} className="text-zinc-400" aria-hidden="true" /> : <Eye size={14} className="text-zinc-400" aria-hidden="true" />}
                    </button>
                  )}
                </div>

                {showKeyFragment && !!connForm.privateKey && !keyIsPlaceholder && (
                  <p className="mt-1 text-[10px] font-mono text-zinc-500 dark:text-zinc-400 break-all">
                    {maskSecret(connForm.privateKey)}
                  </p>
                )}

                <p id="conn-key-hint" className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">
                  Поле <code>private_key</code> из файла ключа — вставьте целиком, вместе со строками BEGIN и END.
                  Целиком на экране ключ не показывается: видно только его длину и, по кнопке, начало с концом.
                </p>

                {keyLooksTruncated && (
                  <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                    Похоже, вставлен не весь ключ: обычно он начинается со строки «-----BEGIN PRIVATE KEY-----».
                  </p>
                )}
                {keyIsPlaceholder && (
                  <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                    Чтобы перезаписать .env, вставьте ключ заново — сохранить эту отметку вместо ключа нельзя,
                    иначе рабочий ключ в файле будет затёрт.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="conn-port" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Порт сервера</label>
                  <input
                    id="conn-port"
                    type="text"
                    inputMode="numeric"
                    value={connForm.port}
                    onChange={e => setConnForm(f => ({ ...f, port: e.target.value }))}
                    className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                  />
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">На каком порте сервер принимает запросы</p>
                </div>
                <div>
                  <label htmlFor="conn-host" className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Сетевой адрес сервера</label>
                  <input
                    id="conn-host"
                    type="text"
                    value={connForm.host}
                    onChange={e => setConnForm(f => ({ ...f, host: e.target.value }))}
                    className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                  />
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">
                    0.0.0.0 — принимать подключения со всех адресов, 127.0.0.1 — только с этой машины
                  </p>
                </div>
              </div>

              {saveEnvFeedback.state !== 'idle' && (
                <div
                  role={saveEnvFeedback.state === 'error' ? 'alert' : undefined}
                  aria-live="polite"
                  className={clsx(
                    'flex items-start gap-2 p-3 rounded-lg border',
                    saveEnvFeedback.state === 'loading' ? 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700' :
                    saveEnvFeedback.state === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' :
                    'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
                  )}
                >
                  {saveEnvFeedback.state === 'loading' ? <Loader2 size={16} className="text-blue-500 animate-spin mt-0.5" aria-hidden="true" />
                    : saveEnvFeedback.state === 'success' ? <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 mt-0.5" aria-hidden="true" />
                      : <AlertTriangle size={16} className="text-red-600 dark:text-red-400 mt-0.5" aria-hidden="true" />}
                  <span className={clsx('text-xs font-medium',
                    saveEnvFeedback.state === 'loading' ? 'text-zinc-600 dark:text-zinc-300' :
                    saveEnvFeedback.state === 'success' ? 'text-emerald-700 dark:text-emerald-300' :
                    'text-red-700 dark:text-red-300'
                  )}>
                    {saveEnvFeedback.message}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={() => void handleSaveEnv()}
                  disabled={!canSaveEnv || saveEnvFeedback.state === 'loading'}
                  title={!canSaveEnv ? 'Нужны почта сервисного аккаунта и закрытый ключ' : undefined}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
                    saveEnvFeedback.state === 'loading'
                      ? 'text-blue-400 bg-blue-200 dark:bg-blue-900/40 cursor-wait'
                      : 'text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed'
                  )}
                >
                  {saveEnvFeedback.state === 'loading'
                    ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Сохраняем…</>
                    : <><Save size={14} aria-hidden="true" /> Сохранить .env на сервере</>}
                </button>
                <button
                  onClick={() => void handleCopyEnv()}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                >
                  <Copy size={14} aria-hidden="true" /> Скопировать текст .env
                </button>
                <button
                  onClick={handleDownloadEnv}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                >
                  <Download size={14} aria-hidden="true" /> Скачать файл .env
                </button>
                <button
                  onClick={() => void handleTestSheetsConnection()}
                  disabled={sheetsTestFeedback.state === 'loading'}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
                    sheetsTestFeedback.state === 'loading'
                      ? 'text-zinc-400 bg-zinc-200 dark:bg-zinc-700 cursor-wait'
                      : 'text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                  )}
                >
                  {sheetsTestFeedback.state === 'loading'
                    ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Проверяем…</>
                    : <><Wifi size={14} aria-hidden="true" /> Проверить доступ</>}
                </button>
              </div>

              {/* Честная оговорка: запись .env с сервера разрешена только на
                  машине разработчика — иначе кнопка выше вернёт отказ 403. */}
              <p className="flex items-start gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                <Info size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span>
                  Запись .env с этой страницы работает только на машине разработчика: рабочий сервер её запрещает,
                  чтобы настройки нельзя было подменить из браузера. В остальных случаях скопируйте текст и положите файл вручную.
                </span>
              </p>
            </div>

            {/* Как будет выглядеть файл */}
            <div>
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Как будет выглядеть файл .env</h3>
              <pre className="bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 text-xs p-4 rounded-xl overflow-x-auto font-mono leading-relaxed border border-zinc-200 dark:border-zinc-700">
{`# Google Таблицы
GOOGLE_SHEETS_SPREADSHEET_ID=${connForm.spreadsheetId}
GOOGLE_SERVICE_ACCOUNT_EMAIL=${connForm.serviceAccountEmail || '<почта сервисного аккаунта>'}
GOOGLE_PRIVATE_KEY="${connForm.privateKey && !keyIsPlaceholder ? '-----BEGIN PRIVATE KEY-----\\n…\\n-----END PRIVATE KEY-----' : '<закрытый ключ из файла>'}"

# Сервер
PORT=${connForm.port}
HOST=${connForm.host}
LOG_LEVEL=info

# База данных (SQLite для разработки)
SQLITE_PATH=./data/aemr.db
# DB_PROVIDER=postgresql          # для рабочего контура
# DATABASE_URL=postgresql://...   # для рабочего контура`}
              </pre>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-2">
                Здесь ключ показан заглушкой. В скачанном и сохранённом файле он настоящий — этот файл нельзя пересылать и класть в репозиторий.
              </p>
            </div>

            {/* Запуск */}
            <div className="bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-700/50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">Запуск после настройки .env</h3>
              <ol className="space-y-3">
                {[
                  { cmd: 'pnpm --filter @aemr/shared build && pnpm --filter @aemr/core build', note: 'Сборка общих пакетов — нужна один раз' },
                  { cmd: 'pnpm --filter @aemr/server dev', note: `Запустить сервер (первое окно терминала) — он поднимется на порте ${connForm.port}` },
                  { cmd: 'pnpm --filter @aemr/web dev', note: 'Запустить интерфейс (второе окно терминала) — адрес появится в терминале' },
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-300 dark:bg-zinc-600 text-zinc-800 dark:text-zinc-200 flex items-center justify-center text-xs font-bold" aria-hidden="true">{i + 1}</span>
                    <div>
                      <code className="text-xs text-zinc-800 dark:text-zinc-200 bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded font-mono inline-block break-all">{step.cmd}</code>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">{step.note}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
