import {
  CATALOG_VERSION, EXPERIMENTAL_SURFACES, FINISHES, LAYOUTS, NAV_SECTIONS,
  ORIGINAL_FAMILIES, findPair, findSurface,
  type Density, type FamilyId, type FinishId, type LayoutId,
  type NavSection, type SurfaceId, type SurfaceMode,
} from './catalog';

/** A named, user-controlled visual recipe; contains NO business data. */
export interface LabPreset {
  version: typeof CATALOG_VERSION;
  name: string;
  family: FamilyId;
  surface: SurfaceId;
  finish: FinishId;
  layout: LayoutId;
  section: NavSection;
  mode: SurfaceMode;
  density: Density;
  motion: boolean;
}

export const LAB_STORAGE_KEY = 'aemr-design-lab-presets-v1';
export const MAX_PRESETS = 24;
export const DEFAULT_PRESET: LabPreset = {
  version: 1, name: 'Исходная основа', family: 'cosmos', surface: 'heritage',
  finish: 'matte', layout: 'registry', section: 'Реестр',
  mode: 'dark', density: 'comfortable', motion: true,
};

function listed(options: readonly { id: string }[], value: unknown): boolean {
  return typeof value === 'string' && options.some((item) => item.id === value);
}

function validPreset(value: unknown): LabPreset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Набор должен быть объектом, а не массивом или строкой.');
  }
  const obj = value as Record<string, unknown>;
  const fields = ['version', 'name', 'family', 'surface', 'finish', 'layout', 'section', 'mode', 'density', 'motion'];
  if (Object.keys(obj).length !== fields.length || Object.keys(obj).some((field) => !fields.includes(field))) {
    throw new Error('Состав полей набора не соответствует версии 1.');
  }
  if (obj.version !== CATALOG_VERSION) throw new Error('Неизвестная версия набора.');
  if (typeof obj.name !== 'string' || !obj.name.trim() || obj.name.length > 64 || /[\u0000-\u001f\u007f]/.test(obj.name)) {
    throw new Error('Название должно содержать от 1 до 64 символов без служебных знаков.');
  }
  if (!listed(ORIGINAL_FAMILIES, obj.family)) throw new Error('Неизвестное семейство цветов.');
  if (!listed(EXPERIMENTAL_SURFACES, obj.surface)) throw new Error('Неизвестная подложка.');
  if (!listed(FINISHES, obj.finish)) throw new Error('Неизвестная отделка.');
  if (!listed(LAYOUTS, obj.layout)) throw new Error('Неизвестная компоновка.');
  if (typeof obj.section !== 'string' || !NAV_SECTIONS.some((item) => item === obj.section)) {
    throw new Error('Неизвестный раздел.');
  }
  if (obj.mode !== 'dark' && obj.mode !== 'light') throw new Error('Неизвестный режим света.');
  if (obj.density !== 'compact' && obj.density !== 'comfortable') throw new Error('Неизвестная плотность.');
  if (typeof obj.motion !== 'boolean') throw new Error('Параметр движения должен быть true или false.');
  return { ...obj, name: obj.name.trim() } as unknown as LabPreset;
}

export function parsePresetJSON(raw: string): LabPreset {
  if (raw.length > 32768) throw new Error('Файл набора больше 32 КБ.');
  let object: unknown;
  try { object = JSON.parse(raw); } catch { throw new Error('Некорректный JSON.'); }
  return validPreset(object);
}

/** Import accepts a single recipe or a versioned pack. No custom CSS or HTML is executed. */
export function parsePresetPackJSON(raw: string): LabPreset[] {
  if (raw.length > 131072) throw new Error('Файл подборки больше 128 КБ.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Некорректный JSON.'); }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'presets' in parsed) {
    const pack = parsed as Record<string, unknown>;
    if (Object.keys(pack).length !== 3 || pack.format !== 'dash-design-lab' || pack.version !== 1 || !Array.isArray(pack.presets)) {
      throw new Error('Неверный формат подборки.');
    }
    if (pack.presets.length > MAX_PRESETS) throw new Error('В одной подборке допускается не более 24 наборов.');
    return pack.presets.map(validPreset);
  }
  return [validPreset(parsed)];
}

export function exportPresetPack(presets: readonly LabPreset[]): string {
  if (presets.length > MAX_PRESETS) throw new Error('Слишком много наборов для экспорта.');
  return JSON.stringify({ format: 'dash-design-lab', version: 1, presets: presets.map(validPreset) }, null, 2);
}

export function readStoredPresets(storage: Pick<Storage, 'getItem'>): LabPreset[] {
  try {
    const raw = storage.getItem(LAB_STORAGE_KEY);
    return raw ? parsePresetPackJSON(raw) : [];
  } catch {
    return []; // Storage disabled, damaged, or from an incompatible version.
  }
}

export function writeStoredPresets(storage: Pick<Storage, 'setItem'>, presets: readonly LabPreset[]): void {
  storage.setItem(LAB_STORAGE_KEY, exportPresetPack(presets));
}

/** Updates by name, preserving order; rejects silent eviction at the limit. */
export function upsertPreset(presets: readonly LabPreset[], value: LabPreset): LabPreset[] {
  const clean = validPreset(value);
  const index = presets.findIndex((p) => p.name.toLocaleLowerCase('ru') === clean.name.toLocaleLowerCase('ru'));
  if (index < 0 && presets.length >= MAX_PRESETS) throw new Error('Сохранено 24 набора. Удалите один перед добавлением.');
  return index < 0 ? [...presets, clean] : presets.map((p, i) => i === index ? clean : p);
}

function luminance(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Цвет должен иметь формат #RRGGBB.');
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(a: string, b: string): number {
  const left = luminance(a), right = luminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

/** Both gradient endpoints; finish overlays can still require manual contrast inspection. */
export function evaluateContrast(preset: LabPreset) {
  const pair = findPair(preset.family, preset.section);
  const top = contrastRatio(pair.ink, pair.top);
  const bottom = contrastRatio(pair.ink, pair.bottom);
  return { top, bottom, minimum: Math.min(top, bottom), passes: Math.min(top, bottom) >= 4.5 };
}

/**
 * CSS handoff is scoped to a component, never :root/body or the live app.
 * This is a recipe, not an approved product-wide theme.
 */
export function buildScopedCSS(preset: LabPreset): string {
  const clean = validPreset(preset);
  const pair = findPair(clean.family, clean.section);
  const skin = findSurface(clean.surface)[clean.mode];
  const items: Record<string, string> = {
    '--dl-top': pair.top, '--dl-bottom': pair.bottom, '--dl-accent-ink': pair.ink,
    '--dl-bg': skin.bg, '--dl-card': skin.card, '--dl-raised': skin.raised,
    '--dl-ink': skin.ink, '--dl-muted': skin.muted, '--dl-line': skin.line,
  };
  return [
    '/* DEMO ONLY · visual recipe; verify WCAG, states and parity before adoption. */',
    '/* Family: ' + clean.family + '; surface: ' + clean.surface + '; finish: ' + clean.finish + '; layout: ' + clean.layout + '. */',
    '.dash-design-preview {',
    ...Object.entries(items).map(([name, value]) => '  ' + name + ': ' + value + ';'),
    '}',
    '/* Do not replace existing navigation geometry or semantic status colors. */',
  ].join('\n');
}
