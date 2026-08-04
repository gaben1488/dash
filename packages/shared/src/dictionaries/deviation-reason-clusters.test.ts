/**
 * Словарь причин отклонения: живые формулировки из книг 26.06.2026.
 * Каждый пример — дословная строка листа, не выдуманная.
 */
import { describe, expect, it } from 'vitest';
import { canonicalizeDeviation, DEVIATION_DICT } from './deviation-reason-clusters.js';

const c = (s: string) => canonicalizeDeviation(s).cluster;

describe('canonicalizeDeviation — живые формулировки', () => {
  it('деньги: все редакции «нет финансирования» сходятся в один кластер', () => {
    expect(c('в связи отсутствием финансирования закупка переносится на 30.09.2026')).toBe('DEV_NO_FUNDING');
    expect(c('нет финансирования, планирование на октябрь месяц')).toBe('DEV_NO_FUNDING');
    expect(c('Отсутствует финансирование')).toBe('DEV_NO_FUNDING');
    expect(c('в связи отсутствием финансирования (выделенных лимитов) закупка переносится на 31.07.2026')).toBe('DEV_NO_FUNDING');
    expect(c('отклонение от даты связано с поздним доведением ассигнований')).toBe('DEV_NO_FUNDING');
  });

  it('правка таблицы отделена от срыва закупки', () => {
    expect(c('внесение изменений в связи тех ошиб')).toBe('DEV_DATA_ENTRY_ERROR');
    expect(c('изменение даты в связи неправильной подачи информации')).toBe('DEV_DATA_ENTRY_ERROR');
  });

  it('статус вместо причины опознаётся как дефект заполнения', () => {
    expect(c('Исполнен')).toBe('DEV_DONE');
    expect(c('Заключен 30.01.2026')).toBe('DEV_DONE');
  });

  it('прочие живые кластеры', () => {
    expect(c('Приведено в соотвествии с кассовым планом')).toBe('DEV_CASH_PLAN');
    expect(c('срок действия контракта по 31.03.2026')).toBe('DEV_CONTRACT_TERM');
    expect(c('со стороны поставщика задержка подписания договора')).toBe('DEV_SUPPLIER_DELAY');
    expect(c('Срок переносится на 20.08.2026 всвязи с началом учебного года')).toBe('DEV_SEASONAL');
    expect(c('Аукцион не состоялся, заключен контракт с ед.подавшим заявку на участие')).toBe('DEV_AUCTION_FAILED');
    expect(c('отпала необходимость самостоятельной установки')).toBe('DEV_NEED_GONE');
  });

  it('пустые маркеры листа — «причина не указана», а не «причины нет»', () => {
    expect(c('')).toBe('EMPTY');
    expect(c('Х')).toBe('EMPTY');
    expect(c('—')).toBe('EMPTY');
  });

  it('авторский текст без названной причины не притягивается за уши', () => {
    expect(c('Подали заявку в Николаевский карьер, ждут пробу песка')).toBe('UNMAPPED');
  });

  it('каждый кластер несёт ответственного и признак действия', () => {
    for (const entry of Object.values(DEVIATION_DICT)) {
      expect(entry.label_ru.length).toBeGreaterThan(3);
      expect(entry.owner.length).toBeGreaterThan(3);
      expect(typeof entry.actionable).toBe('boolean');
      expect(entry.regex.length).toBeGreaterThan(0);
    }
  });
});
