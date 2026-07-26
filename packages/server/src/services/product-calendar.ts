/**
 * Календарь продукта: прод-сервер живёт в UTC, пользователь — на Камчатке
 * (UTC+12, DST нет), поэтому «какой сегодня день» считается не по календарю
 * машины, а по фиксированному смещению config.weeklySnapshot.utcOffsetHours.
 * Единственный дом этой конверсии: ей пользуются четверг-cron (решение
 * «снимать ли снимок») и retention снимков (группировка по дням/неделям).
 */

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * Календарный день продукта (номер суток от 1970-01-01) для момента `instant`
 * при фиксированном смещении пояса. TZ машины не участвует: instant — абсолютный
 * момент, смещение — из конфига. Дополняет dayNumberOf из @aemr/shared, который
 * разбирает календарные ЗАПИСИ (строки/serial), а не абсолютные моменты.
 */
export function productCalendarDay(instant: Date, utcOffsetHours: number): number {
  return Math.floor((instant.getTime() + utcOffsetHours * MS_PER_HOUR) / MS_PER_DAY);
}
