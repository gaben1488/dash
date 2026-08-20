/**
 * Логика страницы «Система» без единого элемента разметки.
 *
 * REFACTOR_BACKLOG_2026-06-15 §G (разрез файлов-гигантов) и инвентарь долга
 * 18.08.2026, раздел «б» п. 6: `Settings.tsx` дорос до 2032 строк, из которых
 * первые четыре сотни — чистые правила, не знающие ни о React, ни о вёрстке:
 * разбор ответов сервера, маскирование ключей, сборка списка диагностики.
 * Они и вынесены сюда. Разметка осталась в `Settings.tsx`, поведение не
 * менялось ни в одной строке — перенос дословный.
 *
 * Почему именно этот шов: у правил уже был отдельный набор проверок
 * (`Settings.logic.test.ts`), который импортировал их из страницы целиком,
 * поднимая ради трёх функций весь React-компонент. Теперь набор проверяет
 * свой модуль, а страница остаётся его единственным потребителем в коде.
 */
import { pluralRu } from '../lib/economy-copy';

export type SourceStatus = 'ok' | 'warning' | 'error' | 'unknown';

export interface SheetSource {
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

export interface MappingEntry {
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

export type FeedbackState = 'idle' | 'loading' | 'success' | 'error';

export interface Feedback {
  state: FeedbackState;
  message?: string;
}

export type TabId = 'sources' | 'mapping' | 'connection';

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
export const KEY_ON_SERVER = '(ключ уже сохранён на сервере)';

/**
 * Сколько времени прошло — русской фразой.
 *
 * Момент «сейчас» передаётся снаружи, чтобы диагностику можно было проверить
 * тестом: иначе выражение зависит от часов машины и проверяемо только на глаз.
 */
export function timeAgo(dateStr: string | null, now: number = Date.now()): string {
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
export function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 14)}…` : id;
}

/**
 * Паспорт самообновления источников (директива «Система — паспорт данных»):
 * рабочее окно опроса, интервал самообновления, статус канала уведомлений.
 */
export interface RefreshPassport {
  workWindowLabel: string;
  withinWorkWindow: boolean;
  autoRefreshMinutes: number;
  webhookConfigured: boolean;
}

/** Ответ /api/sources → паспорт; старый сервер без поля refresh даёт null, а не выдумку. */
export function parseRefreshPassport(data: unknown): RefreshPassport | null {
  const r = (data as { refresh?: unknown } | null)?.refresh;
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  return {
    workWindowLabel: typeof o.workWindowLabel === 'string' ? o.workWindowLabel : '8:45–18:20 по Камчатке',
    withinWorkWindow: Boolean(o.withinWorkWindow),
    autoRefreshMinutes: typeof o.autoRefreshMinutes === 'number' ? o.autoRefreshMinutes : 0,
    webhookConfigured: Boolean(o.webhookConfigured),
  };
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
export function engineDetail(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : String(raw ?? '');
  return text.trim();
}
