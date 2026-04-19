/**
 * dictionaries/index.ts — Единая точка входа для всех справочников АЕМР.
 *
 * Экспортирует все справочники через @aemr/shared/dictionaries.
 * Добавляйте новые файлы сюда сразу при создании.
 *
 * Порядок экспортов соответствует §2 плана AEMR_DICTIONARIES_PLAN.md:
 * сначала реестры организаций, затем методологические, правовые, ролевые.
 */

// ── Реестры организаций ──────────────────────────────────────
export * from './grbs-registry.js';
export * from './subordinate-registry.js';

// ── Методологические справочники ─────────────────────────────
export * from './method-families.js';
export * from './activity-types.js';
export * from './budget-sources.js';

// ── Правовые и аналитические ─────────────────────────────────
export * from './legal-refs.js';
export * from './ep-reason-clusters.js';

// ── Таксономия сигналов ───────────────────────────────────────
export * from './signals-taxonomy.js';

// ── Роли пользователей ────────────────────────────────────────
export * from './user-roles.js';

// ── Бюджетная классификация (скелеты, fill from source) ───────
export * from './kvr.js';
export * from './kosgu.js';
