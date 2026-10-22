# Dash — AEMR Platform

BI-платформа закупочной деятельности Елизовского муниципального района:
Google Sheets → нормализация и расчёт → Fastify API → React-интерфейс и отчёты.
Текущая приёмка, установленная версия и кандидат находятся в
[PLAN](docs/PLAN.md#current-execution). Документация сама по себе не подтверждает
готовность production; число тестов или статус старого выпуска не переносится на новый.

<a id="documentation-map"></a>

## Карта документов

Правила приоритета решений и начала работы — [AGENTS](AGENTS.md).
Каждый документ ниже владеет своим предметом; общую очередь и стадию не копируем.

| Вопрос | Где читать и изменять |
|---|---|
| Что делаем сейчас, что установлено и чем доказано | [PLAN: текущее исполнение](docs/PLAN.md#current-execution) |
| Задачи, приоритеты, связи требований | [Реестр 142 работ](docs/PLAN.md#work-registry), [приоритеты](docs/PLAN.md#consolidated-mandate), [сверка модели](docs/PLAN.md#target-reconciliation) |
| Переносимый мандат для новой сессии | [Действующий промпт](docs/superpowers/specs/2026-08-29-idealnyj-prompt.md#current-prompt), [мандат](docs/superpowers/specs/2026-08-22-mandate.md) |
| Для кого продукт и какие результаты он даёт | [PRODUCT](PRODUCT.md) |
| Визуальные правила и взаимодействие | [DESIGN](DESIGN.md), полный [DoD карточки](docs/superpowers/specs/2026-08-21-card-done-definition.md) |
| Реализация, целевые границы и переходы | [ARCHITECTURE](docs/ARCHITECTURE.md), [ADR](docs/decisions/) |
| Книги, листы, поля, суммы, календарь и фильтры | [DATA_SOURCES](docs/DATA_SOURCES.md), [METRICS_CONTRACT](docs/METRICS_CONTRACT.md) |
| Проверки, запуск, выпуск и восстановление | [RUNBOOK](docs/RUNBOOK.md), [release gate](deploy/README.md) |
| Доступ и защита данных | [SECURITY](docs/SECURITY.md); датированные проверки — [REVIEW](docs/REVIEW.md) |
| Где искать старое основание и состав UI | [CODEMAP](docs/CODEMAP.md), [атлас](docs/superpowers/audits/2026-08-20-cards-map/сводная-карта.md), датированные specs/audits/qa |

PLAN хранит 56 результатов, 142 подзадачи, связи T001–T158 и источники решений.
Атлас/матрицы дают подробные свидетельства по своим срезам, не второй backlog.
Исторические master-plan/REMAINING/REPORT-CANON и `docs/archive/` читаются по
необходимости: их старые приоритеты и заявления «единственный реестр» не действуют.
Предложение из аудита не становится принятым решением из-за даты или названия файла.
Изменение нормы вносится в её предметный дом; остальные файлы ссылаются на него.

## Состав и требования

```text
packages/shared/  типы, константы, справочники и правила
packages/core/    нормализация, расчёт, сигналы и сверка
packages/server/  Fastify, источники, SQLite/Drizzle и API
packages/web/     React 19, Vite 6, Zustand, Recharts, Tailwind
deploy/           Compose, Caddy, web/server и профиль report-worker
docs/             контракты, эксплуатация, решения и история
```

Node.js 22+, Corepack и pnpm версии из `packageManager` (сейчас 10.33.0).
Для чтения подключённых книг нужны настроенные Google credentials и права.
Секреты и исходные выгрузки в Git не добавляются.

## Локальный запуск

```bash
corepack pnpm --version
corepack pnpm install --frozen-lockfile
cp .env.example .env
corepack pnpm dev
```

Web: http://localhost:5173, API health: http://localhost:3000/api/health.
Переменные и варианты локального доступа — `.env.example` и
[RUNBOOK](docs/RUNBOOK.md#local-development).
Не менять lockfile/overrides ради случайной глобальной версии pnpm.

## Проверки

Команды определены в `package.json`: `lint`, `typecheck`, `test`, `build`,
`audit --audit-level moderate`; запускать через `corepack pnpm`.
Набор по типу изменения и повторное использование доказательств —
[AGENTS](AGENTS.md#гейт-перед-коммитом). Исторические результаты июня не являются
проверкой текущего HEAD. Полный CI и эксплуатационная приёмка имеют отдельные стадии.

## Production

Штатный стек и точные процедуры — [deploy/README](deploy/README.md) и
[RUNBOOK](docs/RUNBOOK.md). Команды первоначального запуска не заменяют
контролируемое обновление действующего сервера. Сохранность постоянного состояния,
проверенное восстановление/откат и действующий допуск обязательны.

Браузерный production-доступ идёт через Basic Auth в Caddy, который добавляет
серверный Bearer. Совет сохранять production-ключ в localStorage не применяется;
локальный режим, webhook и публичный read-only имеют отдельные условия в
[SECURITY](docs/SECURITY.md). Это не реализованная персональная модель прав.
