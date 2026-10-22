/**
 * Совместимость прежнего имени: регистрация, хранение каналов и продление
 * принадлежат одному webhook-channel. Второго расписания больше нет.
 */
import { watchedBooks } from './webhook-channel.js';
export { startWebhookChannels as startDriveWatch } from './webhook-channel.js';

/** Все действующие файлы с учётом настроек источников, без повторных каналов. */
export function watchedFileIds(): string[] {
  return watchedBooks().map(book => book.fileId);
}
