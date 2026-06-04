import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // Надёжность гейта на медленном железе (2014 dual-core): дефолтные 10с
    // на остановку форк-воркера не хватает под нагрузкой → «Timeout terminating
    // forks worker». Продлеваем терпение teardown, не меняя изоляцию тестов.
    teardownTimeout: 60_000,
  },
});
