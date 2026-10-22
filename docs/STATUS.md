# DASH — паспорт проверенного состояния документации

**Дата состояния:** 2026-10-23. **Источник:** 250 исходных MD `main@9d0cedaee51483bc0430200354ba6820a7681295`; независимая сверка с `main@c4b792afb120b106c5423594c272fb076fa10f50` показала **250/250 совпадений**. Данные о PR — моментальный срез, не бесконечно актуальный мониторинг.

| Предмет | Статус этого выпуска | Доказательство / ограничение |
|---|---|---|
| Идентичность исходных Markdown | `verified` | 250/250 size + Git blob SHA-1 + SHA-256 сверены по manifest |
| Машинное чтение корпуса | `verified` | 91 674 строк в 250 файлах, 34 106 логических единиц; см. registers |
| Смысловая экспертная проверка каждого исходного тезиса | `not-done` | Источники классифицированы и извлечены; построчное принятие ещё не проведено |
| Архитектура новых инструкций | `proposed` | `docs/KNOWLEDGE_ARCHITECTURE.md` и кандидаты в корне пакета |
| Статус Google Sheets и Apps Script прямо сейчас | `unverified` | Исторический журнал 11.10 не доказывает работу триггеров 22.10 |
| Word worker, production/release | `unverified` | Для подтверждения требуются реальные два цикла и readback, не документация |
| ADR-0012 | `proposed-in-source` | `docs/decisions/0012-durable-source-integrity-observations.md:L3` |
| Дизайн #83/#88 | `laboratory-tested-in-source` | Постмортем 10.10; не равен принятой промышленной замене |
| Инструкции в Git | `draft-PR-not-merged` | [PR #145](https://github.com/gaben1488/dash/pull/145), ветка `codex/dash-ai-memory-v2-20261022` (`f8381f3` до этой итерации); не принята и не объединена с `main` |
| Полный baseline → webhook diff | `requirement-not-prod-verified` | [PR #150](https://github.com/gaben1488/dash/pull/150) закрыт без merge; требование изложено в `docs/contracts/SOURCES_AND_INTEGRITY.md`, но работа на VPS не проверена |
| Исключение для регрессионных `week-*.json` | `preserved-in-draft` | Исходный `CLAUDE.md` в `main@9d0ceda`, п. 29.07.2026; строго ограниченный перенос — `docs/contracts/REPORT_RELEASE.md` |

Не переносить эту таблицу как всегда актуальную память. При появлении нового commit или live readback обновлять `asOf`, ссылку на evidence и состояние конкретной строки.
