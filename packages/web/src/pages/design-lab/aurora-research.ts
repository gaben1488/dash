/**
 * The five historically grounded appearance specimens share ONE canonical source:
 * archive colors (853548a), contrast corrections (29.08), and the 39 surviving
 * original pairs from zarya-vystavka.html. They are not production theme tokens.
 *
 * 29.08 owner correction 7a explicitly abolished mandatory bronze bottoms.
 * The archive specimen with white text intentionally FAILS contrast: never
 * export it as a ready-to-use component.
 */
import { FINISHES, ORIGINAL_FAMILIES, findPair, type FamilyId, type FinishId, type NavSection } from './catalog';
import { contrastRatio } from './presets';

export const AURORA_VARIANTS = [
  {
    id: 'historical',
    title: '7 августа · исторический синий и бронза',
    top: '#5b99f8', bottom: '#8f7549', ink: '#ffffff',
    source: '853548a · tg-month-active',
    message: 'Сильная двухцветность, но исходная белая подпись НЕ проходит 4,5:1. Архив, не готовая кнопка.',
    status: 'archive',
  },
  {
    id: 'recovered',
    title: 'Восстановленная лазурь · читаемая',
    top: '#5b99f8', bottom: '#9d8150', ink: '#1b170f',
    source: '2026-08-22-pulse-feedback-2.md · §20.1, путь А',
    message: 'Льдинка сверху, тёплое дно, тёмная подпись. Градиент внутри кнопки и кремовые соседи.',
    status: 'proposal',
  },
  {
    id: 'twilight',
    title: 'Лазурь до восхода · глубокая',
    top: '#426eb3', bottom: '#675435', ink: '#ffffff',
    source: '2026-08-22-pulse-feedback-2.md · §20.1, путь Б',
    message: 'Более тихая пара с белой подписью, подходит для ночного основного предмета.',
    status: 'proposal',
  },
  {
    id: 'cream',
    title: '14 августа · только крем',
    top: '#e5d3a9', bottom: '#d6bf85', ink: '#1b170f',
    source: '168c14a · после утраты лазурного месяца',
    message: 'Сохранено для сравнения: читаемо, но контраст холодных и тёплых соседей исчез.',
    status: 'archive',
  },
  {
    id: 'family',
    title: 'Семейство выбранной вкладки',
    top: null, bottom: null, ink: null,
    source: 'zarya-vystavka.html · все 39 исходных пары',
    message: 'Космос, Камчатка и минералы используют собственное небо И собственное дно. Универсальный бронзовый низ не навязывается.',
    status: 'original',
  },
] as const;
export type AuroraVariantId = (typeof AURORA_VARIANTS)[number]['id'];
export type AuroraState = 'idle' | 'selected' | 'hover' | 'focus' | 'partial' | 'disabled' | 'danger';

export const AURORA_STATES: readonly { id: AuroraState; title: string; meaning: string }[] = [
  { id: 'idle', title: 'Покой', meaning: 'Нейтральное управление, не кричит цветом' },
  { id: 'selected', title: 'Выбрано', meaning: 'Именно здесь виден рассвет внутри предмета' },
  { id: 'hover', title: 'Наведение', meaning: 'Добавлен отклик, не меняющий смысловую роль' },
  { id: 'focus', title: 'Фокус', meaning: 'Контур фокуса доступен отдельно от выбора' },
  { id: 'partial', title: 'Частично', meaning: 'Не становится полной заливкой без подтверждения' },
  { id: 'disabled', title: 'Недоступно', meaning: 'Никакого свечения и ложного обещания действия' },
  { id: 'danger', title: 'Ошибка', meaning: 'Глина/статус, не небеса вкладки' },
];

export function auroraColors(variant: AuroraVariantId, family: FamilyId, section: NavSection) {
  const recipe = AURORA_VARIANTS.find(item => item.id === variant)!;
  const sourcePair = findPair(family, section);
  const colors = {
    top: recipe.top ?? sourcePair.top,
    bottom: recipe.bottom ?? sourcePair.bottom,
    ink: recipe.ink ?? sourcePair.ink,
  };
  const topContrast = contrastRatio(colors.ink, colors.top);
  const bottomContrast = contrastRatio(colors.ink, colors.bottom);
  return {
    ...colors,
    topContrast,
    bottomContrast,
    contrastPass: Math.min(topContrast, bottomContrast) >= 4.5,
    source: recipe.source,
    category: recipe.status,
  };
}

export function familyMatrix() {
  return ORIGINAL_FAMILIES.flatMap(family =>
    family.sections.map(section => ({
      family: family.id,
      familyName: family.label,
      section: section.name,
      top: section.top,
      bottom: section.bottom,
      ink: section.ink,
      motif: section.motif,
      contrast: Math.min(contrastRatio(section.ink, section.top), contrastRatio(section.ink, section.bottom)),
    })),
  );
}

export function auroraMatrix() {
  return familyMatrix().flatMap(pair =>
    FINISHES.flatMap(finish =>
      AURORA_STATES.map(state => ({
        key: pair.family + ':' + pair.section + ':' + finish.id + ':' + state.id,
        ...pair,
        finish: finish.id as FinishId,
        state: state.id,
        activeColorContrastPass: pair.contrast >= 4.5,
        // Decorative coatings and transparency require rendered-pixel QA.
        surfacePixelVerified: false,
      })),
    ),
  );
}
