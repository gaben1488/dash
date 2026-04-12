import dotenv from 'dotenv';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { z } from 'zod';
import type { AppConfig } from '@aemr/shared';
import { SVOD_SPREADSHEET_ID as SHARED_SVOD_ID } from '@aemr/shared';

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

  // Cache
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),

  // Database
  SQLITE_PATH: z.string().default('./data/aemr.db'),
  DATABASE_URL: z.string().optional(),
  DB_PROVIDER: z.enum(['sqlite', 'postgresql']).default('sqlite'),

  // Auth
  AEMR_API_KEY: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  console.error('Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}
const env = parsedEnv.data;

// ---------------------------------------------------------------------------

const DEFAULT_DEPARTMENT_SPREADSHEETS: Record<string, string> = {
  'УЭР': '15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4',
  'УИО': '1qCBY5EDSASxK6_ZPQbxzdF8cKIjcwcuykbnOc45Ukn8',
  'УАГЗО': '1DgO0t_Zx-PXmtLBp5ddkQvb2_pTkmyFKP_PaDqjOyXk',
  'УФБП': '14A7vvvvPFxY3SKwtYnMsNfmn_kkxbxWSkN78cYBfszQ',
  'УД': '1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg',
  'УДТХ': '1bxh-mRLQ_ODsdpZ4JW2JJ8sOMjg4zJRhPydR6vjzqb4',
  'УКСиМП': '1aFAw9AfNxkTVCqwp6G6fchn3ZeDi8FwFu5-xgRSo7aI',
  'УО': '1AGvXDSKSjpPc11ce4NDK262qySM4W6nFTq2YcgQ6Sds',
};

/**
 * СВОД_для_Google — единственная основная таблица.
 * Содержит листы: СВОД ТД-ПМ, ШДЮ, Все (УЭР/УИО/УД/УКСиМП/УО), УАГЗО, УФБП, УДТХ
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
  },
  cache: {
    ttlSeconds: env.CACHE_TTL_SECONDS,
  },
  database: {
    url: env.SQLITE_PATH,
    postgresUrl: env.DATABASE_URL,
    provider: env.DB_PROVIDER,
  },
  auth: {
    apiKey: env.AEMR_API_KEY,
  },
};
