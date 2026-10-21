# Доказательства приёмки выбранных двадцати задач

Это приложение к [PLAN](PLAN.md#current-execution), не новая очередь и не изменение
критериев. Один проход по интеграции `fb9f0c65` и незакоммиченным изменениям
`codex/report-identity-20261021` от 21 октября. Незакоммиченная реализация ниже
обозначена **WIP**. Наличие теста не означает его новый запуск или приёмку
production. Установка на момент сверки — `8554838d`; новый кандидат не запускался.

Обозначения доказательств:

- **E1** — ранее зафиксированные в PLAN прикладные проверки, включая 799 shared,
  1919 core / 1 прежний skip, 2387 web. Это разные сохранённые прогоны, не один
  полный прогон текущей интеграции. Последние адресные проверки периода/API — 90.
- **E2** — интеграция `fe4ea62a`: четыре typecheck и 1926 core PASS;
  адресные coverage/alias проверки 115 core, 32 server, 74 Python, сообщены владельцем
  интеграции и зафиксированы в PLAN. Прогон заново в этой сверке не выполнялся.
- **E3** — `18c5423a`, включён как `fb9f0c65`: 151 Linux controller/recovery/backup/
  passport PASS; затем 28 адресных PASS, включая фактический native-программный
  путь, Git diff с переименованием reader и контракт workflow. Ruff, YAML, diff PASS.
  Настоящие временные файлы/SQLite/locks; Docker-команды восстановления в fixture
  подменены. Это не доказательство установленного web-only перехода.
- **E4** — установленный `8554838d`: CI `39548330621`, controlled release
  `39549279758` SUCCESS и сохранённый readback image IDs. Новые локальные изменения
  не получают это доказательство автоматически.

## Матрица

| ID | Код и проверяемая граница | Существующее доказательство | Что ещё нужно для исходного критерия |
|---|---|---|---|
| C06.01 | [check-registry](../packages/shared/src/check-registry.ts), [signal-answer](../packages/shared/src/signal-answer.ts), [rule-book](../packages/shared/src/rule-book.ts), core pipeline signals | E1: future Q, no N, причина U, информационное позднее заключение; `signals.test.ts`, `ep-review-scope.test.ts`, `signal-answer.test.ts` | Подтвердить один жизненный цикл закрытия/false-positive во всех потребителях, включая мониторинг и сохранённый Word; новая установка и адресная приёмка. Общие подписи сами по себе этого не доказывают. |
| C06.02 | [threshold-registry](../packages/shared/src/threshold-registry.ts): **WIP** `thresholdAt`/`freezeThresholds`; правовые ссылки отдельно от внутренних ориентиров | `threshold-registry.test.ts`; текущие новые проверки сообщает владелец интеграции | Завершить подключение dated/frozen выбора всех соответствующих потребителей; доказать, что старый срез не читает текущую настройку. `unverified` честно ограничивает вывод, но не доказывает проверенную редакцию нормы. |
| C06.03 | Общие [product-dictionary](../packages/shared/src/product-dictionary.ts), [БЗ метрик](../packages/shared/src/metrics/registry.ts), EP clusters, formula-integrity, formula-defects | E2; PLAN: сохранённое покрытие имён управлений 4147/4147; `test_department_directory.py`, `formula-integrity.test.ts`, `formula-defects.test.ts` | Покрытие имён организаций не является покрытием оснований ЕП. Нужны предметные редактируемые основания/этапы/сезонность/правила, guided input с контекстным комментарием, измерение их словарей, согласованный экспорт правил DOCX/Markdown. В просмотренных маршрутах/Settings это целиком не подтверждено. |
| K02.01 | [scorer](../packages/core/src/trust/scorer.ts), validate/formula-integrity → сохранённый coverage; [check-coverage](../packages/shared/src/check-coverage.ts) **WIP**, web trust-metrics | E1: неизвестное не равно 100, старый current fallback пересчитан без переписывания исторического snapshot; E2: expected/checked/failed | Завершить проверку фильтрованных знаменателей и всех UI/API потребителей. **WIP** нельзя считать выпущенным. Старые исторические результаты должны оставаться историческими, без выдуманного нового охвата. |
| C05.02 | [общие схемы](../packages/shared/src/schemas.ts), dashboard/Report API parsing, calc-engine adapter, арифметические правила с `passed=null` | E1: обязательные 26 полей периода, отсутствие поля отклоняется; PLAN: 131 реальный периодный блок прочитан, 9,74 МБ проверяются за 131–476 мс; missing denominator/source отдельно от нуля | Установка и проверка выбранных экранов/экспортов на общей модели. Нельзя переносить доказательство dashboard DTO на все произвольные API. |
| C04.01 | [calc-engine](../packages/core/src/pipeline/calc-engine.ts), unifiedGrid, [canonical_metrics.py](../packages/report-engine/src/procurement_engine/canonical_metrics.py), общий день Камчатки | E1/PLAN: 360 core + 7 server, 62 Python; граница дня, future/today Q, signed AD; shared source-value fixtures | Зафиксировать независимое сравнение одной версии исходных строк между API/BI/Word после общей интеграции C08.02; не использовать разные моменты чтения. |
| C04.02 | [money-units](../packages/shared/src/money-units.ts), [parse-sheet-date](../packages/shared/src/parse-sheet-date.ts), Python normalize, общий source-value fixture | E1: 115 Python и shared контрпримеры; `test_source_value_contract.py`, money/date/activity tests. Числовые хвосты, Infinity, дробный serial и год вместо даты различены | Сохранить общий fixture в итоговом CI. Проверить сохранённые доказательства всех перечисленных единиц/процентов, не считать паритет парсеров автоматическим паритетом всех метрик. |
| C04.03 | [scatter-scope](../packages/web/src/lib/scatter-scope.ts), `routes/rows-scatter.test.ts`, аналитика конкурентности | E1/PLAN: snapshot cutoff вместо текущего дня, граница Камчатки, scope tests; лимитная разница отделена от AD-экономии | Нужна зафиксированная точка «исходная строка → API → облако/CostOfRefusal» с unknown method и no-AD. Старый scatter не должен возвращаться через соседний consumer. |
| C03.01 | [rows-filters](../packages/server/src/services/rows-filters.ts), [filter-context](../packages/web/src/lib/filter-context.ts), selectors, period-params, snapshot-year-scope | E1: strict year/scope, 90 адресных API-проверок; `budget-filter`, `org-scope`, `kpi-filtering`, `time-scope` tests | Нужна единая матрица сочетаний activity/method/budget/org/period и инварианта «части = целое», включая legacy fields. Отдельные тесты фильтров не доказывают все сочетания. |
| C05.01 | [STANDARD_METRICS/DERIVED](../packages/core/src/pipeline/calc-engine.ts), [общая БЗ](../packages/shared/src/metrics/registry.ts), [metric-provenance](../packages/shared/src/metric-provenance.ts), MetricProvenance UI | E1: устранён второй квартальный денежный расчёт под именем количества; quarter-execution/dashboard tests; E2: общая БЗ и подписи | Исполняемый реестр уже есть — строить второй не нужно. Однако БЗ (`formula`/`source` строками), исполняемая формула и runtime provenance остаются разными контрактами. Не доказан общий результат с grain/scope/dependencies/version и раскрытием **каждого** числа до тех же строк в карточке/таблице/графике/Word. |
| R05.01 | [department_directory.json](../packages/report-engine/src/procurement_engine/department_directory.json), [source_contract.py](../packages/report-engine/src/procurement_engine/source_contract.py), schema_migrations, shared data-sources/department-registry | E2: один каталог управлений/алиасов; `test_schema_migrations.py`: геометрия, immutable backup, неизвестная миграция, конкурентная смена registry | Каталог управлений не равен каталогу source profiles. Нужен единый проверяемый контракт fileId/sheetId/роль/поля/единицы/обязательность/зависимости/права и паритет адаптеров 19/32/34 и исторических схем TS/Python. `source_contract.py` сам содержит fingerprint/perimeter, не всю эту модель. |
| R05.03 | source-refresh → сохранённые primary rows/coverage → потребители; [source-coverage](../packages/shared/src/source-coverage.ts) | PLAN: `af5b`, 6156 TS/1210 Python, exact release/source/API readback; E1: alias/failure/known-empty регрессии | Прежнюю приёмку primary чтения сохранить; проверить только интеграционное отсутствие регрессии. Не объявлять этим закрытыми отдельные schema/channel критерии R05.01/02. |
| C08.02 | [snapshot-calculation-context](../packages/server/src/services/snapshot-calculation-context.ts) **WIP**, source_context.py, snapshot-calculation, issue-decisions | Существующий Python context; E1 общий календарь. Новый TS context хеширует входы/профили/код, сохраняет thresholds и productDay | **WIP**: проверить точную инвалидацию rules/day/access/decisions, повторное чтение сохранённого контекста. `access=full-dataset`/`decisions=not-applied` допустимы как описание стадии, но сами по себе не проверяют последующую проекцию/изменение доступа. Отделить instant наблюдения от календарной зависимости вычисления. |
| C05.04 | [snapshot-read-model.test](../packages/server/src/services/snapshot-read-model.test.ts), reader/cache/worker; request timing | E1: bounded reads, прошлый пригодный snapshot при отказе источника, worker tests; PLAN сохраняет предыдущие медленные измерения | Нет принятого парного cold/warm/worker-concurrent результата в исходном бюджете для текущей реализации. Это практический критерий, а не необходимость повторить все тесты. Недоступность Google не должна удерживать готовое чтение. |
| C05.11 | [request-timing](../packages/server/src/plugins/request-timing.ts): reader/model/contract, serialization, process CPU и event-loop lag; source timing | `request-timing.test.ts`; PLAN: native/browser замеры и известная стоимость 9,74 МБ; E1 | Просмотренный HTTP plugin не выделяет полный Google/normalize/SQL/proxy путь. Нужна связанная атрибуция и парные замеры при одинаковых лимитах и worker. Старые 3/23 секунды и новый unit-test не доказывают устранение причины. |
| R08.03 | webhook-queue, source-refresh gate, queue-flow/unavailable | PLAN: приёмка 21.10, 36 тестов и настоящие SQLite-отказы; retry ограничен тремя, уведомление сохраняется | Локальный исходный критерий принят; подтвердить включение и итоговую установку, не переоткрывать без новой регрессии. |
| R09.02 | [runtime_artifact](../.github/ci/runtime_artifact.py), [runtime_passport](../.github/ci/runtime_passport.py), controlled release | E4 build-once/installed IDs; E3 добавляет mixed-component passport и исходные архивы без повторного export | Нужен паспорт **финального** общего SHA, не перенос E4 на новые коммиты. После web-only backend SHA отдельно от UI SHA. |
| R09.03 | [release-controller](../deploy/release-controller.py), [release_recovery](../deploy/release_recovery.py), [workflow](../.github/workflows/vps-cache-cleanup.yml), [runbook](../deploy/README.md#обновление-и-выпускной-допуск) | E3: web-only без server/worker mutation, concurrent DB сохранена, owner loss до/после acceptance, config drift, настоящий Git rename reader → полный путь | Код интегрирован; первая установка механизма сама требует полного пути. Не выдавать mocked Docker fixtures за production web-only испытание. Финальная runtime приёмка отдельна от локального критерия совместимости. |
| R01.01 | PLAN + эта матрица, исходные criteria/ID, git SHA, E1–E4 | Все выбранные 20 ID перечислены без замены мелкими фикcами; доказательства кода/проверок/установки разделены | Дополнить финальным SHA/приёмкой и оставшимися доказательствами. Эта выборка не объявляет автоматически полным traceability всех 56 результатов/142 подзадач. |
| R01.05 | Один владелец интеграции: `codex/report-identity-20261021`; компонентный пакет включён `fb9f0c65`; прикладной CI отдельно от OPS | E1–E4; PLAN явно хранит scoped43 PASS и OPS discovery529: 9 failures/31 errors/95 skips | Поимённо завершить причины старого OPS baseline либо приложить уже существующее завершение; проверить конкурирующие PR/patch и актуальность #69. В этой сверке GitHub не перепроверялся. Полный release после двадцати, не параллельный второй rollout. |

## Существенные оставшиеся доказательства

Наиболее крупные пробелы исходной приёмки: предметная часть C06.03,
связь исполняемого каталога и runtime результатов C05.01, общий source profile
R05.01, парные измерения C05.04/C05.11 и завершение старого OPS baseline R01.05.
Они не закрываются количеством перенесённых словарей, тестов или коммитов.
Для C06.02/K02.01/C08.02 имеется новая незавершённая реализация у владельца
интеграции; она оценивается по своим адресным критериям после сохранения.

Чистый старт является допустимым состоянием. E3 проверяет пустой inventory,
отсутствие первого Word и восстановление без выдуманного прошлого. Если в
checkpoint уже есть опубликованные документы, `latest=null` не получает этот
допуск. Восстанавливать удалённые по просьбе владельца данные для закрытия
критерия не требуется.
