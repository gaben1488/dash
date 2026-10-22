# DASH — как находить опорные источники при работе с ИИ

**Статус:** проект навигатора. Ссылки привязаны к исходному Git `main@9d0ceda` и неизменному ZIP из Drive. В текущей основной ветке на дату сверки 22.10.2026 текст 250 MD не изменился.

| Вопрос | Активный кандидат | Непосредственные свидетельства | Что ещё проверять |
|---|---|---|---|
| Цели и задачи администрации | `PRODUCT.md`; новый `AGENTS.md` | `PRODUCT.md`, `docs/superpowers/specs/2026-08-07-product-goals-map.md` | Какие outcome приняты владельцем и измерены |
| Источники и формулы | `docs/contracts/SOURCES_AND_INTEGRITY.md` | `docs/DATA_SOURCES.md`, `docs/TECHNICAL_SHEETS_COMPATIBILITY_2026-10-10.md`, `docs/decisions/0007-source-context-and-document-content-contract.md`, `packages/shared/src/column-map.ts` | live book IDs/headers, Apps Script, config |
| Метрики и экономия | `docs/contracts/METRICS_AND_MONEY.md` | `docs/METRICS_CONTRACT.md` (исторический D/E), `docs/decisions/2026-10-08-monitoring-money-attribution.md`, `docs/superpowers/audits/2026-08-21-svod-proof/` | независимая арифметика, актуальная норма |
| Справочник и идентичность | `docs/contracts/IDENTITY_AND_HISTORY.md` | `docs/decisions/2026-10-08-customer-identity.md`, `docs/decisions/2026-10-10-customer-directory-migration-qa.md` | пилот vs 8 production masters |
| Word, выпуск, рекомендации | `docs/contracts/REPORT_RELEASE.md` | `docs/report-engine-operating-contract.ru.md`, `docs/decisions/0001-verified-report-publication.md`, `docs/decisions/0010-canonical-weekly-report-archive.md`, `docs/decisions/0011-weekly-evidence-report-and-executive-ux.md` | worker, 2 DOCX, one release, actual VPS |
| UI/навигация/сигналы | `docs/contracts/UI_AND_FILTERS.md` | `docs/superpowers/audits/2026-10-10-design-library-postmortem.md`, `docs/superpowers/specs/2026-08-21-card-done-definition.md` | 320px + desktop × light/dark, accurate scope |
| Как исправлять системные ошибки | `docs/engineering/CHANGE_PROTOCOL.md`; `FAILURE_PATTERNS.md` | `.claude/projects/.../memory/feedback_v15.md`, `docs/superpowers/specs/2026-08-22-mandate.md` | содержательный эффект vs PR count |
| VPS и аварии | `docs/operations/RELEASE_GATES.md`, действующий `docs/RUNBOOK.md` | `deploy/README.md`, `.github/ci/deploy_scope.py` (код), `docs/SECURITY.md` | production instance version and logs |

## Где остальные 250 оригиналов

`registers/FILE_REVIEW_250.csv`: путь, вид, темы, SHA и текущая степень проверки. `registers/READING_QUEUE_250.md`: полный перечень документов с автоматически выделенным смысловым ядром. `source_cards/NNN.md` и `source_cards/NNN-logical.md`: цитатные/логические выписки с номерами строк. `registers/SOURCE_LOGICAL_UNITS.csv`: индекс каждого логического блока. **Для любого решения открыть полный соответствующий MD**, не полагаться только на короткую карточку.

## Когда читать большой исторический файл

Только когда возникает конкретная спорная гипотеза и уже известны ключевые слова/тема/реестр. Достать раздел со строками, сверить дату и исходные наблюдения. Не загружать гигантские `docs/superpowers/audits/*` целиком на каждую правку, не превращать их в always-on правила.
