/**
 * user-roles.ts — Роли пользователей и матрица разрешений АЕМР.
 *
 * Источник: почтес.xlsx (ролевой реестр пользователей).
 * 9 ролей × матрица разрешений.
 *
 * TODO: заполнить точные email-домены и разрешения из почтес.xlsx.
 *       Текущая версия — скелет на основе известной структуры:
 *       PM, architect, specialist, coordinator, program-consultant,
 *       procurement-auth-E (УФБП), ufbp-control-F, tester, bot.
 *
 * Матрица разрешений:
 *   view_dashboard    — просмотр сводной панели
 *   view_analytics    — просмотр страницы аналитики
 *   view_rows         — просмотр построчных данных
 *   view_recon        — просмотр сверки (Recon)
 *   view_quality      — просмотр контроля качества
 *   export_data       — экспорт данных (XLSX/PDF)
 *   edit_economy_flag — установка/снятие флага экономии (колонка AD, только УФБП)
 *   admin_settings    — настройки системы
 *   api_access        — программный доступ к API
 */

// ────────────────────────────────────────────────────────────
// 1. Роли
// ────────────────────────────────────────────────────────────

export const USER_ROLE_CODES = [
  'pm',                 // Руководитель проекта / методолог
  'architect',          // Архитектор системы (технический)
  'specialist',         // Специалист по закупкам ГРБС
  'coordinator',        // Координатор (сводный мониторинг)
  'program_consultant', // Консультант по программным мероприятиям
  'procurement_auth',   // Уполномоченный орган (УФБП, устанавливает AD-флаги)
  'ufbp_control',       // Контролёр УФБП (только чтение с усиленным доступом)
  'tester',             // Тестировщик (технический доступ, тестовые данные)
  'bot',                // Сервисный бот (API-only, автоматические задачи)
] as const;

export type UserRoleCode = typeof USER_ROLE_CODES[number];

// ────────────────────────────────────────────────────────────
// 2. Разрешения
// ────────────────────────────────────────────────────────────

export const PERMISSION_KEYS = [
  'view_dashboard',
  'view_analytics',
  'view_rows',
  'view_recon',
  'view_quality',
  'export_data',
  'edit_economy_flag',
  'admin_settings',
  'api_access',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

// ────────────────────────────────────────────────────────────
// 3. Метаданные ролей
// ────────────────────────────────────────────────────────────

export interface UserRoleMeta {
  code: UserRoleCode;
  /** Русское название роли */
  label: string;
  /** Описание зоны ответственности */
  description: string;
  /** Матрица разрешений */
  permissions: Record<PermissionKey, boolean>;
  /**
   * Ограничение по ГРБС (null = доступ ко всем ГРБС).
   * Специалист ГРБС видит только свои данные.
   * TODO: fill from почтес.xlsx (реальный mapping email → grbsId).
   */
  grbsScope: 'all' | 'own';
  /**
   * Отображаемый значок в UI (Lucide icon name).
   */
  icon: string;
}

export const USER_ROLE_META: Record<UserRoleCode, UserRoleMeta> = {
  pm: {
    code: 'pm',
    label: 'Руководитель / методолог',
    description: 'Полный доступ ко всем данным, настройкам и экспорту. ' +
      'Устанавливает методологические правила.',
    permissions: {
      view_dashboard: true,
      view_analytics: true,
      view_rows: true,
      view_recon: true,
      view_quality: true,
      export_data: true,
      edit_economy_flag: false,  // флаги AD — только уполномоченный орган
      admin_settings: true,
      api_access: true,
    },
    grbsScope: 'all',
    icon: 'briefcase',
  },

  architect: {
    code: 'architect',
    label: 'Архитектор системы',
    description: 'Технический архитектор: полный доступ включая API и настройки.',
    permissions: {
      view_dashboard: true,
      view_analytics: true,
      view_rows: true,
      view_recon: true,
      view_quality: true,
      export_data: true,
      edit_economy_flag: false,
      admin_settings: true,
      api_access: true,
    },
    grbsScope: 'all',
    icon: 'cpu',
  },

  specialist: {
    code: 'specialist',
    label: 'Специалист по закупкам ГРБС',
    description: 'Специалист одного управления. Видит только данные своего ГРБС. ' +
      'Не имеет доступа к Recon и качеству других ГРБС.',
    permissions: {
      view_dashboard: true,
      view_analytics: true,
      view_rows: true,
      view_recon: false,
      view_quality: false,
      export_data: true,
      edit_economy_flag: false,
      admin_settings: false,
      api_access: false,
    },
    grbsScope: 'own',
    icon: 'user',
  },

  coordinator: {
    code: 'coordinator',
    label: 'Координатор (сводный мониторинг)',
    description: 'Смотрит сводную картину по всем ГРБС. Не редактирует данные.',
    permissions: {
      view_dashboard: true,
      view_analytics: true,
      view_rows: true,
      view_recon: true,
      view_quality: true,
      export_data: true,
      edit_economy_flag: false,
      admin_settings: false,
      api_access: false,
    },
    grbsScope: 'all',
    icon: 'layout-dashboard',
  },

  program_consultant: {
    code: 'program_consultant',
    label: 'Консультант по программным мероприятиям',
    description: 'Аналитик муниципальных программ. Повышенный доступ к аналитике.',
    permissions: {
      view_dashboard: true,
      view_analytics: true,
      view_rows: true,
      view_recon: true,
      view_quality: false,
      export_data: true,
      edit_economy_flag: false,
      admin_settings: false,
      api_access: false,
    },
    grbsScope: 'all',
    icon: 'book-open',
  },

  procurement_auth: {
    code: 'procurement_auth',
    label: 'Уполномоченный орган (УФБП)',
    description: 'УФБП — уполномоченный орган. Единственная роль с правом ' +
      'установки/снятия флага экономии (колонка AD).',
    permissions: {
      view_dashboard: true,
      view_analytics: true,
      view_rows: true,
      view_recon: true,
      view_quality: true,
      export_data: true,
      edit_economy_flag: true,  // эксклюзивное право
      admin_settings: false,
      api_access: true,
    },
    grbsScope: 'all',
    icon: 'shield',
  },

  ufbp_control: {
    code: 'ufbp_control',
    label: 'Контролёр УФБП',
    description: 'Расширенный просмотр без права редактирования флагов экономии.',
    permissions: {
      view_dashboard: true,
      view_analytics: true,
      view_rows: true,
      view_recon: true,
      view_quality: true,
      export_data: true,
      edit_economy_flag: false,
      admin_settings: false,
      api_access: false,
    },
    grbsScope: 'all',
    icon: 'eye',
  },

  tester: {
    code: 'tester',
    label: 'Тестировщик',
    description: 'Технический доступ для тестирования. Только тестовые данные.',
    permissions: {
      view_dashboard: true,
      view_analytics: true,
      view_rows: true,
      view_recon: true,
      view_quality: true,
      export_data: false,
      edit_economy_flag: false,
      admin_settings: false,
      api_access: true,
    },
    grbsScope: 'all',
    icon: 'beaker',
  },

  bot: {
    code: 'bot',
    label: 'Сервисный бот (API)',
    description: 'Автоматические задачи: импорт данных, пересчёт pipeline, cron-задачи.',
    permissions: {
      view_dashboard: false,
      view_analytics: false,
      view_rows: true,
      view_recon: false,
      view_quality: false,
      export_data: false,
      edit_economy_flag: false,
      admin_settings: false,
      api_access: true,
    },
    grbsScope: 'all',
    icon: 'bot',
  },
};

// ────────────────────────────────────────────────────────────
// 4. Helpers
// ────────────────────────────────────────────────────────────

/** Проверить разрешение роли */
export function hasPermission(role: UserRoleCode, permission: PermissionKey): boolean {
  return USER_ROLE_META[role].permissions[permission];
}

/** Роли с правом редактирования флагов экономии */
export const ECONOMY_FLAG_EDITORS: readonly UserRoleCode[] = USER_ROLE_CODES.filter(
  r => USER_ROLE_META[r].permissions.edit_economy_flag,
);
