import dotenv from 'dotenv';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { z } from 'zod';
import type { AppConfig } from '@aemr/shared';
import { DEPARTMENT_SPREADSHEET_IDS, SVOD_SPREADSHEET_ID as SHARED_SVOD_ID } from '@aemr/shared';

// Load .env from monorepo root (2 levels up from packages/server/)
const rootEnv = resolve(process.cwd(), '.env');
const monoRootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
} else if (existsSync(monoRootEnv)) {
  dotenv.config({ path: monoRootEnv });
} else {
  dotenv.config();
}

// ---------------------------------------------------------------------------
// Zod schema for environment variables
// ---------------------------------------------------------------------------
const envSchema = z.object({
  // Google Sheets
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),

  // Server
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  /**
   * Кто вправе обращаться к API из браузера — список адресов через запятую
   * (`https://dash-elizovo-uer.ru,https://stage.example`).
   *
   * Реестр багов 09.07.2026, п.15: список был вписан в код двумя адресами
   * локальной разработки, и на боевом сервере, где продукт открывают по
   * доменному имени, разрешения не существовало вовсе. Не задано — остаются
   * прежние адреса разработки, так что локальный запуск ничего не требует.
   */
  AEMR_CORS_ORIGINS: z.string().optional(),

  // Cache
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),
  SOURCE_AUTO_REFRESH_MINUTES: z.coerce.number().int().nonnegative().default(15),
  SOURCE_FRESHNESS_SECONDS: z.coerce.number().int().nonnegative().default(300),

  // Database
  SQLITE_PATH: z.string().default('./data/aemr.db'),
  DATABASE_URL: z.string().optional(),
  DB_PROVIDER: z.enum(['sqlite', 'postgresql']).default('sqlite'),

  // Auth
  AEMR_API_KEY: z.string().optional(),
  /** Публичный HTTPS-адрес продукта (https://dash-elizovo-uer.ru) — включает push-каналы Drive. */
  WEBHOOK_PUBLIC_URL: z.string().optional(),
  /** Секрет каналов Drive: кладётся в token при регистрации, сверяется на каждом уведомлении. */
  WEBHOOK_SECRET: z.string().optional(),

  // Четверг-cron еженедельного снимка
  NODE_ENV: z.string().optional(),
  /** Календарь продукта: смещение от UTC в часах (Камчатка = +12, DST нет). */
  PRODUCT_TZ_OFFSET_HOURS: z.coerce.number().int().min(-12).max(14).default(12),
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  console.error('Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}
const env = parsedEnv.data;

// ---------------------------------------------------------------------------

export const DEFAULT_DEPARTMENT_SPREADSHEETS = { ...DEPARTMENT_SPREADSHEET_IDS };

/** Адреса разработки — то, что было вписано в код до перевода списка в окружение. */
export const DEV_CORS_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'] as const;

/**
 * Разбирает список разрешённых адресов из переменной окружения.
 *
 * Пустая строка или одни разделители — это «ничего не задали», а не «запретить
 * всё»: молча оставить продукт без единого разрешённого адреса значит выключить
 * веб одним лишним пробелом в конфигурации.
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  const listed = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return listed.length > 0 ? listed : [...DEV_CORS_ORIGINS];
}

const GOOGLE_SPREADSHEET_ID_RE = /^[A-Za-z0-9_-]{20,}$/;
const DEMO_SPREADSHEET_ID_RE = /^demo-/i;

export type SpreadsheetIdValidationResult =
  | { success: true; spreadsheetId: string }
  | { success: false; error: string };

export function validateSpreadsheetIdForSourceChange(value: unknown): SpreadsheetIdValidationResult {
  if (typeof value !== 'string') {
    return { success: false, error: 'spreadsheetId must be a string' };
  }

  const spreadsheetId = value.trim();
  if (!spreadsheetId) {
    return { success: false, error: 'spreadsheetId is required' };
  }

  if (spreadsheetId.includes('/') || spreadsheetId.includes('.') || spreadsheetId.includes('\\')) {
    return { success: false, error: 'spreadsheetId must be a raw Google Sheets ID, not a URL or file name' };
  }

  if (DEMO_SPREADSHEET_ID_RE.test(spreadsheetId)) {
    return { success: false, error: 'demo spreadsheet IDs cannot be used as production sources' };
  }

  if (!GOOGLE_SPREADSHEET_ID_RE.test(spreadsheetId)) {
    return { success: false, error: 'spreadsheetId has invalid Google Sheets ID format' };
  }

  return { success: true, spreadsheetId };
}

/**
 * СВОД_для_Google — единственная основная таблица.
 * Содержит листы: СВОД ТД-ПМ, ШДЮ, УЭР, УИО, УАГЗО, УФБП, УД, УДТХ, УКСиМП, УО.
 * Отдельные книги управлений читаются через DEPARTMENT_SPREADSHEETS; агрегирующий лист
 * подведомственных называется "ВСЕ".
 * ID определён в @aemr/shared/constants — единый источник истины.
 */
export const SVOD_SPREADSHEET_ID = SHARED_SVOD_ID;
/** ШДЮ — лист внутри основной таблицы СВОД_для_Google */
export const SHDYU_SPREADSHEET_ID = SVOD_SPREADSHEET_ID;

// Load overrides from data/sources.json if it exists
const SOURCES_CONFIG_PATH = resolve(process.cwd(), 'data', 'sources.json');

function loadSourceOverrides(): Record<string, string> {
  try {
    if (existsSync(SOURCES_CONFIG_PATH)) {
      return JSON.parse(readFileSync(SOURCES_CONFIG_PATH, 'utf-8'));
    }
  } catch { /* ignore corrupt file */ }
  return {};
}

/** Mutable department spreadsheet IDs (defaults + overrides) */
export const DEPARTMENT_SPREADSHEETS: Record<string, string> = {
  ...DEFAULT_DEPARTMENT_SPREADSHEETS,
  ...loadSourceOverrides(),
};

/** Save a spreadsheet ID override and update the live config */
export function updateSpreadsheetId(name: string, spreadsheetId: string): void {
  DEPARTMENT_SPREADSHEETS[name] = spreadsheetId;
  const overrides = loadSourceOverrides();
  overrides[name] = spreadsheetId;
  try {
    const dir = resolve(process.cwd(), 'data');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SOURCES_CONFIG_PATH, JSON.stringify(overrides, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Демо-режим: НЕ настроен ни один способ доступа к Google (ни служебная
 * учётка, ни API-ключ). Только в этом режиме продукту разрешено подменять
 * данные сгенерированным демо-снимком. При настроенных кредах любая ошибка
 * источника отдаётся честно (последний сохранённый снимок либо 503), а не
 * сочинёнными числами по реальным ГРБС — класс КЦЕ-прецедента 14.08.
 */
export const isDemoMode: boolean =
  !(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY) && !env.GOOGLE_API_KEY;

export const config: AppConfig = {
  google: {
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID ?? SVOD_SPREADSHEET_ID,
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    apiKey: env.GOOGLE_API_KEY,
  },
  server: {
    port: env.PORT,
    host: env.HOST,
    logLevel: env.LOG_LEVEL,
    corsOrigins: parseCorsOrigins(env.AEMR_CORS_ORIGINS),
  },
  cache: {
    ttlSeconds: env.CACHE_TTL_SECONDS,
    /**
     * Как часто сервер сам перечитывает источники (канон п.66 «прямой эфир»).
     * 0 отключает автообновление. Дефолт — 15 минут: книги правят руками весь
     * рабочий день, а девять книг стоят десятки запросов, что укладывается в
     * квоты Sheets API с большим запасом.
     */
    autoRefreshMinutes: env.SOURCE_AUTO_REFRESH_MINUTES,
    /**
     * Предельный возраст кэша книг ГРБС, при котором его ещё можно смешивать
     * со свежим чтением официальных ячеек. Старше — источники перечитываются
     * ЦЕЛИКОМ перед сборкой снимка: сверка обязана сравнивать один момент
     * времени, иначе появляются фиктивные расхождения (прецедент 14.08:
     * УКСиМП −181,9 и УО −313,6 — обе стороны были правы, разошлись моменты).
     */
    sourceFreshnessSeconds: env.SOURCE_FRESHNESS_SECONDS,
  },
  webhook: {
    publicUrl: env.WEBHOOK_PUBLIC_URL,
    secret: env.WEBHOOK_SECRET,
  },
  database: {
    url: env.SQLITE_PATH,
    postgresUrl: env.DATABASE_URL,
    provider: env.DB_PROVIDER,
  },
  auth: {
    apiKey: env.AEMR_API_KEY,
  },
  weeklySnapshot: {
    // В тестах планировщик не стартует: тик дёргает полный пайплайн и БД.
    enabled: env.NODE_ENV !== 'test',
    utcOffsetHours: env.PRODUCT_TZ_OFFSET_HOURS,
  },
};
