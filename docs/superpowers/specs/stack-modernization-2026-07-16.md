# Актуализация стека и кода по свежим докам — «взбодрить без регрессий»

Дата: 2026-07-17. Ветка: `claude/refactor-consolidation`. Анализ-волна, прод-код не менялся.
Источники версий: `npm view <pkg> version` (2026-07-17) против резолва в `pnpm-lock.yaml`
(строки вида `pkg@X.Y.Z`). Свежие рекомендации — context7 (react.dev, zod changelog)
и официальные migration-гайды.

## §1. Версии: наша (lockfile) vs текущая стабильная

| Пакет | Наша | Стабильная | Дельта | Риск апгрейда |
|---|---|---|---|---|
| fastify | 5.8.5 | 5.10.0 | minor | низкий — в пределах v5, semver |
| react / react-dom | 19.2.4 | 19.2.7 | patch | низкий |
| vite | 6.4.3 | 8.1.5 | **2 мажора** | средний — тянет `@vitejs/plugin-react` 4.3→6.0.3; отдельный трек |
| @vitejs/plugin-react | 4.3.x | 6.0.3 | 2 мажора | связан с vite |
| drizzle-orm | 0.45.2 | 0.45.2 | нет | — уже последняя |
| drizzle-kit | 0.31.10 | 0.31.10 | нет | — |
| better-sqlite3 | 12.8.0 | 12.11.1 | patch | низкий — нативный модуль, нужна пересборка (`pnpm rebuild`) |
| vitest | 4.1.8 | 4.1.10 | patch | низкий |
| zod | 3.25.76 | 4.4.3 | **мажор** | низкий-средний — код почти v4-ready, см. §2.2 |
| googleapis | 173.0.0 | 173.0.0 | нет | — |
| typescript | 5.9.3 (манифест `^5.7.3`) | 7.0.2 (tsgo, нативный компилятор) | 2 мажора | высокий — не трогать в этой волне |
| recharts | 2.15.4 | 3.9.2 | **мажор** | средний — 6 файлов с импортами recharts в `packages/web/src` |
| zustand | 5.0.12 | 5.0.14 | patch | низкий |
| tailwindcss | 3.4.19 | 4.3.3 | **мажор** | высокий — v4 = CSS-first конфиг, трогает всю дизайн-систему |
| @fastify/cors | ^10.0.0 | 11.3.0 | мажор | низкий — v11 = линейка под Fastify 5 |
| @fastify/static | ^9.1.3 | 10.1.0 | мажор | низкий — аналогично |
| @fastify/helmet | ^13.0.2 | 13.1.0 | minor | низкий |
| @fastify/websocket | ^11.2.0 | 11.3.0 | patch | низкий |
| tsx | 4.21.0 | 4.23.1 | minor | низкий |
| dotenv | ^16.4.7 | 17.4.2 | мажор | низкий (v17 добавляет лог-баннер — глушится `quiet: true`) |
| pino-pretty | **11.3.0 и 13.1.3 одновременно** | 13.1.3 | дубль версий | низкий — выровнять на ^13 |

Дубль pino-pretty: `packages/server/package.json:29` (`^11.3.0`) против корневого
`package.json:40` (`^13.1.3`); lockfile резолвит обе (`pino-pretty@11.3.0` и `@13.1.3`).

## §2. Deprecated / устаревшие паттерны в нашем коде

1. **`React.forwardRef` — React 19 объявил его ненужным, будет deprecated.**
   Где: `packages/web/src/components/ui/card.tsx:4,20,32,47,59,67` (6 компонентов),
   `packages/web/src/components/ui/tooltip.tsx:9`.
   Как надо: `ref` теперь обычный проп функционального компонента —
   `function Card({className, ref, ...props})`.
   Источник: https://react.dev/blog/2024/12/05/react-19#ref-as-a-prop.
   Остальной web-код forwardRef не использует (grep по `packages/web/src` — только эти 2 файла).

2. **`error.format()` — deprecated в zod v4.**
   Где: `packages/server/src/config.ts:48` (`parsedEnv.error.format()`).
   Как надо (v4): `z.treeifyError(parsedEnv.error)` либо `z.prettifyError`.
   Источник: https://zod.dev/v4/changelog.
   Это **единственный найденный блокер v4**: `formatZodError` уже ходит по `error.issues`
   (`packages/server/src/lib/validate.ts:45`), все `z.record` уже двухаргументные
   (`packages/shared/src/schemas.ts:131,201,204,219,267-268,...`), `.merge()/.email()/
   .nonempty()/z.nativeEnum` в коде отсутствуют (grep по shared/server/core — 0 совпадений).

3. **Ручные касты `request.query as Record<string,string>` вместо route schema.**
   18 мест в не-тестовом коде сервера (grep `request.(query|body) as`), пример —
   `packages/server/src/routes/dashboard.ts:15` с ручным `parseInt`-парсингом года.
   На 86 регистраций роутов — только 2 `schema:`. Fastify рекомендует schema на роуте
   (валидация + сериализация + типы); для zod — `fastify-type-provider-zod`
   (`serializerCompiler`/`validatorCompiler`), у нас он не подключён
   (grep `withTypeProvider|setValidatorCompiler` — пусто).
   Источник: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/.
   Смягчение: свой хелпер `parseBody/parseQuery` (`packages/server/src/lib/validate.ts`)
   покрывает лишь 3 роут-файла из 13 (issues, mapping, settings — grep `from 'zod'`).

4. **`@fastify/static` ^9 и `@fastify/cors` ^10 — предыдущие мажорные линейки.**
   `packages/server/package.json:22,24`. Для Fastify 5 актуальны v10/v11; API совместим,
   это «паспортные» мажоры. Источник: release notes плагинов (fastify/fastify-cors v11.0.0).

5. **recharts 2.x при актуальной 3.x.** Импорты в 6 файлах `packages/web/src`
   (grep `from 'recharts'`). v3 переписала внутреннее состояние (убран redux-подобный
   стейт, изменены Tooltip/activeShape/accessibility-дефолты). Не deprecated в строгом
   смысле, но линейка 2.x больше не развивается. Источник:
   https://github.com/recharts/recharts/releases/tag/v3.0.0.

Чего у нас НЕТ (проверено, чинить нечего): legacy-хуков Fastify v4 (`onRequest`-хуки
в `middleware/auth.ts:39,65` — валидный v5-паттерн), `ReactDOM.render`, propTypes,
string refs, `z.string().email()`.

## §3. Идеологические апгрейды («так больше не пишут»)

1. **Типизация API-границы клиента: 41 из ~50 методов — `fetchJSON<any>`.**
   Что: `packages/web/src/api.ts` (227 строк, `grep -c "fetchJSON<any>"` = 41; типизирован
   фактически только `getDashboard` через `DashboardData`).
   Зачем: в `packages/shared/src/schemas.ts` уже лежат zod-схемы этих же сущностей —
   контракт есть, клиент его игнорирует. Любая перестройка ответа сервера ломает web молча.
   Как: минимум — заменить `<any>` на типы из `@aemr/shared`; максимум — `schema.parse()`
   в `fetchJSON` (получаем runtime-контракт). Усилие: 0.5–1 день, чисто типовая правка.

2. **Серверная валидация через type provider, а не касты.**
   Что: подключить `fastify-type-provider-zod`, перевести 18 кастов (§2.3) на `schema:`.
   Зачем: убирает `as Record<string,string>`, даёт 400 с деталями бесплатно и
   fast-json-stringify-сериализацию ответов. Усилие: 1–2 дня, можно по одному роут-файлу
   за шаг (13 файлов в `packages/server/src/routes/`).

3. **Code-splitting страниц: `React.lazy` + `Suspense` отсутствуют полностью.**
   Что: grep `lazy(|Suspense` по `packages/web/src` — 0 совпадений; все страницы
   импортируются статически (`packages/web/src/App.tsx:7-13`).
   Зачем: это уже зафиксированный residual в `CLAUDE.md` («Split the large web bundle»).
   Как: `const Dashboard = lazy(() => import('./pages/Dashboard'))` + один `<Suspense>`
   внутри существующего `<ErrorBoundary resetKey={page}>` (`App.tsx:137`). Усилие: часы.

4. **Серверное состояние: ручные fetch-цепочки vs TanStack Query — вводить точечно.**
   Что: 46 `useEffect` в web; 8 страниц делают `useEffect`+`api.*` (например
   `pages/Recon.tsx:263`, `pages/Journal.tsx:44`, `pages/Issues.tsx:76`); zustand-store
   (`store.ts`, 801 строка) вручную ведёт `loading/error` (`store.ts:715-742`).
   Вердикт: глобальный снапшот дашборда осознанно централизован в zustand — его НЕ трогать.
   TanStack Query оправдан только для страничных запросов (кэш, повторный маунт, refetch),
   и только если начнёт мешать текущая схема. Ценность средняя, усилие 2-3 дня —
   **не в первую очередь**.

5. **Error boundaries: уже хорошо.** Глобальный классовый boundary с `resetKey` по
   странице есть (`App.tsx:34,137`). Per-page boundaries — избыточны при текущем размере.
   Не делать.

## §4. План «взбодрить»: порядок безопасных шагов

Каждый шаг = отдельный коммит с зелёным гейтом (`pnpm typecheck && pnpm -r test`;
полный гейт — по одному пакету, память машины).

1. **Patch/minor-бампы без API-изменений:** fastify 5.10, react/react-dom 19.2.7,
   vitest 4.1.10, better-sqlite3 12.11.1 (+`pnpm rebuild better-sqlite3`), zustand 5.0.14,
   tsx, @fastify/helmet, @fastify/websocket. Выровнять pino-pretty на `^13.1.3` в
   `packages/server/package.json:29` (убрать дубль).
2. **«Паспортные» мажоры Fastify-плагинов:** @fastify/cors →^11, @fastify/static →^10.
   Проверить smoke: `curl http://localhost:3000/api/health` + CORS-заголовки.
3. **zod 3→4:** одна правка `config.ts:48` (`error.format()` → `z.treeifyError`),
   бампнуть zod в shared и server синхронно, прогнать тесты shared→core→server.
   Схемы уже v4-совместимы (§2.2).
4. **React 19 идиомы:** убрать `forwardRef` в `ui/card.tsx` и `ui/tooltip.tsx`
   (ref как проп) — механически, 2 файла.
5. **Lazy-роуты + Suspense** (§3.3) — закрывает residual из CLAUDE.md, риск минимальный.
6. **Типизация api.ts** (§3.1) — заменить 41 `<any>` на типы из `@aemr/shared`.
7. **fastify-type-provider-zod** (§3.2) — по одному роут-файлу, начиная с dashboard.ts.

**Отдельные треки, НЕ в этой волне (и почему):**
- **vite 6→8** — два мажора, тянет plugin-react 6 и пересмотр `vite.config.test.ts`;
  делать изолированно после шагов 1-5.
- **tailwind 3→4** — CSS-first конфигурация ломает `tailwind.config.ts` + плагин
  tailwindcss-animate; это редизайн-трек, не «бамп».
- **recharts 2→3** — 6 файлов графиков с кастомными Tooltip/Sector, нужна визуальная
  проверка каждого; делать с открытым web-превью.
- **TypeScript 7 (tsgo)** — нативный компилятор, экосистема (typescript-eslint 8.x,
  drizzle-kit) ещё не гарантирует совместимость; сидеть на 5.9.x.
- **drizzle-orm, drizzle-kit, googleapis** — уже последние версии, не трогать.
- **zustand-store глобального снапшота** — осознанная архитектура, TanStack Query туда
  не тащить (§3.4).
