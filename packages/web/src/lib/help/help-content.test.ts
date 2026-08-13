/**
 * Проверки на язык справки. Справку читают начальники и специалисты
 * управлений; латинское слово или служебный ключ в ней — это не мелкая
 * небрежность, а сорванный первый контакт с продуктом. Правила языка
 * закреплены в PRODUCT.md, здесь они переведены в тест.
 */
import { describe, it, expect } from 'vitest';
import { HELP_TITLE, HELP_SUBTITLE, HELP_SECTIONS } from './help-content';

/**
 * Единственное латинское слово, которому позволено быть в тексте, — имя
 * сервиса, у которого нет русского написания в официальных документах.
 */
const ALLOWED_LATIN_WORDS = ['Google'];

function stripAllowedLatin(text: string): string {
  return ALLOWED_LATIN_WORDS.reduce(
    (acc, word) => acc.split(word).join(''),
    text,
  );
}

const allText = [
  HELP_TITLE,
  HELP_SUBTITLE,
  ...HELP_SECTIONS.flatMap(s => [s.title, ...s.paragraphs]),
].join('\n');

describe('справка «Как читать этот дэш»: состав', () => {
  it('тем ровно четыре — эфир и срез, источник чисел, происхождение, расхождение', () => {
    expect(HELP_SECTIONS).toHaveLength(4);
    expect(HELP_SECTIONS.map(s => s.id)).toEqual([
      'live-vs-snapshot',
      'where-numbers-come-from',
      'provenance',
      'divergence',
    ]);
  });

  it('имена разделов не повторяются — иначе якорь ведёт не туда', () => {
    const ids = HELP_SECTIONS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('у каждой темы есть заголовок и хотя бы один законченный абзац', () => {
    for (const section of HELP_SECTIONS) {
      expect(section.title.trim().length).toBeGreaterThan(0);
      expect(section.paragraphs.length).toBeGreaterThan(0);
      for (const paragraph of section.paragraphs) {
        // Обрывок вместо абзаца читается как недописанный текст.
        expect(paragraph.trim().length).toBeGreaterThan(80);
        expect(paragraph.trim().endsWith('.')).toBe(true);
      }
    }
  });
});

describe('справка: строгие правила языка', () => {
  it('в тексте нет латиницы, кроме имени сервиса Google', () => {
    const rest = stripAllowedLatin(allText);
    const latin = rest.match(/[A-Za-z]+/g);
    expect(latin).toBeNull();
  });

  it('в тексте нет служебных ключей и внутренних артефактов', () => {
    // Служебные имена вида exec_count_pct и _org_itself опознаются по
    // подчёркиванию между буквами — в русской фразе такого не бывает.
    expect(allText).not.toMatch(/\w_\w/);
    for (const forbidden of ['UNMAPPED', 'origin', 'null', 'Q1', 'API']) {
      expect(allText).not.toContain(forbidden);
    }
  });

  it('слово «нарушение» не употребляется — продукт говорит о признаках, а не обвиняет', () => {
    expect(allText.toLowerCase()).not.toContain('нарушен');
  });
});
