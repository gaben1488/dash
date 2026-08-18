/**
 * Регистрация push-каналов Google Drive на книги-источники (канон п.66).
 *
 * Drive умеет присылать POST на наш HTTPS-адрес при каждом изменении файла —
 * это заменяет опрос: правка в книге доезжает до продукта за секунды. Канал
 * живёт ограниченное время (Drive сам закрывает по expiration), поэтому
 * сервис перерегистрирует каналы по расписанию — раз в 20 часов при суточном
 * сроке жизни.
 *
 * Требования, без которых push не включится (проверяются на старте):
 *  - WEBHOOK_PUBLIC_URL — публичный HTTPS-адрес (https://dash-elizovo-uer.ru);
 *  - WEBHOOK_SECRET — секрет канала;
 *  - у сервисного аккаунта включён Drive API и есть доступ на чтение книг
 *    (scope https://www.googleapis.com/auth/drive.readonly — добавляется к
 *    существующему spreadsheets.readonly).
 * Любой отказ — предупреждение в лог и работа продолжается на опросе:
 * push — ускорение, а не единственный путь.
 */
import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { config, SHDYU_SPREADSHEET_ID } from '../config.js';
import { DEPARTMENT_SPREADSHEET_IDS } from '@aemr/shared';
// Мониторинговая книга (п.69в) — тоже под наблюдением. Идентификатор живёт
// у сервиса чтения книги: два разных значения одной константы означали бы,
// что вебхук следит не за той книгой, которую читает вкладка.
import { MONITORING_SPREADSHEET_ID } from './monitoring.js';

/** Все файлы, за которыми следим: 8 книг ГРБС + сводная + ШДЮ + мониторинг. */
export function watchedFileIds(): string[] {
  const ids = new Set<string>(Object.values(DEPARTMENT_SPREADSHEET_IDS));
  ids.add(config.google.spreadsheetId);
  if (SHDYU_SPREADSHEET_ID) ids.add(SHDYU_SPREADSHEET_ID);
  ids.add(MONITORING_SPREADSHEET_ID);
  return [...ids].filter(Boolean);
}

/** Срок жизни канала. Сутки — верхний предел Drive для files.watch. */
const CHANNEL_TTL_MS = 24 * 60 * 60 * 1000;
/** Перерегистрация с запасом до истечения. */
const RENEW_EVERY_MS = 20 * 60 * 60 * 1000;

let renewTimer: ReturnType<typeof setInterval> | null = null;

async function driveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: config.google.serviceAccountEmail,
      private_key: config.google.privateKey,
    },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
  return google.drive({ version: 'v3', auth });
}

async function registerChannels(log: { info: (m: string) => void; warn: (m: string) => void }): Promise<void> {
  const { publicUrl, secret } = config.webhook;
  if (!publicUrl || !secret) return;
  const address = `${publicUrl.replace(/\/$/, '')}/api/webhook/drive`;
  const drive = await driveClient();
  let ok = 0;
  for (const fileId of watchedFileIds()) {
    try {
      await drive.files.watch({
        fileId,
        requestBody: {
          id: randomUUID(),
          type: 'web_hook',
          address,
          token: secret,
          expiration: String(Date.now() + CHANNEL_TTL_MS),
        },
      });
      ok += 1;
    } catch (err) {
      log.warn(`Push-канал на файл ${fileId.slice(0, 8)}… не создан: ${(err as Error).message}`);
    }
  }
  log.info(`Push-каналы Drive: создано ${ok} из ${watchedFileIds().length} (адрес ${address})`);
}

/**
 * Включить push-режим: первичная регистрация + перерегистрация по расписанию.
 * Без publicUrl/secret молчаливо не делает ничего — работает опрос.
 */
export function startDriveWatch(log: { info: (m: string) => void; warn: (m: string) => void }): void {
  const { publicUrl, secret } = config.webhook;
  if (!publicUrl || !secret) {
    log.info('Push-каналы Drive выключены (нет WEBHOOK_PUBLIC_URL/WEBHOOK_SECRET) — работает периодический опрос');
    return;
  }
  if (!publicUrl.startsWith('https://')) {
    log.warn(`Push-каналы Drive не включены: Google принимает только HTTPS-адреса, получен «${publicUrl}»`);
    return;
  }
  void registerChannels(log).catch((err: unknown) =>
    log.warn(`Регистрация push-каналов не удалась: ${(err as Error).message}`),
  );
  if (!renewTimer) {
    renewTimer = setInterval(() => {
      void registerChannels(log).catch((err: unknown) =>
        log.warn(`Перерегистрация push-каналов не удалась: ${(err as Error).message}`),
      );
    }, RENEW_EVERY_MS);
    renewTimer.unref?.();
  }
}

export function stopDriveWatch(): void {
  if (renewTimer) {
    clearInterval(renewTimer);
    renewTimer = null;
  }
}
