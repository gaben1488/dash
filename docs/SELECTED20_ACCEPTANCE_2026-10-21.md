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

| ID | Код и проверяемая граница | Существующее доказательство | Что ещё нужно для исходного критерия | Статус 23.10 |
|---|---|---|---|---|
| C06.01 | [check-registry](../packages/shared/src/check-registry.ts), [signal-answer](../packages/shared/src/signal-answer.ts), [rule-book](../packages/shared/src/rule-book.ts), core pipeline signals | E1: future Q, no N, причина U, информационное позднее заключение; `signals.test.ts`, `ep-review-scope.test.ts`, `signal-answer.test.ts` | Подтвердить один жизненный цикл закрытия/false-positive во всех потребителях, включая мониторинг и сохранённый Word; новая установка и адресная приёмка. Общие подписи сами по себе этого не доказывают. | PARTIAL |
| C06.02 | [threshold-registry](../packages/shared/src/threshold-registry.ts): **WIP** `thresholdAt`/`freezeThresholds`; правовые ссылки отдельно от внутренних ориентиров | `threshold-registry.test.ts`; [источниковая дистилляция 44-ФЗ на 19.10.2026](data-audit/2026-10-22-44fz-c06-02-source-corpus.md) (211 стр., 123 статьи; правила пока source seed, не runtime); текущие новые проверки сообщает владелец интеграции | Завершить подключение dated/frozen выбора всех соответствующих потребителей; доказать, что старый срез не читает текущую настройку. `unverified` честно ограничивает вывод, но не доказывает проверенную редакцию нормы. | PARTIAL |
| C06.03 | Общие [product-dictionary](../packages/shared/src/product-dictionary.ts), [БЗ метрик](../packages/shared/src/metrics/registry.ts), EP clusters, formula-integrity, formula-defects | E2; PLAN: сохранённое покрытие имён управлений 4147/4147; `test_department_directory.py`, `formula-integrity.test.ts`, `formula-defects.test.ts` | Покрытие имён организаций не является покрытием оснований ЕП. Нужны предметные редактируемые основания/этапы/сезонность/правила, guided input с контекстным комментарием, измерение их словарей, согласованный экспорт правил DOCX/Markdown. В просмотренных маршрутах/Settings это целиком не подтверждено. | PARTIAL |
| K02.01 | [scorer](../packages/core/src/trust/scorer.ts), validate/formula-integrity → сохранённый coverage; [check-coverage](../packages/shared/src/check-coverage.ts) **WIP**, web trust-metrics | E1: неизвестное не равно 100, старый current fallback пересчитан без переписывания исторического snapshot; E2: expected/checked/failed | Завершить проверку фильтрованных знаменателей и всех UI/API потребителей. **WIP** нельзя считать выпущенным. Старые исторические результаты должны оставаться историческими, без выдуманного нового охвата. | PARTIAL |
| C05.02 | [общие схемы](../packages/shared/src/schemas.ts), dashboard/Report API parsing, calc-engine adapter, арифметические правила с `passed=null` | E1: обязательные 26 полей периода, отсутствие поля отклоняется; PLAN: 131 реальный периодный блок прочитан, 9,74 МБ проверяются за 131–476 мс; missing denominator/source отдельно от нуля | Установка и проверка выбранных экранов/экспортов на общей модели. Нельзя переносить доказательство dashboard DTO на все произвольные API. | PARTIAL |
| C04.01 | [calc-engine](../packages/core/src/pipeline/calc-engine.ts), unifiedGrid, [canonical_metrics.py](../packages/report-engine/src/procurement_engine/canonical_metrics.py), общий день Камчатки | E1/PLAN: 360 core + 7 server, 62 Python; граница дня, future/today Q, signed AD; shared source-value fixtures | Зафиксировать независимое сравнение одной версии исходных строк между API/BI/Word после общей интеграции C08.02; не использовать разные моменты чтения. | BLOCKED |
| C04.02 | [money-units](../packages/shared/src/money-units.ts), [parse-sheet-date](../packages/shared/src/parse-sheet-date.ts), Python normalize, общий source-value fixture | E1: 115 Python и shared контрпримеры; `test_source_value_contract.py`, money/date/activity tests. Числовые хвосты, Infinity, дробный serial и год вместо даты различены | Сохранить общий fixture в итоговом CI. Проверить сохранённые доказательства всех перечисленных единиц/процентов, не считать паритет парсеров автоматическим паритетом всех метрик. | PARTIAL |
| C04.03 | [scatter-scope](../packages/web/src/lib/scatter-scope.ts), `routes/rows-scatter.test.ts`, аналитика конкурентности | E1/PLAN: snapshot cutoff вместо текущего дня, граница Камчатки, scope tests; лимитная разница отделена от AD-экономии | Нужна зафиксированная точка «исходная строка → API → облако/CostOfRefusal» с unknown method и no-AD. Старый scatter не должен возвращаться через соседний consumer. | PARTIAL |
| C03.01 | [rows-filters](../packages/server/src/services/rows-filters.ts), [filter-context](../packages/web/src/lib/filter-context.ts), selectors, period-params, snapshot-year-scope | E1: strict year/scope, 90 адресных API-проверок; `budget-filter`, `org-scope`, `kpi-filtering`, `time-scope` tests | Нужна единая матрица сочетаний activity/method/budget/org/period и инварианта «части = целое», включая legacy fields. Отдельные тесты фильтров не доказывают все сочетания. | PARTIAL |
| C05.01 | [STANDARD_METRICS/DERIVED](../packages/core/src/pipeline/calc-engine.ts), [общая БЗ](../packages/shared/src/metrics/registry.ts), [metric-provenance](../packages/shared/src/metric-provenance.ts), MetricProvenance UI | E1: устранён второй квартальный денежный расчёт под именем количества; quarter-execution/dashboard tests; E2: общая БЗ и подписи | Исполняемый реестр уже есть — строить второй не нужно. Однако БЗ (`formula`/`source` строками), исполняемая формула и runtime provenance остаются разными контрактами. Не доказан общий результат с grain/scope/dependencies/version и раскрытием **каждого** числа до тех же строк в карточке/таблице/графике/Word. | PARTIAL |
| R05.01 | [department_directory.json](../packages/report-engine/src/procurement_engine/department_directory.json), [source_contract.py](../packages/report-engine/src/procurement_engine/source_contract.py), schema_migrations, shared data-sources/department-registry | E2: один каталог управлений/алиасов; `test_schema_migrations.py`: геометрия, immutable backup, неизвестная миграция, конкурентная смена registry | Каталог управлений не равен каталогу source profiles. Нужен единый проверяемый контракт fileId/sheetId/роль/поля/единицы/обязательность/зависимости/права и паритет адаптеров 19/32/34 и исторических схем TS/Python. `source_contract.py` сам содержит fingerprint/perimeter, не всю эту модель. | PARTIAL |
| R05.03 | source-refresh → сохранённые primary rows/coverage → потребители; [source-coverage](../packages/shared/src/source-coverage.ts) | PLAN: `af5b`, 6156 TS/1210 Python, exact release/source/API readback; E1: alias/failure/known-empty регрессии | Прежнюю приёмку primary чтения сохранить; проверить только интеграционное отсутствие регрессии. Не объявлять этим закрытыми отдельные schema/channel критерии R05.01/02. | BLOCKED |
| C08.02 | [snapshot-calculation-context](../packages/server/src/services/snapshot-calculation-context.ts) **WIP**, source_context.py, snapshot-calculation, issue-decisions | Существующий Python context; E1 общий календарь. Новый TS context хеширует входы/профили/код, сохраняет thresholds и productDay | **WIP**: проверить точную инвалидацию rules/day/access/decisions, повторное чтение сохранённого контекста. `access=full-dataset`/`decisions=not-applied` допустимы как описание стадии, но сами по себе не проверяют последующую проекцию/изменение доступа. Отделить instant наблюдения от календарной зависимости вычисления. | PARTIAL |
| C05.04 | [snapshot-read-model.test](../packages/server/src/services/snapshot-read-model.test.ts), reader/cache/worker; request timing | E1: bounded reads, прошлый пригодный snapshot при отказе источника, worker tests; PLAN сохраняет предыдущие медленные измерения | Нет принятого парного cold/warm/worker-concurrent результата в исходном бюджете для текущей реализации. Это практический критерий, а не необходимость повторить все тесты. Недоступность Google не должна удерживать готовое чтение. | NOT VERIFIED |
| C05.11 | [request-timing](../packages/server/src/plugins/request-timing.ts): reader/model/contract, serialization, process CPU и event-loop lag; source timing | `request-timing.test.ts`; PLAN: native/browser замеры и известная стоимость 9,74 МБ; E1 | Просмотренный HTTP plugin не выделяет полный Google/normalize/SQL/proxy путь. Нужна связанная атрибуция и парные замеры при одинаковых лимитах и worker. Старые 3/23 секунды и новый unit-test не доказывают устранение причины. | NOT VERIFIED |
| R08.03 | webhook-queue, source-refresh gate, queue-flow/unavailable | PLAN: приёмка 21.10, 36 тестов и настоящие SQLite-отказы; retry ограничен тремя, уведомление сохраняется | Локальный исходный критерий принят; подтвердить включение и итоговую установку, не переоткрывать без новой регрессии. | BLOCKED |
| R09.02 | [runtime_artifact](../.github/ci/runtime_artifact.py), [runtime_passport](../.github/ci/runtime_passport.py), controlled release | E4 build-once/installed IDs; E3 добавляет mixed-component passport и исходные архивы без повторного export | Нужен паспорт **финального** общего SHA, не перенос E4 на новые коммиты. После web-only backend SHA отдельно от UI SHA. | BLOCKED |
| R09.03 | [release-controller](../deploy/release-controller.py), [release_recovery](../deploy/release_recovery.py), [workflow](../.github/workflows/vps-cache-cleanup.yml), [runbook](../deploy/README.md#обновление-и-выпускной-допуск) | E3: web-only без server/worker mutation, concurrent DB сохранена, owner loss до/после acceptance, config drift, настоящий Git rename reader → полный путь | Код интегрирован; первая установка механизма сама требует полного пути. Не выдавать mocked Docker fixtures за production web-only испытание. Финальная runtime приёмка отдельна от локального критерия совместимости. | BLOCKED |
| R01.01 | PLAN + эта матрица, исходные criteria/ID, git SHA, E1–E4 | Все выбранные 20 ID перечислены без замены мелкими фикcами; доказательства кода/проверок/установки разделены | Дополнить финальным SHA/приёмкой и оставшимися доказательствами. Эта выборка не объявляет автоматически полным traceability всех 56 результатов/142 подзадач. | PARTIAL |
| R01.05 | Один владелец интеграции: `codex/report-identity-20261021`; компонентный пакет включён `fb9f0c65`; прикладной CI отдельно от OPS | E1–E4; PLAN явно хранит scoped43 PASS и OPS discovery529: 9 failures/31 errors/95 skips | Поимённо завершить причины старого OPS baseline либо приложить уже существующее завершение; проверить конкурирующие PR/patch и актуальность #69. В этой сверке GitHub не перепроверялся. Полный release после двадцати, не параллельный второй rollout. | PARTIAL |

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

В интеграции исправлен `/api/dashboard`: `summaryByPeriod` за год и четыре квартала теперь читается **одним** способом из уже рассчитанных master-метрик, вместо двух ветвей (`q1`/год из СВОД, остальные из master). Карточки ГРБС больше не берут запасные итоговые значения за другой год из официального СВОДа. Официальные ячейки и ранее сохранённые отчёты не меняются, остаются доступными в `officialMetrics` и независимой сверке. Источник, расчёт и хранение не дублированы; в HTTP-маршруте удалена одна из двух реализаций сборки итогов. Добавлены регрессии на сознательно расходящихся расчётных/официальных значениях, на `null` при отсутствующем master и на все пять периодов. Код/тесты в рабочей PR #79; CI final-head, связь установленного `snapshot_id`/`source_revision` с Word и реальный API/Word readback остаются выпускным gate. В metadata снимка сохраняется `sourceRevision`, совпадающая с `report_model.snapshot.source_revision`, **только** если все восемь master имеют тот же полный принятый capture и верные providerId. Один и тот же `readAt` всех восьми master используется как фактический `asOf` Dash; сдвиг чтения экрана через полночь Камчатки больше не меняет факт/AD-гейты для принятого захвата. Адресная/ручная правка удаляет свидетельство у нового снимка; исторический immutable snapshot его сохраняет. Это метка общего master-входа, а не обещание равенства даты/правил/периода или отдельного листа «СВОД». Только новые модели с `contract.source_revision_projection=v1` переносят тот же `source_revision` в `dashboard.json`/представления Word; старые опубликованные модели и оригинальные JSON/DOCX сохраняют прежний формат и остаются доступными.  проверка publication/projection и C04.01-probe отказывает при несовпадении ревизии между source bundle, ReportModel и dashboard.json. Тест проверяет положительный приём, сохранение после записи в SQLite и снятие доказательства при изменении. Реальный выпуск по-прежнему требует exact-head и Word/API сравнения. Статус: **IMPLEMENTED_IN_BRANCH**, не эксплуатационная приёмка.


## 23.10.2026 — граница CI и эксплуатационной приёмки

Статусы внесены прямо в существующие двадцать строк матрицы:
PARTIAL — часть исходного результата доказана, но не весь критерий;
BLOCKED — известный выпускной/эксплуатационный gate не пройден;
NOT VERIFIED — требуемого сопоставимого эксплуатационного измерения нет.
DONE по полному исходному критерию нет. Сохранённые локальные доказательства
R08.03 и frozen C04.01 не отменяются и не выдаются за новое развертывание.

В CI `39763876367` release candidate
`73c7018beccf75665f91a50cb1b18e5e17e93323` выявлены Ruff I001
и устаревшее синтетическое ожидание `if test ... !=` в качестве первого
SHA-gate вместо фактического раннего `test ... =`. PR79 до исправления
`2cbffa04534425a53ab2a0d892b5167f78284fe1` содержит тот же тест и незагруппированный импорт
`captured_source_revision`. Исправления касаются только порядка импортов
и тестовой проверки **трёх** обязательных HEAD-guard (ранний / ожидание CI /
после CI), без отключения проверки неподходящего SHA, удаления предметных
assertions или ослабления release workflow. Exact-head CI проверяется отдельно.
Read-only VPS паспорт `39755961280` (22.10, 09:30 UTC) не подтверждает
современный runtime: #119/#93 по-прежнему открыты.


## 23.10.2026 — reconcile 41 commits main ↔ integration #176 (static code evidence)

Срез сравнения: `main@c4b792afb120b106c5423594c272fb076fa10f50` против `integration/consolidated-modern-20261023@1d0beebe32c4f2c64157f754ec100669e9439f43`; общий предок `0f3b92d661b6db43c6ca9241ec56ec4371354c74`. Все 41 REST commit diff проверены; 37 файлов от общего предка: 7 byte-identical, 29 отличаются (в т. ч. расширены), 1 legacy owner bridge отсутствует. **Это статическая трассировка функций и тестов, не CI PASS, не runtime/release acceptance и не отметка DONE для двадцати задач.** Исторические SHA не cherry-pick автоматически: итоговая реализация может быть строже. Обозначение «ВКЛЮЧЁН ПО СМЫСЛУ» требует независимого exact-head CI до допуска.

| № | SHA main | Решение | Основание и путь в текущем интеграторе |
|---:|---|---|---|
| 1 | [`730cbe76c2`](https://github.com/gaben1488/dash/commit/730cbe76c2272010b4e06ebc42b6eed71c893e94) | ЧАСТИЧНО / РЕЛИЗНЫЙ ГЕЙТ | Глубокая проверка API/UI перенесена; разрешение app-only деплоя устарело. `routes/source-integrity.ts; Settings.tsx; source-integrity.test.ts` |
| 2 | [`bcfbcd4a7e`](https://github.com/gaben1488/dash/commit/bcfbcd4a7e5a406379a9a2ea8ea9ec68461f8598) | ВКЛЮЧЁН ПО СМЫСЛУ | Пустой список книг не может дать complete=true. `routes/source-integrity.ts; source-integrity.test.ts` |
| 3 | [`68232d8105`](https://github.com/gaben1488/dash/commit/68232d8105469276e81e132d6500e9183621d6c7) | ВКЛЮЧЁН ПО СМЫСЛУ | SSH использует Bash set -euo pipefail и script_stop:false. `.github/workflows/ci.yml` |
| 4 | [`33ff8af9eb`](https://github.com/gaben1488/dash/commit/33ff8af9eb716d2662baf8b1b306197e7c2882cf) | ВКЛЮЧЁН ПО СМЫСЛУ | Шапка 1–3 исключена из ядра и UI без удаления истории. `core/formula-integrity.ts; web/formula-defects.ts и тесты` |
| 5 | [`602d937dee`](https://github.com/gaben1488/dash/commit/602d937dee37bf594f2752a1693c031f85ed2f77) | ВКЛЮЧЁН ПО СМЫСЛУ | Сообщение deploy OK следует после успешного curl health. `.github/workflows/ci.yml` |
| 6 | [`75e811b718`](https://github.com/gaben1488/dash/commit/75e811b71824250f154958fe7373d452097ada9d) | ВКЛЮЧЁН ПО СМЫСЛУ | Решение durable fail-closed сохранено и расширено. `docs/decisions/0012-durable-source-integrity-observations.md` |
| 7 | [`cb5e91813b`](https://github.com/gaben1488/dash/commit/cb5e91813b2e167baf8c1c83d3875fca857c9fe8) | ВКЛЮЧЁН ПО СМЫСЛУ | RED/GREEN SQLite: рестарт, ошибка, чужой sourceId, version drift. `services/source-integrity-state.test.ts` |
| 8 | [`8796c07d89`](https://github.com/gaben1488/dash/commit/8796c07d891ea9e2cb1922d948f10b7c71e5a43e) | ВКЛЮЧЁН ПО СМЫСЛУ | Атомарный журнал контроля; checker formula-integrity/2 вместо устаревшего /1. `services/source-integrity-state.ts` |
| 9 | [`d04c83cc5e`](https://github.com/gaben1488/dash/commit/d04c83cc5e793b169b06779879b80056e8481e75) | ВКЛЮЧЁН ПО СМЫСЛУ | Схема source_integrity_state присутствует, добавлены иные поля. `db/schema.ts` |
| 10 | [`b09ac0cac3`](https://github.com/gaben1488/dash/commit/b09ac0cac3da350402aab7c6f06c89d9880ceca4) | ВКЛЮЧЁН ПО СМЫСЛУ | DDL и upgrade существующей SQLite сохраняют источник без destructive миграций. `db/ddl.ts; db/ddl.test.ts` |
| 11 | [`62c29aa595`](https://github.com/gaben1488/dash/commit/62c29aa59535474d62e8d4912faf287c7839751a) | ВКЛЮЧЁН ПО СМЫСЛУ | Выполнение и попытка доставки формул связаны одним сохранённым исходом. `services/source-refresh.ts; source-refresh-formulas.test.ts` |
| 12 | [`f83861ab60`](https://github.com/gaben1488/dash/commit/f83861ab6061b111f3c0d666e6c2410f8af4ee7c) | ВКЛЮЧЁН ПО СМЫСЛУ | После рестарта восстанавливается исходный вердикт, не новый успех. `services/formula-sink.ts; source-integrity-state.test.ts` |
| 13 | [`0414f823cc`](https://github.com/gaben1488/dash/commit/0414f823cc955017aba36eb12b56ad25813dacb5) | ВКЛЮЧЁН ПО СМЫСЛУ | Последняя попытка метаданных восстанавливается, ошибки видны. `services/metadata-watch.ts; source-integrity-state.ts` |
| 14 | [`704166597f`](https://github.com/gaben1488/dash/commit/704166597fb22de87d23bc31a7799779d0b93fb3) | ВКЛЮЧЁН ПО СМЫСЛУ | Restore и formula sink до фоновых обходов/webhook. `server/app.ts` |
| 15 | [`c374cfa934`](https://github.com/gaben1488/dash/commit/c374cfa934f30776a6600bd44ac70e79edd976bf) | ВКЛЮЧЁН ПО СМЫСЛУ | Deep-check требует persisted и вердикт именно своего цикла. `routes/source-integrity.ts; source-integrity.test.ts` |
| 16 | [`d2b92ea7d3`](https://github.com/gaben1488/dash/commit/d2b92ea7d33ba7571c433280e557c126edb6eefe) | ВКЛЮЧЁН ПО СМЫСЛУ | Typed sample дефекта сохранён в регрессиях. `services/source-integrity-state.test.ts` |
| 17 | [`7537d33c3a`](https://github.com/gaben1488/dash/commit/7537d33c3aae0be7f39503aefd5aef5c73c0ec8e) | ВКЛЮЧЁН ПО СМЫСЛУ | Изоляция хранения/моков в тестах формул сохранена. `services/source-refresh-formulas.test.ts` |
| 18 | [`871f955e56`](https://github.com/gaben1488/dash/commit/871f955e56fffc1b487f4d1cf913b36bbb7463cf) | ВКЛЮЧЁН ПО СМЫСЛУ | Изоляция журнала в route-тестах сохранена. `routes/source-integrity.test.ts` |
| 19 | [`45ae31017d`](https://github.com/gaben1488/dash/commit/45ae31017d962cad22ce760ac596963081b40d71) | ВКЛЮЧЁН ПО СМЫСЛУ | Негативные тесты persisted:false и wrong timestamp сохранены с иными именами. `routes/source-integrity.test.ts` |
| 20 | [`ac2c3473c0`](https://github.com/gaben1488/dash/commit/ac2c3473c0f3dfd396c558a3e1cddf7c9f29ab88) | ВКЛЮЧЁН ПО СМЫСЛУ | Тип callback возвращает verdict либо undefined (не void). `services/source-refresh.ts` |
| 21 | [`2e45040bae`](https://github.com/gaben1488/dash/commit/2e45040bae239e9e1ca476a11da95587f34cf9e0) | ВКЛЮЧЁН ПО СМЫСЛУ | Тестовый callback возвращает undefined. `services/source-refresh-formulas.test.ts` |
| 22 | [`00c35cbd0e`](https://github.com/gaben1488/dash/commit/00c35cbd0ea5225479576cc78b2ba7c3c43dde48) | ВКЛЮЧЁН ПО СМЫСЛУ | LastAttempt и lastConfirmed хранятся отдельно. `services/source-integrity-state.ts` |
| 23 | [`5c026e207e`](https://github.com/gaben1488/dash/commit/5c026e207e7348af49ae98a51c676f881431bb0f) | ВКЛЮЧЁН ПО СМЫСЛУ | LastConfirmed восстанавливается даже при failed latest. `services/metadata-watch.ts` |
| 24 | [`6d92950bf6`](https://github.com/gaben1488/dash/commit/6d92950bf6c3e9c372bfa682160e28ed42f2e4c2) | ВКЛЮЧЁН ПО СМЫСЛУ | API отдаёт metadata.lastConfirmed. `routes/source-integrity.ts` |
| 25 | [`ae6aec4dde`](https://github.com/gaben1488/dash/commit/ae6aec4ddeb9fd1ac8ea4b1b31e16db0183bb9d5) | ВКЛЮЧЁН ПО СМЫСЛУ | Негативный тест не теряет подтверждённый drift. `services/source-integrity-state.test.ts` |
| 26 | [`59e4119aab`](https://github.com/gaben1488/dash/commit/59e4119aab27cfbb272e601808f5175f7e2318cf) | ВКЛЮЧЁН ПО СМЫСЛУ | ADR сохраняет разницу confirmed/attempt. `docs/decisions/0012-durable-source-integrity-observations.md` |
| 27 | [`fb2ca8a47f`](https://github.com/gaben1488/dash/commit/fb2ca8a47f310ccbe64e39c03688de1cb21317fe) | ВКЛЮЧЁН ПО СМЫСЛУ | Route-тест включает lastConfirmed отдельно от current. `routes/source-integrity.test.ts` |
| 28 | [`d611df93b6`](https://github.com/gaben1488/dash/commit/d611df93b6e9200fd2a1cd79bc37d6a982b1356b) | ВКЛЮЧЁН ПО СМЫСЛУ | Отказ чтения SQLite деградирует integrity, не весь сервер. `services/source-integrity-state.ts` |
| 29 | [`b791504046`](https://github.com/gaben1488/dash/commit/b791504046ce93d84f10192fb85e51c5ea51f7f1) | ВКЛЮЧЁН ПО СМЫСЛУ | Восстановление реального verdict cache после очистки RAM покрыто. `services/source-integrity-state.test.ts` |
| 30 | [`2e326b0647`](https://github.com/gaben1488/dash/commit/2e326b0647de218e3e7af05eae040ec4f7d613c2) | ВКЛЮЧЁН ПО СМЫСЛУ | SQL error в публичной диагностике редактируется. `services/source-integrity-state.ts` |
| 31 | [`d9c837952e`](https://github.com/gaben1488/dash/commit/d9c837952eced208e7fcdc1c003c19456e4d9a22) | ВКЛЮЧЁН ПО СМЫСЛУ | Отказ Google фиксирует несостоявшуюся попытку, не стирая проверенный факт. `services/source-refresh.ts` |
| 32 | [`64463e20c3`](https://github.com/gaben1488/dash/commit/64463e20c3f7f514e8d7f76569747357df270b7c) | ВКЛЮЧЁН ПО СМЫСЛУ | Негативные тесты Google/SQLite fail-closed представлены. `services/source-refresh-formulas.test.ts` |
| 33 | [`39f0a858fc`](https://github.com/gaben1488/dash/commit/39f0a858fccf0a8227c341a84af625e5513f4728) | ВКЛЮЧЁН ПО СМЫСЛУ | formulasRead:false не превращается в прочитанные формулы. `services/source-refresh.ts; routes/source-integrity.ts` |
| 34 | [`948cdd89cf`](https://github.com/gaben1488/dash/commit/948cdd89cffd633150c5b84f7bbe7e2e6f7114b3) | ВКЛЮЧЁН ПО СМЫСЛУ | Граница СВОД 278, 279+ эксперимент; core rules и context тесты. `shared/constants.ts; core/validate.ts; validate.test.ts` |
| 35 | [`5bedf74f66`](https://github.com/gaben1488/dash/commit/5bedf74f66dcfb01f93d75a72ffb4df40f0af705) | ВКЛЮЧЁН ПО SHA | Файл one-off SQLite online backup совпадает побайтно (Git blob SHA). `deploy/source-integrity-release.py` |
| 36 | [`444f9785a6`](https://github.com/gaben1488/dash/commit/444f9785a67b4fb71c58e60bcfc737136cd6bcd5) | ВКЛЮЧЁН ПО SHA | WAL / wrong-db / free-space тест совпадает побайтно. `.github/ci/test_source_integrity_release.py` |
| 37 | [`3932b1e42f`](https://github.com/gaben1488/dash/commit/3932b1e42f2a7e06b966de0e8aa4c2e6b7688f8d) | ЧАСТИЧНО / РЕЛИЗНЫЙ ГЕЙТ | One-off integrity-only ветка старого deploy не переносится как bypass; full exact-SHA backup/readback всё ещё требует runtime gate. `.github/workflows/ci.yml; deploy/source-integrity-release.py` |
| 38 | [`c72bf952f4`](https://github.com/gaben1488/dash/commit/c72bf952f40f2e612b8fad68cf0b51ab04e84725) | ВКЛЮЧЁН ПО СМЫСЛУ | Merge #104 не добавляет независимых требований сверх 6–37; source state и backup присутствуют. `services/source-integrity-state.ts; deploy/source-integrity-release.py` |
| 39 | [`2ee818b4a4`](https://github.com/gaben1488/dash/commit/2ee818b4a47bb2e027d2880f5e41403fdc190e4a) | ВКЛЮЧЁН ПО СМЫСЛУ | Legacy main auto-deploy исключён; current gate только workflow_dispatch, exact SHA+backup. `.github/workflows/ci.yml` |
| 40 | [`9d0cedaee5`](https://github.com/gaben1488/dash/commit/9d0cedaee51483bc0430200354ba6820a7681295) | ВКЛЮЧЁН ПО СМЫСЛУ | Составные A=173/18 и 121/1 проходят через readProcurementSequence; тесты расширены. `core/classify.ts; core/row-numbering.test.ts; shared/sequence-integrity.ts` |
| 41 | [`c4b792afb1`](https://github.com/gaben1488/dash/commit/c4b792afb120b106c5423594c272fb076fa10f50) | ИСКЛЮЧИТЬ КАК УСТАРЕВШИЙ | Owner bridge жёстко привязан к PR79 и старой ветке; буквальный перенос откроет неверный релизный путь. Новый bridge требует отдельной exact-HEAD проверки. `.github/workflows/integrated-owner-maintenance-bridge.yml (отсутствует намеренно)` |

**Граница:** буквальный перенос старого owner bridge/одноразового app-only deploy запрещён до сверки с текущим контроллером; текущие 41 коммита не являются доказательством эксплуатации. Открытые gate: full exact-SHA CI на текущем PR #176; source/Word/API parity и backup/readback с сохранением report-worker; состояние VPS/#119/#93; подтверждение владельцем. При провале CI статус соответствующей строки пересматривается, не объявляется DONE.
