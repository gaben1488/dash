import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// B-12: allowedHosts:true accepts any Host header unconditionally (Vite's own
// types warn this is a DNS-rebinding risk). Gate the permissive mode behind an
// explicit env var; default to Vite's built-in localhost-only allow-list.
export function resolveAllowedHosts(rawValue: string | undefined): true | undefined {
  return rawValue === 'true' ? true : undefined;
}

/**
 * Раскладка библиотек по кускам сборки.
 *
 * Куски нарезаны не «поровну», а по сроку жизни: React и графики меняются раз
 * в полгода, наш код — по нескольку раз в день. Держать их в одном файле
 * значит обесценивать кэш браузера целиком при каждой правке подписи, и
 * читатель после каждого выката качает всё заново. Это и есть «скорость
 * обновления страницы»: не первый заход, а второй и все следующие.
 *
 * ПОЧЕМУ СПИСОК, А НЕ «ВСЁ ИЗ node_modules → vendor». Соблазн написать
 * ловушку на всё подряд опасен ровно одним: `docx` (343 кБ) приезжает только
 * по нажатию «Отчёт в Word» и живёт отдельным куском. Попади он в общий
 * `vendor`, до которого входной файл дотягивается статически, — и эти 343 кБ
 * стали бы качаться при каждом открытии дэша. Поэтому перечень закрытый:
 * сюда вписано лишь то, что и сегодня грузится до первого кадра.
 *
 * Вынесено отдельной функцией, чтобы правило проверялось тестом
 * (vite.config.test.ts), а не читалось глазами внутри конфигурации.
 */
export function chunkForModule(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  // Recharts тянет за собой семейство d3 и victory-vendor — это самая
  // тяжёлая зависимость дэша, и нужна она только страницам с графиками.
  if (/node_modules[/\\](recharts|victory-vendor|d3-[a-z-]+|internmap|delaunator|robust-predicates|decimal\.js-light|fast-equals|eventemitter3)[/\\]/.test(id)) {
    return 'charts';
  }
  if (/node_modules[/\\](react|react-dom|scheduler|react-is|use-sync-external-store)[/\\]/.test(id)) {
    return 'react-vendor';
  }
  if (/node_modules[/\\](@radix-ui|@floating-ui|lucide-react|cmdk|aria-hidden|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|get-nonce|use-callback-ref|use-sidecar|detect-node-es|tabbable)[/\\]/.test(id)) {
    return 'ui-vendor';
  }
  // Остальные библиотеки первого кадра. До этой правки они ехали внутри
  // файла приложения — около 285 кБ чужого кода, который перекачивался
  // из-за любой нашей правки, хотя сам не менялся месяцами.
  if (/node_modules[/\\](zod|tailwind-merge|clsx|class-variance-authority|sonner|number-flow|@number-flow|zustand|tailwindcss-animate)[/\\]/.test(id)) {
    return 'vendor';
  }
  return undefined;
}

/**
 * Известный долг: что уже уехало в сборку и ждёт правки в чужой зоне.
 *
 * Три выжимки недель (`packages/core/src/report/__fixtures__/week-*.json`)
 * заведены для регресса «расчёт против ручного отчёта», но попадают и в
 * браузерную сборку: их подтягивает `packages/core/src/timeline/week-slices.ts`,
 * который переизлучает свод `packages/core/src/index.ts`. В вебе ни
 * `weekSliceObservations`, ни `WEEK_SLICE_DATES` не вызываются ни разу —
 * это не нужный груз, а промах отсечения мёртвого кода.
 *
 * Замер 21.08.2026: без них критический путь 630.6 → 436.4 кБ в сжатом виде
 * (−31%), входной файл 2188 → 635 кБ. Лечение проверено и состоит из одной
 * строки в ЧУЖОЙ зоне — `"sideEffects": false` в packages/core/package.json:
 * без этого объявления отсечение мёртвого кода обязано считать, что модуль
 * что-то делает при загрузке, и оставляет его целиком. Сервер не страдает —
 * он вызывает `weekSliceObservations` по-настоящему (routes/timeline.ts) и
 * работает из исходников, без сборки.
 *
 * Пока строка не проставлена, три фикстуры внесены сюда исключением: страж
 * ниже не даёт появиться НОВЫМ протечкам, а этот список снимается вместе с
 * починкой.
 */
const KNOWN_TEST_ASSET_LEAKS: readonly string[] = [
  'core/src/report/__fixtures__/week-08.05.2026.json',
  'core/src/report/__fixtures__/week-29.05.2026.json',
  'core/src/report/__fixtures__/week-26.06.2026.json',
];

/** Модуль сборки: путь и вес после сжатия исходника. */
export interface BundledModule {
  id: string;
  bytes: number;
}

/**
 * Страж: испытательные данные в браузерной сборке.
 *
 * Фикстуры и файлы тестов пишутся без оглядки на вес — им можно. Но стоит
 * такому файлу попасть в цепочку статических импортов страницы, и читатель
 * начинает качать его при каждом открытии дэша, ничего об этом не зная.
 * Глазами это не ловится: в списке кусков сборки виден только общий размер.
 */
export function findTestAssetLeaks(modules: readonly BundledModule[]): BundledModule[] {
  return modules
    .map((m) => ({ ...m, id: m.id.replace(/\\/g, '/') }))
    .filter((m) => /__fixtures__|__mocks__|\.(test|spec)\.[cm]?[jt]sx?$/.test(m.id))
    .filter((m) => !KNOWN_TEST_ASSET_LEAKS.some((known) => m.id.endsWith(known)))
    .sort((a, b) => b.bytes - a.bytes);
}

/** Плагин-обёртка над стражем: роняет сборку до записи в dist. */
function guardTestAssets() {
  return {
    name: 'aemr-guard-test-assets',
    apply: 'build' as const,
    generateBundle(_options: unknown, bundle: Record<string, { type: string; modules?: Record<string, { renderedLength: number }> }>) {
      const modules: BundledModule[] = [];
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.modules) continue;
        for (const [id, m] of Object.entries(chunk.modules)) {
          if (m.renderedLength > 0) modules.push({ id, bytes: m.renderedLength });
        }
      }
      const leaks = findTestAssetLeaks(modules);
      if (leaks.length === 0) return;
      const total = leaks.reduce((s, m) => s + m.bytes, 0);
      const list = leaks.map((m) => `  ${(m.bytes / 1024).toFixed(1)} кБ  ${m.id.replace(/\\/g, '/')}`).join('\n');
      throw new Error(
        `Испытательные данные уехали в браузерную сборку (${(total / 1024).toFixed(1)} кБ). ` +
          `Читатель будет качать их при каждом открытии страницы.\n${list}\n` +
          'Лечение: убрать статический импорт из кода, который доступен из точки входа, ' +
          'либо перевести его на импорт по требованию.',
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), guardTestAssets()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@aemr/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@aemr/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
    // allow any host only when AEMR_VITE_ALLOW_PUBLIC_HOSTS=true (включая трюнели
    // cloudflare/ngrok/serveo/localtunnel/pinggy для live-демо); иначе Vite default.
    allowedHosts: resolveAllowedHosts(process.env.AEMR_VITE_ALLOW_PUBLIC_HOSTS),
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Правило раскладки — в chunkForModule (выше), под тестом.
      // Замечание на будущее: в Vite 7 (Rolldown) функциональная форма
      // manualChunks объявлена устаревшей в пользу output.advancedChunks
      // с описанием групп. Здесь Vite 6, форма ещё каноническая.
      output: { manualChunks: chunkForModule },
    },
  },
});
