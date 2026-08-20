import { describe, expect, it } from 'vitest';
import { chunkForModule, findTestAssetLeaks, resolveAllowedHosts } from './vite.config';

describe('resolveAllowedHosts (B-12: dev server Host-header allow-list)', () => {
  it("defaults to Vite's built-in localhost-only allow-list when the env var is unset", () => {
    expect(resolveAllowedHosts(undefined)).toBeUndefined();
  });

  it('stays localhost-only for any value other than the exact string "true"', () => {
    expect(resolveAllowedHosts('1')).toBeUndefined();
    expect(resolveAllowedHosts('TRUE')).toBeUndefined();
    expect(resolveAllowedHosts('yes')).toBeUndefined();
  });

  it('opts into accepting any Host header only when AEMR_VITE_ALLOW_PUBLIC_HOSTS=true', () => {
    expect(resolveAllowedHosts('true')).toBe(true);
  });
});

describe('chunkForModule (п.134: раскладка кусков сборки по сроку жизни)', () => {
  const nm = (pkg: string, file = 'dist/index.js') => `/repo/node_modules/.pnpm/x/node_modules/${pkg}/${file}`;

  it('оставляет наш код во входном файле — раскладке подлежат только библиотеки', () => {
    expect(chunkForModule('/repo/packages/web/src/pages/Dashboard.tsx')).toBeUndefined();
    expect(chunkForModule('/repo/packages/core/src/metrics/registry.ts')).toBeUndefined();
  });

  it('уводит графики в отдельный кусок вместе со всем семейством d3', () => {
    expect(chunkForModule(nm('recharts', 'es6/chart/LineChart.js'))).toBe('charts');
    expect(chunkForModule(nm('d3-scale'))).toBe('charts');
    expect(chunkForModule(nm('decimal.js-light'))).toBe('charts');
  });

  it('держит React и оболочку интерфейса врозь — у них разный срок жизни', () => {
    expect(chunkForModule(nm('react-dom', 'client.js'))).toBe('react-vendor');
    expect(chunkForModule(nm('@radix-ui/react-dialog'))).toBe('ui-vendor');
    expect(chunkForModule(nm('lucide-react'))).toBe('ui-vendor');
  });

  it('собирает прочие библиотеки первого кадра в общий vendor, а не в файл приложения', () => {
    for (const pkg of ['zod', 'tailwind-merge', 'sonner', 'zustand', 'number-flow', 'clsx']) {
      expect(chunkForModule(nm(pkg))).toBe('vendor');
    }
  });

  it('НЕ трогает библиотеки, которые приезжают по требованию: иначе они станут грузиться до первого кадра', () => {
    // docx — 343 кБ, нужен только при нажатии «Отчёт в Word».
    expect(chunkForModule(nm('docx'))).toBeUndefined();
    expect(chunkForModule(nm('jspdf'))).toBeUndefined();
  });

  it('разбирает пути с обратной косой чертой (сборка на Windows)', () => {
    expect(chunkForModule('C:\\repo\\node_modules\\zod\\lib\\index.js')).toBe('vendor');
    expect(chunkForModule('C:\\repo\\node_modules\\react\\index.js')).toBe('react-vendor');
  });
});

describe('findTestAssetLeaks (страж: испытательные данные в браузерной сборке)', () => {
  const mod = (id: string, bytes = 1024) => ({ id, bytes });

  it('молчит, когда в сборке только продуктовый код', () => {
    expect(findTestAssetLeaks([mod('/repo/packages/web/src/pages/Dashboard.tsx')])).toEqual([]);
  });

  it('ловит фикстуру, случайно уехавшую в сборку', () => {
    const leaks = findTestAssetLeaks([mod('/repo/packages/core/src/report/__fixtures__/week-01.01.2027.json', 4096)]);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].bytes).toBe(4096);
  });

  it('ловит файлы тестов во всех принятых написаниях', () => {
    const ids = [
      '/repo/packages/web/src/store.test.ts',
      '/repo/packages/web/src/lib/x.spec.tsx',
      '/repo/packages/core/src/__mocks__/sheets.ts',
    ];
    expect(findTestAssetLeaks(ids.map((i) => mod(i)))).toHaveLength(3);
  });

  it('не считает протечкой три выжимки недель — это учтённый долг зоны core', () => {
    const known = [
      '/repo/packages/core/src/report/__fixtures__/week-08.05.2026.json',
      '/repo/packages/core/src/report/__fixtures__/week-29.05.2026.json',
      '/repo/packages/core/src/report/__fixtures__/week-26.06.2026.json',
    ];
    expect(findTestAssetLeaks(known.map((i) => mod(i)))).toEqual([]);
  });

  it('перечисляет находки от самой тяжёлой к лёгкой — читать список сверху', () => {
    const leaks = findTestAssetLeaks([mod('/a/x.test.ts', 10), mod('/a/__fixtures__/big.json', 900), mod('/a/y.spec.ts', 100)]);
    expect(leaks.map((l) => l.bytes)).toEqual([900, 100, 10]);
  });

  it('узнаёт пути Windows: страж не должен слепнуть от косой черты', () => {
    expect(findTestAssetLeaks([mod('C:\\repo\\packages\\core\\src\\__fixtures__\\huge.json')])).toHaveLength(1);
    expect(findTestAssetLeaks([mod('C:\\repo\\packages\\core\\src\\report\\__fixtures__\\week-08.05.2026.json')])).toEqual([]);
  });
});
