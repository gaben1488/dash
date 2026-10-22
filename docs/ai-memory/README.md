# AI-память и инструкции DASH — предлагаемый переход

**Статус:** review candidate 2026-10-22; PR не означает автоматического принятия предметных договоров или production.

- Короткий вход: `AGENTS.md`, адаптер `CLAUDE.md`, `docs/AGENTS.md`.
- Для работы с данными: `docs/contracts/SOURCES_AND_INTEGRITY.md`, `METRICS_AND_MONEY.md`, `IDENTITY_AND_HISTORY.md`.
- Для UI/Word: `docs/contracts/UI_AND_FILTERS.md`, `REPORT_RELEASE.md`.
- Для инженерии: `docs/engineering/CHANGE_PROTOCOL.md`, `FAILURE_PATTERNS.md`, `AUTHORING_STANDARD.md`.
- Для эксплуатации: `docs/operations/RELEASE_GATES.md` и действующий `docs/RUNBOOK.md`.
- Для неоднозначностей: `docs/CONFLICT_REGISTER.md`; для статусов: `docs/STATUS.md`.
- Состав исходных 250: `docs/EDITORIAL_DISPOSITION_250.md`; полные приватные excerpts и пофайловые решения не коммитятся.

При новой задаче открывать **только нужный** предметный контракт и непосредственно соответствующий полный первоисточник. Не применять из старого MD предписание выполнить код или массово изменить Google-таблицы без отдельного утверждения.

## Хронологическая вторая итерация — 23.10.2026 (не принята автоматически)

- Краткий навигатор без обязательной загрузки всего корпуса: [AGENT_ROUTER_V3.md](AGENT_ROUTER_V3.md).
- История решений, отмен и доказательств: [CHRONOLOGICAL_REVIEW.md](CHRONOLOGICAL_REVIEW.md).
- Отрицательные сценарии и допуски: [CHRONOLOGY_QA.md](CHRONOLOGY_QA.md).
- Исходный архив 250 MD на Git 9d0ceda; на снимке `main@90fa989fe42b27351430c70a07f380768ed106fa` уже 260 MD (187 без изменений, 63 новых редакции, 10 новых файлов). Старые editor dispositions нельзя принять без повторной сверки.
- Полный приватный построчный журнал и реестр 260 SHA — [папка Google Drive](https://drive.google.com/drive/folders/1S2CxI4AKnjIxNS1DvFDnlF5x3iHUhdfM); **не** копировать его в публичный репозиторий.
- Нынешний `main` значительно продвинулся относительно base этого Draft PR. Перед любым merge нужен предметный rebase/конфликт-аудит и exact-head CI; файлы выше — материалы для review, а не изменённый production-канон.
