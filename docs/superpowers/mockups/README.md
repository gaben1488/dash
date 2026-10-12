# Семейство макетов — указатель

Ревизия 29.08.2026 под §21.1 (канон `../specs/2026-08-22-pulse-feedback-2.md`)
и матрицу зари (`../specs/2026-08-29-zarya-matrica.md`). Статус «кандидат на
удаление» — предложение: решение за владельцем, файлы не удалены.

## mockups/

| Файл | Роль | Статус | Несёт § канона |
|---|---|---|---|
| `pulse.html` | живой мега-макет Пульса (правит сосед — здесь не трогался) | живой | вся спека целиком |
| `zarya-arheologiya.html` | археология рецепта зари по гиту (эпоха 853548a), доказательная база | живой, исторический документ | §20, §20.0, §20.1 — рецепт канонизирован |
| `otdelki.html` | галерея шести машинных отделок на утверждённых цветах; источник §3 матрицы | живой | §21 п.2, §21.1 п.6 + §3 матрицы (порядок внедрения) |
| `efir-uzel-schita.html` | узел эфира в шапке по методу щита (кусок CSS/HTML) | живой, хранится каноном | §21.1 п.7 («сохранён от потери») |
| `ugol-otbora-krupno.html` | дом угла отбора — крупно, со всеми состояниями | живой, ждёт слова владельца (А/Б/В); краска рода — орхидея до §21.1, пометка в шапке | §21.1 п.8 («дома сохранены») |
| `ugol-v-linejke-demo.html` | дом угла отбора — в составе линейки периода | живой, ждёт слова владельца (А/Б/В); пометка в шапке | §21.1 п.8 |
| `ugol-varianty.html` | три варианта угла (А нынешний · Б прибор со счётом, рекомендован · В жетоны) к разбору `2026-08-29-ugol-otbora-analiz.md` | живой, ждёт решения владельца; вариант А — исторический образец, краска «отобраны» переведена на зарю | §21.1 п.8 + матрица §1 (пара «включено») |
| `palette-and-controls.html` | образец «на согласование»: три палитры + элементы; согласование давно прошло | **кандидат на удаление** — перекрыт: принятая палитра в `../audits/2026-08-22-palette-sample.html`, элементы в `../audits/2026-08-22-controls-sample.html`, а его «заря §16.2» (лазурная пара-ореол) низложена §21.1 п.1 | — (устаревший §16.2) |

## audits/ (родня семейства)

| Файл | Роль | Статус | Несёт § канона |
|---|---|---|---|
| `2026-08-22-design-baseline-mockup.html` | макет-протокол разбора облика 22.08: база/сегодня/предложение, решения владельца, узел эфира, вкладка «Объяснения» | живой, датированный протокол; как источник зари перекрыт §20—§21.1 (его заря — крем+ореол) | решения владельца 22.08 |
| `2026-08-22-controls-sample.html` | «Оттиск» — образец элементов управления с замерами | живой; обновить при §21-синтезе: включённые состояния перевести с крем+кромка на клетки матрицы §1, ореол — во вторичные эффекты | база элементов; заря — до §20 |
| `2026-08-22-palette-sample.html` | принятая палитра: роли красок (заря/глина/платина/графит), 13 вкладок с контрастами | живой; обновить при §21-синтезе: раздел «Заря на хроме» учит ореолу (низложен §21.1 п.1), пары вкладок перекрыты матрицей §4 | роли красок и запреты — живы; заря — до §20 |


## Runtime adoption: navigation/corner glass (2026-10-12)

U02/U03/U07: the existing `Header.tsx` grouped thirteen-route navigation and
filter corner adopt the original `.стекло` recipe from `otdelki.html`: blur
16px, saturation 160%, layered highlights and shadows. Existing SVG shield,
convex week/month barrels, section colors, live history, selection actions and
Pulse contents remain the runtime sources. Draft A/B/C corner variants and
`2026-08-29-zarya-matrica.md` are not silently promoted to accepted designs.

Chromium testing of the actual Header (isolated local harness, API unavailable)
checks thirteen navigation actions, native Tab, method selection/reset and
computed material at 1440/390/320px and 200% zoom in dark/light themes. It
reproduced a 559px-wide combined time-machine overflow at 390px. Phones now
wrap the existing time-machine and expose the original month barrel through
visible native horizontal scrolling, preserving its geometry and controls.
Navigation buttons retain 44px mobile targets. This is component/browser
verification, not live authentication or acceptance of all thirteen page bodies.
Production-domain auth, exact-head release and owner visual acceptance remain
separate gates; PR #88 main CI was red at its Tests step while browser QA
passed, so its Design Lab is not assumed safe for whole-branch adoption.


Earlier short-phone follow-up (superseded by the cylinder follow-up below): using the actual Header in the same viewport-height
flex shell as App reproduced zero remaining main height at 320×568. Only the
existing grouped navigation now has a viewport-relative height cap and native
vertical scrolling; the Header itself remains unclipped so corner/provenance
popovers keep their existing behavior. All thirteen buttons remain focusable
and clickable. Chromium checks leave 118px of main area at 320×568 and 198px
at 390×667, without outer horizontal overflow. Page-body usability and live
production acceptance still require their own checks.

### Original navigation cylinder follow-up (2026-10-12)

The owner's subsequent request restores the actual three-row navigation from
`pulse.html` (CSS880–974 / JS9096–9168), using the existing Header routes rather
than a new menu. DesignLab #88 at `bf5971ee0830702906782fb09566a28111862323`
explicitly keeps this cylinder as the runtime reference. Center focus, edge
perspective, wheel/arrow/Home/End browsing, touch arrows, section colors and
conic selected glow remain. Dark glass uses the original .07/.02/.005 stops
and eight shadow layers; reduced motion disables cylinder transitions.

The reported regression was reproduced: the previous 340px housing and
`overflow-wrap:anywhere` split «Реестр» into six lines. Whole labels now scroll
inside individual rows while group names stay fixed. External route changes
and keyboard focus center the corresponding group and reveal the selected
button. The former whole-menu vertical height cap is replaced by the three-row
cylinder. Short phones keep both original calendar drums beside each other,
with horizontal scrolling inside the month drum, preserving the week drum.

Real Chromium component checks cover all thirteen selected/focused route bounds,
native Tab, no outer horizontal overflow and no drum viewport vertical drift
at 1440/1280/390/320px and 200% zoom in light/dark themes. A 320×568 shell with
calendar/filters reproduced only 8px of main height before the layout correction;
the corrected shells leave 102px at 320×568 and 229px at 390×667. Actual animation
frames show wheel motion from −32px through intermediate positions to −64px;
the reduced-motion transition computes to 0s. Navigation tests pass (7), the
four-package regression total is 5775 PASS / 1 existing skip, and web build
passes. Independent source review accepts the bounded navigation change.
Screenshots use an isolated Header
with unavailable API and synthetic counts, not a live full-dashboard acceptance.
All thirteen page bodies, authorization, original DesignLab palette/settings
catalog and production owner acceptance remain separate requirements.
