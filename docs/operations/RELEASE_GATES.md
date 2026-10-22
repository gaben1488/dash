# DASH — гейты изменения репозитория, источников и VPS

**Статус:** предложенный контроль 2026-10-22. Не является действующим распоряжением на deploy.

| Область | Проверить | Доказательство | Запрет при провале |
|---|---|---|---|
| Git | pinned SHA, чистый diff, права, private-data scan | SHA и перечень изменённых путей | Не заявлять текущий status по старому SHA |
| docs-only | `.github/ci/deploy_scope.py` на exact HEAD, классификация новых путей | decision log `runtime_changed=false`, если ожидается docs-only | Не merge без оценки, если новые `.agents`/`.claude` будут расценены как runtime |
| TS/Python | релевантные unit/integration/build, Python runner | лог CI конкретного HEAD | Не выдавать зелёный unit за live readiness |
| Sheets | ID/owner, schema 34 cols, формулы/валидаторы/Apps Script/triggers/changelog, backup | отдельный readback и неразрушающая проверка | Не запускать массовую миграцию, не восстанавливать удалённые техлисты случайно |
| Показатели | равенство чисел по одинаковому perimeter/asOf, денежный oracle | fixture + source tracing | Не публиковать расчёт с выдуманной экономией/ложным нулём |
| Word | captured immutable source, `ReportModel`, два DOCX, `release_id`, version/cutoff | независимый parse/readback двух файлов | Не перезаписывать предыдущий комплект |
| Worker | расписание и storage/VPS; **два** последовательных рабочих успешных цикла | свежие логи, revision и post-restart readback | Не писать «prod-verified» по merged ADR |
| UI | существующая навигация, выборки, мобильная/десктопная вёрстка, темы | browser QA на конкретном deployment | Не объявлять prototype реальным интерфейсом |
| Акт приёмки | human-visible effect, owner decision | номер выпуска/снимка, дата и понятное описание | Не смешивать `merged` и `owner-accepted` |

## Исторические опасности

- С 11.10.2026 в восьми master книгах были удалены `Settings`, `Контроль`, `_Справочник`. Состояние Apps Script после удаления тогда прямо не было подтверждено: `docs/TECHNICAL_SHEETS_COMPATIBILITY_2026-10-10.md`.
- `docs/decisions/0012-durable-source-integrity-observations.md` — proposed; наличие ADR **не означает** сохранение integrity после рестарта в текущем коде.
- `.github/ci/deploy_scope.py` на SHA `c4b792a` классифицирует `docs/**`, `.github/**` и некоторые root имена как non-runtime, однако **не освобождает новые `.claude/**` и `.agents/**`**. Поэтому этот пакет **не коммитить целиком в `main`** без отдельной проверки поведения deploy; сначала docs-only PR или исправленный и проверенный классификатор, если он действительно требуется.
- Просмотр/изменение документа в Google Drive не является выкладкой на VPS. Решение об изменении ACL принимается отдельно.

## Реальный инцидент

Если production ведёт себя иначе, чем отчёт CI, сначала покажи пользователю commit на VPS, image/build timestamp, source snapshot и время последнего доказанного PASS. Новая неуспешная попытка **не отменяет** хранимое последнее успешное заключение, но и не должна скрываться за ним. Откат и сохранение предыдущего выпуска — обязательные элементы операции, не украшение статуса.
