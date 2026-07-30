/**
 * TableOfContents — оглавление скролл-документа «Отчёт» (Отчёт++, шаг 2).
 *
 * Пункты = секции документа; активный подсвечивается по скроллу
 * (IntersectionObserver), клик — плавный скролл к секции. Ссылки — настоящие
 * <a href="#id">: у каждой секции свой якорь (задел под «свой URL у секции»
 * из спеки), hash обновляется без прыжка через history.replaceState.
 *
 * Компонент рендерит только список (nav) — раскладку (липкая колонка слева
 * на десктопе, сворачиваемый блок сверху на мобиле) задаёт контейнер.
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';

/** Секция документа: id якоря и русская подпись пункта. */
export interface TocSection {
  id: string;
  label: string;
}

export function TableOfContents({ sections }: { sections: readonly TocSection[] }) {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    // Видимые секции копятся в Set; активной считается верхняя по порядку
    // документа — так подсветка не скачет, когда в кадре сразу две секции.
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        for (const s of sections) {
          if (visible.has(s.id)) {
            setActiveId(s.id);
            return;
          }
        }
      },
      // Нижние 55 % вьюпорта не считаются «прочитанным»: активен тот
      // раздел, который читатель сейчас видит в верхней половине экрана.
      { rootMargin: '0px 0px -55% 0px' },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  const onClick = (id: string) => (ev: React.MouseEvent<HTMLAnchorElement>) => {
    ev.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Якорь в адресе — без мгновенного прыжка браузера по hash.
    history.replaceState(null, '', `#${id}`);
  };

  return (
    <nav aria-label="Оглавление">
      <ul className="space-y-1.5 text-sm">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={onClick(s.id)}
              aria-current={activeId === s.id ? 'true' : undefined}
              className={clsx(
                'block transition-colors',
                activeId === s.id
                  ? 'font-medium text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
              )}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
