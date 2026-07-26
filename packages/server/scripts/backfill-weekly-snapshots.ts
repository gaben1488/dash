/**
 * backfill-weekly-snapshots.ts — бэкфилл исторических снимков из ручных
 * недельных xlsx-выгрузок (модель «одной оси недели», дизайн-док 2026-07-23
 * §4 R2): папка «Отчет по закупкам дд.мм.гггг» с книгами ГРБС становится
 * DataSnapshot, приписанным ЧЕТВЕРГУ той же недели, — и отчёты прошлых недель
 * строятся из него, а не из сегодняшнего живого кэша.
 *
 * Запуск ИЗ packages/server (БД сервера — ./data/aemr.db относительно cwd):
 *   npx tsx --tsconfig tsconfig.runtime.json scripts/backfill-weekly-snapshots.ts --dry-run
 *   npx tsx --tsconfig tsconfig.runtime.json scripts/backfill-weekly-snapshots.ts
 * Параметры:
 *   --dry-run     только разбор и сводка, БД не открывается и не пишется;
 *   --dir <путь>  каталог выгрузок (иначе env BACKFILL_REPORTS_DIR,
 *                 иначе локальный канон ниже).
 *
 * Идемпотентность: снимок со строками на этот четверг уже есть (проверка через
 * существующий getSnapshotAtOrBefore) → папка пропускается с честным логом.
 * Вся чистая логика — в src/services/backfill-weekly.ts (там же юниты);
 * здесь только ввод-вывод: файлы, SheetJS (devDependency, прод её не грузит)
 * и сохранение через существующий сервис снапшотов.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { read as readXlsx, utils as xlsxUtils } from 'xlsx';
import { dayNumberOf, findDept, isoOfDayNumber, parseSvodGrid, type SvodGridBlock } from '@aemr/shared';
import {
  buildBackfillSnapshot,
  parseFolderDate,
  pickDeptSheet,
  thursdayOfWeek,
  trimTrailingEmptyRows,
  type BackfillSource,
} from '../src/services/backfill-weekly.js';

/**
 * Каталог выгрузок: env BACKFILL_REPORTS_DIR, иначе локальный канон
 * (8 папок 08.05–26.06.2026 × 8 книг ГРБС на машине пользователя).
 */
const DEFAULT_DIR = process.env.BACKFILL_REPORTS_DIR ?? 'C:/Users/filat/Documents/Отчеты по закупкам';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirFlag = args.indexOf('--dir');
const baseDir = dirFlag >= 0 && args[dirFlag + 1] ? args[dirFlag + 1] : DEFAULT_DIR;

/** Значения листа как отдаёт SheetJS: плотные строки, пустые ячейки = null. */
function sheetValues(ws: import('xlsx').WorkSheet): unknown[][] {
  return xlsxUtils.sheet_to_json(ws, {
    header: 1,
    raw: true, // числа и serial-даты как числа — та же форма, что UNFORMATTED_VALUE живого чтения
    defval: null,
    blankrows: true, // внутренние пустые строки сохраняются — нумерация книги не сдвигается
  }) as unknown[][];
}

/** Разбор одной папки-выгрузки: книги ГРБС + СВОД, если вдруг нашёлся листом. */
function readFolder(folderPath: string): BackfillSource & { skipped: string[] } {
  const sheetValuesByDept: Record<string, unknown[][]> = {};
  let svodGrid: SvodGridBlock[] | undefined;
  const skipped: string[] = [];

  for (const file of readdirSync(folderPath)) {
    if (!file.toLowerCase().endsWith('.xlsx')) continue;
    const dept = findDept(basename(file, '.xlsx'));
    let workbook: ReturnType<typeof readXlsx>;
    try {
      workbook = readXlsx(readFileSync(join(folderPath, file)), { type: 'buffer' });
    } catch (error) {
      skipped.push(`${file}: не читается (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }

    // Официальная сетка: лист СВОД встречается в выгрузках редко (обычно СВОД
    // приложен PDF-ом и в снимок честно не попадает) — но если лист есть, берём.
    if (!svodGrid) {
      const svodSheet = workbook.SheetNames.find((n) => /СВОД/i.test(n));
      if (svodSheet) {
        const parsed = parseSvodGrid(sheetValues(workbook.Sheets[svodSheet]));
        if (parsed.length > 0) svodGrid = parsed;
      }
    }

    if (!dept) {
      skipped.push(`${file}: имя не из реестра ГРБС — файл пропущен`);
      continue;
    }
    const tab = pickDeptSheet(workbook.SheetNames, dept);
    if (!tab) {
      skipped.push(`${file}: нет канон-вкладки (кандидаты «${dept.sheetName}»/«${dept.id}»)`);
      continue;
    }
    sheetValuesByDept[dept.id] = trimTrailingEmptyRows(sheetValues(workbook.Sheets[tab]));
  }

  return { sheetValuesByDept, ...(svodGrid ? { svodGrid } : {}), skipped };
}

async function main(): Promise<void> {
  const folders = readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, day: parseFolderDate(e.name) }))
    .filter((f): f is { name: string; day: number } => f.day !== null)
    .sort((a, b) => a.day - b.day);

  if (folders.length === 0) {
    console.error(`В «${baseDir}» нет папок вида «… дд.мм.гггг» — нечего бэкфилить.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Каталог: ${baseDir}; папок-выгрузок: ${folders.length}${dryRun ? ' (dry-run: БД не трогаем)' : ''}`);

  // Сервис снапшотов (и его SQLite) подключается ТОЛЬКО в боевом режиме —
  // dry-run не открывает и не создаёт БД вовсе.
  const store = dryRun
    ? null
    : await (async () => {
        const m = await import('../src/services/snapshot.js');
        const { productCalendarDay } = await import('../src/services/product-calendar.js');
        const { config } = await import('../src/config.js');
        return {
          saveSnapshot: m.saveSnapshot,
          getSnapshotAtOrBefore: m.getSnapshotAtOrBefore,
          productDayOf: (iso: string) =>
            productCalendarDay(new Date(Date.parse(iso)), config.weeklySnapshot.utcOffsetHours),
        };
      })();

  let saved = 0;
  let skippedFolders = 0;

  for (const folder of folders) {
    const thursday = thursdayOfWeek(folder.day);
    const source = readFolder(join(baseDir, folder.name));
    const books = Object.keys(source.sheetValuesByDept);
    const snapshot = buildBackfillSnapshot(thursday, source);
    const sizeMb = (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') / 1048576).toFixed(2);

    const rowsSummary = books
      .map((d) => `${d}:${snapshot.metadata.perSheetRowCount?.[d] ?? 0}`)
      .join(' ');
    console.log(
      `\n${folder.name} → четверг ${isoOfDayNumber(thursday)} (${snapshot.id}): ` +
      `книг ${books.length}, строк-атомов ${snapshot.rowCount} [${rowsSummary}], ` +
      `СВОД ${snapshot.svodGrid ? `листом, блоков ${snapshot.svodGrid.length}` : 'в выгрузке не найден (обычно он PDF) — снимок без официальной сетки'}, ` +
      `данные ~${sizeMb} МБ`,
    );
    for (const line of source.skipped) console.log(`  ⚠ ${line}`);

    if (books.length === 0) {
      console.log('  Ни одной книги ГРБС не разобрано — снимок не сохраняется.');
      skippedFolders++;
      continue;
    }
    if (!store) continue; // dry-run: только сводка

    // День существующего снимка считается календарём ПРОДУКТА — той же осью,
    // что и весь срез: cron снимает снимок в первой половине камчатского
    // четверга, по UTC это ещё среда, и UTC-сверка «снимок дня уже есть» его
    // не видела → повторный прогон писал свой и retention убивал живой.
    const existing = store.getSnapshotAtOrBefore(thursday);
    if (existing && store.productDayOf(existing.createdAt) === thursday) {
      console.log(`  Снимок этого дня уже есть (${existing.id}) — пропуск (идемпотентность).`);
      skippedFolders++;
      continue;
    }
    // saveSnapshot ошибок не бросает, а возвращает факт записи: счётчик
    // «сохранено N» инкрементится только по true — скрипт не врёт (ревью №9).
    if (await store.saveSnapshot(snapshot)) {
      saved++;
    } else {
      console.log('  ⚠ Снимок НЕ сохранён — ошибка БД, см. лог выше.');
      skippedFolders++;
    }
  }

  console.log(
    dryRun
      ? `\nDry-run завершён: к записи готово ${folders.length - skippedFolders} из ${folders.length} папок.`
      : `\nГотово: сохранено ${saved}, пропущено ${skippedFolders} из ${folders.length} папок.`,
  );
}

await main();
