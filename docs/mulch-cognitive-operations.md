# Mulch — четыре когнитивных операции

> Дата исходной рамки: 2026-04-19
> Last verified: 2026-06-04
> Контекст: внедрение операционной модели cognee (`remember / recall / forget / improve`) поверх
> существующего mulch без замены инструмента. Это организационный апгрейд, не новый код.

## Что это

Cognee предлагает **четыре базовые операции** для memory-движка AI-агента:

| Cognee operation | Описание | Mulch-аналог сейчас | Что добавить |
|---|---|---|---|
| **remember** | Зафиксировать факт / решение / правило в долгосрочной памяти | `ml record <domain> --type ...` | Есть, переименование не нужно |
| **recall** | Извлечь по запросу: «что мы знаем про X?» | `ml search "<query>"` + `mulch prime` | Есть, добавить семантический слой через `scripts/semantic_search.py` |
| **forget** | Удалить устаревшую запись (была верной, теперь неверна) | `ml delete <domain> --records <id>` | Есть, но дисциплина слабая |
| **improve** | Объединить две близкие записи в одну, supersede старую | Отсутствует как операция | Создать дисциплину слияния |

Все четыре операции на одном уровне абстракции. Каждое действие с памятью должно
быть либо новым знанием, либо извлечением, либо забыванием, либо улучшением.

## Safety Note 2026-06-04

Предыдущая длинная версия этого документа была удалена во время консолидации
memory-документов. Это было слишком агрессивно: часть текста действительно
дублировала другие документы, но операционная модель оставалась полезной.
Текущая версия восстанавливает исходную рамку и добавляет явные правила
безопасного удаления.

Mulch может содержать rough working memory. Product documentation не должна
жить только в `.mulch/`. Когда память становится стабильной истиной проекта,
переноси её в canonical docs: `README.md`, `docs/ARCHITECTURE.md`,
`docs/DATA_SOURCES.md`, `docs/METRICS_CONTRACT.md`, затем оставляй в mulch
только ссылку или удаляй устаревшую запись.

## Rules

1. Перед добавлением памяти сначала ищи существующую запись.
2. Любой durable claim должен иметь evidence: code path, document path,
   transcript, commit, spreadsheet/source id.
3. Не хранить secrets, tokens, credentials или private production data в `.mulch/`.
4. Не превращать `.mulch/` в product docs. Если информация нужна пользователю,
   maintainer или reviewer, продвигай её в `docs/`.
5. Удаляй память только после проверки replacement или irrelevance.
6. Если удаление меняет то, как будущий agent должен понимать проект, оставляй
   decision trail.
7. Один точный record лучше нескольких перекрывающихся.

## §1. Remember

```bash
ml record <domain> --type convention|pattern|failure|decision|reference|guide \
                   --description "..." \
                   [--evidence-commit SHA] [--evidence-bead ID]
```

Дисциплина:

- Перед `ml record` обязательно `mulch search "<тема>"`, чтобы не плодить дубли.
- Если близкая запись найдена, делай `improve`, а не новый `remember`.
- Записывай важные уроки внутри работы, не только в конце сессии.

## §2. Recall

### Сейчас

`ml search "query"` — точный текстовый поиск по полю description. Он хорош для
известных терминов, но плохо работает для парафразов.

`mulch prime` загружает expertise-records в контекст автоматически.

### Семантический слой

```bash
python scripts/semantic_search.py "as-of дата исполнения" --top 8
```

Использовать, когда:

- забыл точное название термина;
- ищешь концептуально близкое: trust score, надёжность данных, доверие к данным;
- grep дал слишком много шума.

Не использовать, когда:

- знаешь точный path или имя файла;
- ищешь по коду, где `rg` точнее.

### Приоритет recall

```text
точное имя файла  -> Read
точная строка     -> rg
смысловой запрос  -> semantic_search.py
тактический урок  -> ml search
полный контекст   -> mulch prime / SessionStart
```

## §3. Forget

### Проблема

Mulch-record «mx-abfa44 audit 4.8/10» может жить рядом с актуальным
«mx-ccaa11 audit 4.76/10». Оба были правдивыми в своё время, но вместе дают
конфликт. Контекст загружает оба, модель видит противоречие и выбор становится
случайным.

### Явная операция forget

```bash
ml delete <domain> --records <id>
```

Когда forget:

- новая запись supersedes старую;
- факт стал неверен: дата прошла, метрика обновилась, инфраструктура сменилась;
- запись была предположением и опровергнута данными;
- запись дублирует canonical docs и больше не добавляет контекст.

Триггер для forget:

- При `ml record` найдено, что новая запись supersedes старый ID.
- Раз в неделю в close ritual: `ml learn` + проверка top старых записей по
  `recorded_at` на актуальность.

Не forget:

- исторические decisions, если они объясняют почему проект устроен именно так;
- факты, которые всё ещё верны, но плохо написаны. Это `improve`, не `forget`.

## §4. Improve

### Проблема

Через 100+ records темы размазываются на 3-5 близких записей: «mulch работает»,
«mulch — это .mulch/expertise/jsonl», «mulch prime инжектит в контекст»,
«mulch sync коммитит». Все правдивые, но фрагментарные.

### Решение

Шаги improve:

1. Найти близкие записи через `mulch search "<topic>"` или `semantic_search.py`.
2. Если найдено три или больше близких записи, составить одну consolidated запись.
3. Записать новую через `ml record` с описанием `consolidates: id1, id2, id3`.
4. Удалить старые через `ml delete --records <id1> <id2> <id3>`.
5. Если content стал project truth, перенести truth в `docs/`, а mulch оставить
   как trace discovery.

Метрика: после improve количество active expertise по теме сокращается с N до 1.

Когда improve:

- после глубокой работы по теме;
- при обнаружении противоречия между несколькими records;
- когда memory note стал слишком длинным и должен быть разделён на canonical doc
  + короткий pointer.

## §5. Close Protocol

```bash
ml learn                          # что изменилось
ml search "<keywords из learn>"   # уже знаем?
# Если новое:
ml record <domain> --type ... --description ...
# Если близкое к старому:
ml delete --records <old>          # forget
ml record ... --description "consolidates: <old>, <new content>"  # improve

# Проверка устаревшего:
ml search "audit" --recent 90d
ml delete --records <obsolete>

ml sync
```

Перед окончанием substantial pass:

1. Записать только решения или открытия, которые понадобятся позже.
2. Merge/delete notes, созданные во время прохода и уже superseded.
3. Sync canonical docs, если memory раскрыла стабильную истину проекта.
4. Оставить repo так, чтобы следующий agent начинал с code, docs и tests, а не
   с transcript archaeology.

## §6. Зачем это нужно

Без рамки mulch становится набором записей разных эпох, иногда противоречивых.
Через несколько месяцев prime тонет в шуме.

С рамкой каждое касание памяти — одно из четырёх действий. `forget` и `improve`
такие же first-class операции, как `remember`.

Не нужно внедрять cognee целиком: cognee требует отдельный Python runtime, API,
Neo4j. Для `dash` достаточно mulch (`jsonl + git`) и локального semantic search.

## §7. Метрики дисциплины

| Метрика | Цель | Сигнал |
|---|---|---|
| `mulch_age_p50` | < 30 days | если > 60, forget overdue |
| `mulch_contradictions` | 0 | semantic similarity >= 0.9 между active records = warning |
| `mulch_consolidation_ratio` | > 0.8 | близко к 1 значит тема не размазана по дублям |

Пока считать вручную.

## Current Project Boundary

Для `dash` расчётная истина принадлежит этим местам:

- `docs/METRICS_CONTRACT.md` — formulas, gates, examples, UI usage.
- `docs/DATA_SOURCES.md` — production Google Sheets and forbidden sources.
- `packages/core/src/metrics/registry.ts` — executable metric metadata.
- `packages/core/src/pipeline/` — calculation behavior and regression tests.

Mulch может помнить, как эти истины были найдены, но не должен быть единственным
местом, где они существуют.

## Restoration Trail

2026-06-04: исходная версия была восстановлена после ошибочного удаления.
Backup старой версии и текущего merge лежит в `docs/deleted-backups/2026-06-04/`.
