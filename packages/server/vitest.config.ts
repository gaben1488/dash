import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    // Four file workers made the unchanged 1000-row diagnostics exceed 15s
    // on the 4-CPU executor. Bound contention; keep every test and timeout.
    maxWorkers: 2,
    // Подготовка файловой базы better-sqlite3 под параллельной нагрузкой
    // (93 файла тестов) выходит за умолчание 10с: три полных прогона 29.08
    // падали хуками в СЛУЧАЙНЫХ файлах при нуле упавших тестов, изолированно
    // всё зелёное. Класс лечится запасом времени хука, не повторами.
    hookTimeout: 60000,
  },
});
