# Dash: архитектурная реконструкция и приёмка сценария 12

Статус: design contract / implementation NOT ACCEPTED. База: современный интегратор PR #79; никакого переноса устаревшего main или выкладки в production.

## 1. Постановка и неоднозначность номера

В корпусе есть две разные нумерации: A12 из двадцати сценариев приёмки (ручной прогнозный коэффициент 8%) и C05.11 под №12 календарного плана 142 задач (диагностика времени загрузки). До подтверждения конкретной исходной двадцатки нельзя объявлять ни одну из них выполненной. Данный документ связывает обе с общей архитектурой, но не подменяет исполнение.

## 2. Целевая модель

Единая последовательность: Source adapters → immutable acquisition/snapshot with provenance → schema validation → canonical identity and domain normalization → deterministic domain computations → immutable materialized read models → API selectors → UI / Word / audit. Side effects: command validation → authorization and concurrency control → durable transaction and outbox → idempotent delivery; failures never masquerade as zero or success.

Ownership: источники владеют первичными строками; snapshot store — доказательствами чтения; identity service — устойчивыми связями; domain engine — единственными определениями чисел; publication service — атомарным release manifest; presentation — только отображением, без собственной бизнес-математики. Никакой второй базы хозяйственных фактов, второго вычислителя экономии или скрытого источника истины.

## 3. Сквозные инварианты

- Все суммы имеют тип: planned_need, budget_limit, NMCK, contract_amount, tender_reduction, recognized_saving, forecast_estimate, unallocated_balance. Межтиповое сложение или подмена запрещены.
- Forecast rate (например, 8%) — версионированный вход конкретной модели с source, asOf, assumptions и approval; никогда не признанная экономия.
- Каждое число несёт source_cut, rules_version, calculation_id, unit, precision, status (verified/estimated/unknown/not_applicable), lineage; UI и Word читают один и тот же расчёт.
- Организация, закупка, ИКЗ, процедура и участник совместной закупки имеют разные идентичности; неоднозначная связь остаётся unknown.
- Все фильтры строят один selector contract; сумма карточек, выгрузок и документов проверяется на одном множестве атомов.
- Snapshot четверга неизменяем; отсутствие предыдущего сравнимого снимка не трактуется как ноль.
- Новая публикация не повреждает последний проверенный комплект; версия кода, данных и правил записана в manifest.
- Уведомления только после durable commit; повтор доставки идемпотентен.
- Недоступный источник, неполное чтение, ошибка формулы, пропущенный CI или неподтверждённый VPS = BLOCKED/UNKNOWN, никогда PASS.

## 4. Не накладывать ещё один слой поверх слоёного пирога

Сначала инвентаризировать фактические пути и владельцев поведения (входы, функции, SQL, API, UI, Word, jobs, конфигурации). Построить directed dependency graph: source column → domain field → computation → materialization → API → screen/report → job/release. Для каждого дублированного пути назначить один canonical owner, остальные объявить migration candidates. Удаление старого кода разрешено после characterization tests, shadow comparison на frozen snapshots и проверки функционального паритета. Не поддерживать бесконечно два runtime. Разбивать рефакторинг на вертикальные срезы с явной точкой отката, не на массовое переименование папок.

## 5. Сценарий A12: end-to-end

Fixture: исходная плановая потребность и введённый вручную коэффициент 8%. Ожидается прогноз с пометкой estimated, сохранёнными исходным значением, моделью, датой и единицей; recognized_saving остаётся независимым. Проверить смену коэффициента, отсутствие коэффициента, некорректную единицу, отрицательные/пограничные суммы, старый snapshot, переключение фильтров и экспорт Word. Сравнить числа, provenance и названия во всех представлениях; никакой автоматической записи результата прогноза в master.

## 6. Сценарий C05.11: end-to-end

Для открытия Dash измерять раздельно source acquisition, schema/identity, compute, SQLite queries, API serialization/network, browser render и hydration. Correlation ID и trace span объединяют путь без утечки ПДн. Проводить cold/warm и degraded-source прогоны на закреплённых версиях; фиксировать p50/p95, payload, число запросов, повторную работу и влияние фильтров. Ускорение допустимо лишь при одинаковых результатах и сохранении fail-closed.

## 7. Порядок внедрения

1. Закрепить точный SHA современного #79 и текущий release manifest; получить полный inventory по реальному коду и живым источникам.
2. Зафиксировать baseline: API/UI/Word, 8 masters, schema, frozen week, worker, security, latency. Не писать в первичные таблицы.
3. Ввести типизированные контракты и граф lineage в ядре; подготовить тесты и shadow path.
4. Перенести по одному вертикальному срезу с независимым сравнением; убрать прежний расчётный путь, а не оставлять параллельный.
5. Доказать compatibility для всех потребителей, затем интегрировать с #79; только после этого готовить отдельный RC.
6. Gate: exact-head CI, real source readback, two worker cycles, backup+restore SQLite/WAL/Word, rollback, authenticated 13-screen/API readback. До выполнения — не merge/deploy.

## 8. Definition of Done

Задача завершена только если названы точные изменённые production paths, SHA, тестовые команды и результаты, покрытие всех зависимых потребителей, отсутствие второй реализации, доказанная сохранность данных, rollback и установленный readback. Документ, PR и зелёный CI сами по себе не являются завершением.

## 9. Scope этого изменения

Этот PR содержит только архитектурный контракт. Он НЕ переписывает runtime, НЕ подтверждает выполнение A12/C05.11, НЕ запускает CI, НЕ трогает Google Sheets, SQLite, VPS, worker или production. Следующий шаг — кодовая инвентаризация и реализация по вертикальным срезам на той же ветке после проверки точного актуального HEAD.
