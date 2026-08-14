import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Страж канона п.30 (интервью 14.08.2026): среза «ТД-ПМ» в продукте нет.
 * Прецедент: ядро перевели на два вида деятельности, а кнопка осталась в шапке —
 * владелец увидел её на проде. Тест смотрит на исходники интерфейса, потому что
 * дефект был именно там, где логика уже была правильной.
 */
const WEB_SRC = join(__dirname, '..');

function read(rel: string): string {
  return readFileSync(join(WEB_SRC, rel), 'utf8');
}

describe('канон п.30: ТД-ПМ упразднён в интерфейсе', () => {
  it('в шапке нет кнопки среза ТД-ПМ', () => {
    const header = read('components/Header.tsx');
    // Подпись кнопки ищем как отдельный текст элемента, а не как слово в комментарии.
    expect(header).not.toMatch(/>ТД-ПМ</);
    expect(header).toMatch(/>ТД</);
    expect(header).toMatch(/>ПМ</);
  });

  it('кнопка ТД включает и легаси-ключ current_program', () => {
    const header = read('components/Header.tsx');
    expect(header).toMatch(/TD_ACTIVITY_KEYS\s*=\s*\['current_program',\s*'current_non_program'\]/);
  });

  it('в подписи активных фильтров нет ТД-ПМ', () => {
    // Ищем именно ВЫВОДИМЫЙ текст (строковый литерал), а не упоминание в
    // комментарии: объяснение канона в коде — это польза, а не рецидив.
    expect(read('components/FilterBreadcrumb.tsx')).not.toMatch(/['"`]ТД-ПМ['"`]/);
  });

  it('разбивка по видам деятельности рисует два ряда плана, не три', () => {
    const analytics = read('pages/Analytics.tsx');
    expect(analytics).not.toMatch(/name="Текущая \(программы\)"/);
    expect(analytics).toMatch(/dataKey="current"\s+name="Текущая деятельность"/);
  });
});
