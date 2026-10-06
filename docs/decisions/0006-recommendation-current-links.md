# Recommendation links and fulfillment evidence

Status: accepted for implementation, 2026-09-30.

Recommendation origin, current procurement identity and fulfillment are independent
results. Old semantic statuses and legacy source numbers are not current evidence.

Automatic links require a verified historical text occurrence and independent
agreement of explicitly referenced business number, full subject, exact planned
amount, department and nonconflicting year. Multiple surviving rows stay ambiguous;
a number alone never establishes identity. Each resolved row must have a persisted
procurement UID. Group recommendations require all original members and explicit
replacement evidence; one replacement target does not prove group fulfillment.

Current procurement observations do not prove recommendation fulfillment. A date
in a plan register does not establish contract execution or payment. The executive
finding states only evidenced business facts. Technical candidates, rejected
matches and proof details remain in the diagnostic protocol.

Identity continuity must tolerate routine state updates without accepting reused
numbers or ambiguous entities. Stable subject/customer/year anchors require unique
agreement in both consecutive snapshots; unresolved changes preserve uncertainty.
Historical releases and identity observations remain immutable.

The stable plan signature includes source, department, customer, complete subject,
activity, planned date/year/quarter, planned budget components and their missing
data flags. Recorded dates, fact money, savings, method, procedure and comments are
state observations. Unique unchanged plan signatures across consecutive snapshots
can retain an existing UID when those state observations change. Reused numbers,
duplicate plan signatures and changed plans remain unresolved. The full semantic
signature still protects immutable snapshot content. A nullable database column
holds the new signature; old observations may be backfilled only by exact full
semantic hash and UID agreement with recovered original rows.

The private historical package supplies original DOCX bytes and text occurrences,
not current statuses or procurement links. Enrollment verifies the bytes, exact
cell, report date and department against each unchanged ledger text. It enriches
a copy of the ledger and preserves original responses and decisions. Ambiguous or
changed package contents fail closed. The frozen report evidence must retain these
original bytes, and a publication must recheck the enrolled package version.

Legacy plan backfill requires complete locator coverage of a verified saved donor.
The runtime automatically restores the latest import from sealed source payloads
before ingest. It never fills signatures from a current row that merely reuses a
number. The publication verifier independently reads the readonly identity SQLite
backup, checks its stored observation/result agreement and then checks full row
signatures against frozen source cells. ReportModel is not its own UID evidence.

The original-report parser retains at most one verified byte-keyed document in
memory to avoid reparsing the same historical file for every recommendation.
Unknown fulfillment remains in the diagnostic model; it is never printed as an
assessment of the department's performance. Historical decisions remain unchanged.

Integration preserves dated reviewed identity projections and their independent
snapshot/barrier token. Both automatic continuity paths require unique unchanged
plan evidence across old and new populations, including missing H/I/J flags.
When state fields also change, the plan fallback conservatively requires the same
business number. Pure renumbering with otherwise identical full semantics still
uses exact continuity. The readonly verifier projects only reviews dated no later
than the report cutoff; it does not rewrite frozen raw observations.


## Дополнение v8: доказанная строка совместной закупки

Групповая рекомендация может автоматически связаться с одной текущей строкой
только как доказанное отношение `MERGES_INTO`, а не как совпадение номера.
Проверенный оригинал должен целиком задавать все исходные номера, полный предмет и
общую сумму групповой закупки. В текущем первичном реестре допускается ровно одна
строка того же ГРБС со значением учреждения `Совместные закупки`, способом ЭА,
постоянным UID, точным полным предметом и той же явно заданной общей суммой.
Сумма здесь проверяет конкретную цель исходного предписания и не становится
универсальным ключом идентичности закупки.

Если в оригинале после исходных номеров указан отдельный номер результата в
скобках, он обязан совпасть с номером текущей строки; устаревший промежуточный
номер не заменяется догадкой по похожему предмету. Несколько кандидатов,
неполный предмет, иной способ, отсутствие UID или несовпадение суммы оставляют
связь недоказанной. Контракты v7 и старше при повторном воспроизведении сохраняют
прежнюю семантику.

## Дополнение v9: период первичного годового плана

Пустая плановая дата не означает, что год первичного реестра неизвестен.
Для связи рекомендации v9 допускает год из проверенного заголовка H2 основного
реестра: «Объем средств, предусмотренный муниципальной программой на 2026 год,
тыс. руб.». Заголовок должен целиком соответствовать этому формату с одним годом.
Он относится только к тому же источнику и листу; противоречащие годовые заголовки
не дают доказательства периода. Непустой год строки имеет приоритет и не заменяется
годом заголовка.

Это доказательство области годового плана применяется только к связи рекомендации.
Плановая дата и год строки остаются пустыми, финансовые расчёты и подписи
идентичности не изменяются. Полный предмет, исходный номер, ГРБС, постоянный UID
и единственность кандидата остаются обязательными. Для совместной цели также
обязательны явно заполненные H/I/J; кандидат без UID участвует в проверке
единственности, чтобы не скрывать неоднозначность.

Независимый аудит разделов и проверка публикации восстанавливают этот период
из замороженных первичных ячеек, а не из ReportModel. Контракты v1–v8 сохраняют
прежние правила периода при повторном воспроизведении. Результат архивного
пересчёта не удостоверяет свежесть источников для нового выпуска.
