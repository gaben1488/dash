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

## Дополнение: расчётные основания и замена исторического OPS baseline

**E5, C04.01/C05.01:** код `e75fe8f4`, уточнение единиц `f17bfb5c`.
Реальный `runPipeline().calculatedMetrics` сопоставлен с Python
`aggregate_rows` → `build_business_sections`, которые потребляет Word renderer.
На одном сохранённом наборе восьми книг совпали **480/480** значений:
8 управлений × 2 способа × 5 периодов × 6 показателей (количества плана/факта,
суммы плана/факта, AD-gated экономия, исполнение по количеству).
Три случая отсутствия базы сохранили `null`; максимальная числовая погрешность
`2E-10`. Python `execution_pct` сопоставлен с TS `exec_count_pct` с переводом
процентов в долю, а не с денежным TS `execution_pct`.

Корпус: `C:/Users/filat/dash/tmp-analysis/aemr-current-capture.json.gz`,
SHA256 `acf902e635619b200c7c41ce2ba63ee00e2ee6b179fee984f1ea2bb1fee403e9`.
Чтение источников зафиксировано 20.10.2026; общий расчётный день явно выбран
21.10.2026. Это офлайн-сверка моделей, не подмена даты исторического выпуска.
Воспроизводящие скрипты: `E:/dash-backup/metric-parity-ts.ts` и
`E:/dash-backup/metric-parity-py.py`; результат:
`E:/dash-backup/metric-parity-render-summary.json`, исходные результаты
`metric-parity-ts.json` и `metric-parity-py.json` в том же каталоге.
Новые чтения Google, исторические архивы и production этим не подтверждаются.

Раскрытие в сверке использует общий исполняемый CalcEngine и сохранённые строки,
проверяет равенство сохранённому значению, привязано к snapshot/year/периоду.
Показаны операнды, единицы и адреса; при отсутствии доказательства — неизвестность.
Адресно: 3 core, 6 server, 18 web PASS; штатный гейт `f17bfb5c` — четыре tsc,
1922 core PASS / 1 прежний skip. Реальный Chromium: раскрытие, API scope,
недоступные основания и ширина 390px проверены на изолированной fixture.
Это не полный визуальный обход установленного приложения.

**R01.05 disposition:** прежний агрегат 529/9 failures/31 errors/95 skips
сохраняется как исторически неполное свидетельство: поимённого журнала нет.
По решению владельца удалённые архивы не восстанавливаются ради этого числа.
Текущий допуск заменяют конкретные release/source/admission/restore проверки:
E3 (151 + 28 адресных Linux PASS), scoped OPS 76 PASS, включая исправление cwd
public-evidence fixture `afd16c30`. Отрицательные случаи: повреждённый manifest,
неверный source SHA, runtime-config drift, потеря владельца до/после acceptance,
конкурентная запись SQLite, отсутствие ledger при существующих документах,
недопустимый выход за пустой clean-start. Пустой корректный inventory принят.
Журналы: `E:/dash-backup/ops-targeted-baseline.log`,
`E:/dash-backup/ops-evidence-fixed.log`, `component-release-final.log` и
`component-release-target.log` в том же каталоге. **76 не означает 529 PASS.**
Финальный общий SHA и установленный паспорт остаются отдельным допуском.

**C05.04/C05.11 — конечный ограниченный замер:**
`.github/ci/paired_read_timing.py` выполняет ровно два GET dashboard: native,
затем edge, сохраняет request ID, один snapshot/time, bytes/hash, Server-Timing,
время получения заголовков/тела и JSON parsing. App budget остаётся 3000ms;
Сырой hash сохраняется отдельно. Семантическое сравнение исключает только
`trust.computedAt` и `snapshot.trust.computedAt` — время оценки, создаваемое
на каждом GET. Все значения, исходный момент, решения и контекст сравниваются.
перекрывающиеся стадии не суммируются. Клиентский остаток не объявляется временем
Caddy. Его access-log duration связывается отдельно по `X-Request-Id`, если
доступен; отсутствие записи не превращается в ноль. Браузер этим не измерен.

Владелец допуска выполняет по одному запуску с `--scenario cold`, `warm`,
`worker` на изолированном runtime окончательного SHA, указывая `--native`,
`--edge`, `--sha`, `--year 2026`, `--output`. Секреты только в переменных
`AEMR_API_KEY`, `DASH_BASIC_USER`, `DASH_BASIC_PASSWORD`, не в аргументах/отчёте.
Первый native GET может быть холодным, следующий edge уже повторный: probe
не утверждает обратного. Холодный старт и перекрытие с реальным worker требуют
внешних временных свидетельств; метка `--scenario` их не доказывает.
Probe сам не перезапускает сервис, не создаёт job и не обновляет источники.

## Итог интеграции реализации 21 октября

Первоначальная матрица выше сохраняет состояние её первого прохода; её WIP
не описывает автоматически последующие коммиты. В `1e5de74f` сохранены:

- C06.02/C08.02: датированный выбор порогов и неизменяемый контекст расчёта,
  включая реальные привязки источников, день, версии правил и замороженные значения.
  Неподтверждённая правовая редакция остаётся `unverified`, а не успешной проверкой.
- C06.03/R05.01: один JSON управлений, источников, 34 полей master-профиля и
  рассмотренных схем мониторинга; TS/Python используют его напрямую. Все восемь
  сохранённых реальных заголовков проходят 22 обязательных смысловых проверки.
  Linux: 53 проверки профилей/Google/мониторинга PASS.
- C06.03: общий справочник оснований, этапов, сезонных правил и подсказок редактора;
  Settings экспортирует одни и те же правила в Markdown/DOCX. Сопоставлены все
  80 абзацев двух экспортов. На 3623 реальных строках ЕП: 3533 классифицированы,
  3 пустые, 87 неизвестных; неизвестность является ограничением словаря.
- C06.01: сезонный предмет берётся из G; будущая Q, отсутствие N и накопленные
  обязательства годовой потребности не создают ложное обвинение в отсутствии закупки.
  Четыре контрпримера сначала воспроизвели дефект; адресные 85 core PASS.
- K02.01: фильтрованный Trust суммирует реальные expected/checked/failed;
  неполное покрытие остаётся неизвестным, не превращается в 100 процентов.
- C05.04: одна принятая матрица на источник, атомарные наблюдения журнала,
  receipt источников и контекст разрешают холодное чтение готового результата
  без Google и нового расчёта. Положительный SQLite-тест сохраняет ID/время
  на двух GET; адресные 32 server PASS.
- C05.11: HTTP reader/model/contract/SQL/decode и сериализация, стадии pipeline,
  X-Request-Id и связанный Caddy duration доступны для одного парного замера.

Обычный гейт `1e5de74f`: четыре typecheck PASS, 1933 core PASS / 1 прежний skip.
Это доказательство сохранённого кода. Окончательный source CI, ограниченный замер
скорости и production-паспорт добавляются отдельно; эта запись не объявляет
новый SHA установленным и не снимает отсутствие доказанной правовой редакции.


## C06.01 — контроль согласованности решений 22.10.2026

Дополнение к строке C06.01, без изменения очереди из 20 задач и без
переноса более ранних E1–E5 на новый исходный код.

- Коммит [`8f958645`](https://github.com/gaben1488/dash/commit/8f95864521d580b4773c3df3cb5ba181fc150ff1)
  устраняет чтение сырого `snapshot.issues` в **живом** `/api/report`.
  Решения overlay читаются в каждом запросе, ложноположительные случаи исключены
  из *активных* сигналов отчёта, а `resolved`/`wont_fix` остаются видимыми
  с явным статусом: решение человека не доказывает правку в первичке.
  `/api/metrics/:key` сохраняет карточку со статусом для истории;
  `/api/cell-refs` не считает `false_positive` активным дефектом.
  Архивный `asOf` читает оригинальный снимок и не получает задним числом
  текущую SQLite-правку. Тесты:
  `build-report.test.ts` (отбор, адрес и статусы) и
  `issues-status.test.ts` (SQLite → живой отчёт → детализация →
  точный архив → повторное открытие → живой отчёт).
- Коммит [`2f7e7522`](https://github.com/gaben1488/dash/commit/2f7e752216850773c8f0c33016f72b1d9c4dd50a)
  удаляет две независимые таблицы переходов из server и web.
  Разрешённые переходы и обязательность причины теперь определены
  в `packages/shared/src/issue-status-transitions.ts`, включая отказ
  для неизвестных и prototype-ключей статуса. Проверка в
  `issue-status-transitions.test.ts`; старый web API остаётся re-export.
- Выпуск и production-проверка этими коммитами **не выполнялись**.
  Первичная CI-проверка первого коммита:
  [run 39759345692](https://github.com/gaben1488/dash/actions/runs/39759345692);
  промежуточные PASS TypeScript, основной шаг Tests, source diagnostics и
  сборка образа — это ещё не release-readback.
  Отдельная CI-проверка второго коммита могла отменяться при параллельных
  изменениях ветки — не переносить ей чужой PASS.

**Остаток до приёмки исходного C06.01:** вкладка `/api/monitoring` использует
собственные агрегированные `MonitoringSignal` без устойчивого ID дела/решения;
автоматически применять решение одной проверки ко всей группе адресов
небезопасно. Native Word-издатель использует самостоятельную frozen-модель
issues/recommendation ledger; её жизненный цикл не тождествен SQLite
`issue_history`. Нужны адресные доказательства соответствия конкретного
сигнала делу в мониторинге, формирования следующего Word из того же решения
и неизменности **уже опубликованного** Word, затем проверка установленного
финального SHA. До этих доказательств C06.01 — **кодовое исправление в
интеграции, но не полный PASS/не закрытая задача**.


## Дополнение 22.10.2026 — задача 15/20 C05.11, диагностический контур

Критерий PLAN не менялся: раздельный учёт Google / normalize / SQL / serialize /
reader / proxy / browser response и event-loop lag; три подтверждённых сценария
cold / warm / worker, сопоставимые лимиты, app ≤ 3000 мс без увеличения бюджета.
Включающие интервалы не складываются, label сценария не доказывает его подготовку.

В рабочем интеграторе PR #79 выполнено изменение кода:
- В HTTP request_window записывается безопасный requestId для сопоставления
  с X-Request-Id и Caddy. Отдельный этап google измеряет ожидание одного
  обращения к Sheets с дедлайном (без retry-backoff). В отсутствие
  HTTP-контекста фоновый запрос не создаёт вымышленного этапа.
- Локальный parseSHDYUSheet отдельно измеряет normalize; SQL, decode,
  reader, contract, serialize и event-loop timing сохранены.
- Существующий read-only browser verifier фиксирует время от навигации
  до DOM и готовности навигации, а для фактического GET /api/dashboard —
  responseStart/responseEnd, Server-Timing app и requestId. Недоступный
  замер отмечается отсутствием значения, а не нулём. Ни исходные значения,
  ни URL-параметры, ни секреты в новую сводку не включаются.
- Регрессионные тесты проверяют вложенность стадий, разные HTTP-контексты,
  отсутствие утечки источников, валидацию времени и неопределённость.

Позднее уточнение: независимое фоновое обновление при выдаче уже сохранённого
снимка теперь не наследует HTTP-измеритель. Оно не должно искажать
длительность текущего GET, даже если ещё работает после его ответа.
Добавлен адресный регрессионный сценарий в request-timing.test.ts;
новые коммиты 88f570ed, 1354d62e, fc630b5c. Сервисный mocked
Google-read охвачен отдельным тестом fc2d4d8d; raw browser duration
вычитается до округления (fa9ab235).

Коммиты кода и тестов: 490323d3, b6bc252f, c8caa01b, 1de000b9,
d09c89dd, 488af2dd. Ранний регресс-тест 0fe5ddef уточнён 1de000b9.

Статус: IMPLEMENTED_IN_BRANCH; PRODUCTION_ACCEPTANCE_BLOCKED.
Промежуточные CI отменялись при продвижении HEAD. Нужны exact-head CI,
реальный парный browser/native/edge readback с одинаковым source/runtime
и доказанные cold/warm/worker сценарии. Ни один коммит сам по себе не
доказывает причины задержки native ~3 с / browser ~23 с или устранение
задержки. Текущие блокеры выпуска: #93 и #119. Production не изменён
этим пакетом, C05.11 не объявлять закрытой до эксплуатационной приёмки.

## 22.10.2026 — C04.01, шестая задача: проверка на одном замороженном источнике

В интеграционной ветке добавлена запускаемая регрессия
[теста C04.01](../packages/report-engine/tests/test_c04_frozen_metric_parity.py)
к существующему [probe](../.github/ci/economy_source_parity.py). Он читает
**один уже сохранённый и проверенный** source bundle; не выполняет новый Google
GET, не меняет книги, SQLite или Word-публикации. По всем восьми master,
двум способам и пяти периодам сверяются 480 значений TypeScript CalcEngine
и независимого Python metric_block: количество плана/факта, план/факт в
тыс. рублей, утверждённая по AD экономия и процент исполнения **по количеству**.
Отсутствующий знаменатель остаётся null; денежная погрешность ограничена
0,00000001 тыс. руб. Расчётный день закреплён в manifest и передан обоим
движкам, не вычисляется из текущего времени сервера.

Полный acceptance-режим дополнительно сверяет с тем же snapshot 480
показателей по ГРБС, 60 глобальных и 20 значений заголовка Dashboard
(год и **выбранный** квартал, не ошибочно квартал даты чтения), проверяет
совпадение ID/дня/года/версии правил в модели и Dashboard, а также
восстанавливает планы двух Word из модели и сравнивает видимое OOXML.
Всего 560 проверяемых значений модели плюс 480 TS/Python и два документа.
Неполный комплект артефактов, подмена headline/даты/снимка и правка
видимого Word блокируют приёмку. CI обнаруживает регрессию через существующий
pytest job report-engine без нового рабочего реестра или workflow.

Пример **только чтения на изолированной копии** сохранённого комплекта:

    python .github/ci/economy_source_parity.py --repo . \
      --bundle /private/frozen/snapshot_bundle \
      --report-model /private/frozen/report_model.json \
      --dashboard /private/frozen/dashboard.json \
      --word-main /private/frozen/main_report.docx \
      --word-management /private/frozen/management_report.docx

Статус этого дополнения: **изменения в исходниках и тестах записаны,
production ещё не принят**. Проверка final exact-head CI и реальный
API/BI/Word readback на одном установленном SHA обязательны отдельно;
предыдущие 480/480 E5 и свежие синтетические тесты не подменяют этот допуск.
Кандидат #129 остаётся заблокирован до общих двадцати критериев, backup/restore
и штатного owner release.

### C04.01 — HTTP-потребитель Dash без смешивания источников (22.10.2026)

В интеграции исправлен `/api/dashboard`: `summaryByPeriod` за год и четыре квартала теперь читается **одним** способом из уже рассчитанных master-метрик, вместо двух ветвей (`q1`/год из СВОД, остальные из master). Карточки ГРБС больше не берут запасные итоговые значения за другой год из официального СВОДа. Официальные ячейки и ранее сохранённые отчёты не меняются, остаются доступными в `officialMetrics` и независимой сверке. Источник, расчёт и хранение не дублированы; в HTTP-маршруте удалена одна из двух реализаций сборки итогов. Добавлены регрессии на сознательно расходящихся расчётных/официальных значениях, на `null` при отсутствующем master и на все пять периодов. Код/тесты в рабочей PR #79; CI final-head, связь установленного `snapshot_id`/`source_revision` с Word и реальный API/Word readback остаются выпускным gate. Статус: **IMPLEMENTED_IN_BRANCH**, не эксплуатационная приёмка.
