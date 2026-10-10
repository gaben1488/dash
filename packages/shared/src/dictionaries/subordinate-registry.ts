/**
 * subordinate-registry.ts — Реестр подведомственных учреждений АЕМР.
 *
 * Источник: ЖИВЫЕ книги ГРБС, колонка C листа «ВСЕ» (наименование
 * подведомственного учреждения). Сверка с живыми данными: 14.08.2026.
 * canonicalName хранит ДОСЛОВНОЕ значение ячейки C (включая вид кавычек),
 * чтобы сличение со строками книг работало строковым равенством.
 * Повторная сверка после миграции R→E от 10.10.2026 привела 65 названий
 * к текущей колонке C, сохранила slug-ID и прежние значения как aliases.
 * Исторические дубли фильтра не могут восстанавливаться из старых срезов.
 *
 * Структура по книгам (14.08.2026):
 *   УО      — 43 учреждения (21 детсад, 18 школ, 3 доп. обр., 1 МКУ)
 *             + категории строк «Администрирование», «Опека», «Совместные закупки»
 *   УКСиМП  — 20 учреждений (7 школ искусств, 5 спортивных, 7 культуры, 1 МКУ)
 *             + категория «Совместная закупка»
 *   УАГиЗО  — 1 (МКУ «Елизовское РУС») + само управление
 *   УИО     — 0 (само управление; в графе C только «Х»)
 *   УФБП    — 0 (собственный реестр)
 *   УД      — 1 (МКУ «ЕДДС») + само управление
 *   УЭР     — 1 (МКУ «ЦЭР») + само управление
 *   УДТХ    — 0 (бесподведное)
 *
 * Канон заглушек: «X/x/Х/х», тире, «н/д» и пустая ячейка C означают закупку
 * САМОГО управления (решение владельца 14.08.2026, п.51 интервью) — это не
 * подвед. Единый предикат: `isOrgItself()` в `org-itself.ts`; в реестре такие
 * строки представлены записью `*_org_itself`.
 *
 * История: до 14.08.2026 здесь была демо-заглушка «3 примера на ГРБС» с
 * ВЫДУМАННЫМИ учреждениями (МКУ «Культурный центр Елизово»/«КЦЕ»,
 * МКУ «Спортивная школа»). Они просачивались в интерфейс рядом с реальными
 * подведами и завышали счётчик Пульта (23 вместо 22 у УКСиМП). Выдуманных
 * записей в реестре быть не должно: источник — только книги.
 *
 * ИНН, КПП, ОКАТО — заполнить при получении реестра от АЕМР.
 *
 * Пробел GAP L4.2, сверка 18.08.2026: три поля ниже (`inn`, `kpp`, `okato`)
 * не заполнены ни у одной записи и НИГДЕ не читаются — ни сервером, ни
 * интерфейсом (проверено поиском по всем пакетам: совпадения на `inn`
 * приходят из мониторинга закупок, где это ИНН победителя из другого
 * источника). Значит пустота на экран не выходит и никого не вводит в
 * заблуждение; пробел остаётся открытым до получения реестра от АЕМР.
 * Если поля соберутся показывать — сперва заполнить, иначе в карточке
 * подведа появятся пустые строки без объяснения.
 */

import { toGrbsId, type GrbsId } from './grbs-registry.js';

// ────────────────────────────────────────────────────────────
// 1. Интерфейс записи подведа
// ────────────────────────────────────────────────────────────

export interface SubordinateEntry {
  /** Уникальный ID подведомственного учреждения (slug для URL и metricKey) */
  id: string;
  /** Дословное значение колонки C листа «ВСЕ» (ключ сличения с книгой) */
  canonicalName: string;
  /** Проверенная прежняя запись колонки C; только для преемственности исторических срезов. */
  legacyCanonicalName?: string;
  /** Отображаемое имя в UI (сокращённое, но однозначное) */
  displayName: string;
  /** Очень короткое обозначение для таблиц и легенд */
  shortName: string;
  /** ГРБС, которому подчинено учреждение */
  grbsId: GrbsId;
  /** ИНН (TODO: заполнить из реестра АЕМР) */
  inn?: string;
  /** КПП (TODO: заполнить из реестра АЕМР) */
  kpp?: string;
  /** Код ОКАТО (TODO: заполнить из реестра АЕМР) */
  okato?: string;
  /**
   * Признак «само управление как строка данных».
   * Когда колонка C пуста или содержит заглушку (X/Х/тире/«н/д» —
   * см. isOrgItself в org-itself.ts) — строка принадлежит самому ГРБС.
   * В этом случае subordinateId = '_org_itself'.
   */
  isOrgItself?: true;
  /**
   * Имя листа в dept-файле ГРБС (если отдельный лист).
   * Undefined означает, что данные агрегированы в листе «Все» или «ВСЕ».
   */
  sheetName?: string;
  /**
   * Категория строк, не являющаяся юрлицом («Совместные закупки»,
   * «Администрирование», «Опека»): значение колонки C реально существует
   * в книге, но обозначает направление, а не учреждение.
   */
  isCategory?: true;
  /** Тип учреждения для группировки в UI */
  orgType: 'mkу' | 'school' | 'kindergarten' | 'additional_education' | 'culture' | 'sport' | 'other' | 'org_itself';
}

// ────────────────────────────────────────────────────────────
// 2. Реестр учреждений (дословно по книгам, сверка 14.08.2026)
// ────────────────────────────────────────────────────────────

export const SUBORDINATE_REGISTRY: SubordinateEntry[] = [

  // ── УО: Управление образования (43 учреждения + категории + _org_itself) ──

  {
    id: 'uo_org_itself',
    canonicalName: 'Управление образования АЕМР',
    displayName: 'УО (орг.)',
    shortName: 'УО',
    grbsId: 'УО',
    isOrgItself: true,
    orgType: 'org_itself',
  },

  // Детские сады (21)
  { id: 'uo_ds01_lastochka', canonicalName: 'МАДОУ "Детский сад № 1 "Ласточка"',
    legacyCanonicalName: 'МАДОУ ДС № 1 «Ласточка»', displayName: 'ДС № 1 «Ласточка»', shortName: 'ДС 1', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds02_zhemchuzhinka', canonicalName: 'МБДОУ "Детский сад № 2 "Жемчужинка"',
    legacyCanonicalName: 'МБДОУ ДС № 2 «Жемчужинка»', displayName: 'ДС № 2 «Жемчужинка»', shortName: 'ДС 2', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds03_zharptitsa', canonicalName: 'МБДОУ "Детский сад № 3 "Жар-птица"',
    legacyCanonicalName: 'МБДОУ ДС № 3 «Жар-Птица»', displayName: 'ДС № 3 «Жар-Птица»', shortName: 'ДС 3', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds04_malysh', canonicalName: 'МБДОУ "Детский сад № 4 "Малыш"',
    legacyCanonicalName: 'МБДОУ ДС № 4 «Малыш»', displayName: 'ДС № 4 «Малыш»', shortName: 'ДС 4', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds05_romashka', canonicalName: 'МБДОУ "Детский сад № 5 "Ромашка"',
    legacyCanonicalName: 'МБДОУ ДС № 5 «Ромашка»', displayName: 'ДС № 5 «Ромашка»', shortName: 'ДС 5', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds08_alyonushka', canonicalName: 'МБДОУ "Детский сад № 8 "Алёнушка"',
    legacyCanonicalName: 'МБДОУ ДС № 8 «Алёнушка»', displayName: 'ДС № 8 «Алёнушка»', shortName: 'ДС 8', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds09_zvezdochka', canonicalName: 'МБДОУ "Детский сад № 9 "Звездочка"',
    legacyCanonicalName: 'МБДОУ ДС № 9 «Звёздочка»', displayName: 'ДС № 9 «Звёздочка»', shortName: 'ДС 9', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds10_raduga', canonicalName: 'МБДОУ "Детский сад № 10 "Радуга"',
    legacyCanonicalName: 'МБДОУ ДС № 10 «Радуга»', displayName: 'ДС № 10 «Радуга»', shortName: 'ДС 10', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds11_umka', canonicalName: 'МБДОУ "Детский сад № 11 "Умка"',
    legacyCanonicalName: 'МБДОУ ДС № 11 «Умка»', displayName: 'ДС № 11 «Умка»', shortName: 'ДС 11', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds12_ulybka', canonicalName: 'МБДОУ "Детский сад № 12 "Улыбка"',
    legacyCanonicalName: 'МБДОУ ДС № 12 «Улыбка»', displayName: 'ДС № 12 «Улыбка»', shortName: 'ДС 12', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds14_skazka', canonicalName: 'МБДОУ "Детский сад № 14 "Сказка"',
    legacyCanonicalName: 'МБДОУ ДС № 14 «Сказка»', displayName: 'ДС № 14 «Сказка»', shortName: 'ДС 14', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds20_antoshka', canonicalName: 'МБДОУ "Детский сад № 20 "Антошка"',
    legacyCanonicalName: 'МБДОУ ДС № 20 «Антошка»', displayName: 'ДС № 20 «Антошка»', shortName: 'ДС 20', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds22_veselinka', canonicalName: 'МБДОУ "Детский сад № 22 "Веселинка"',
    legacyCanonicalName: 'МБДОУ ДС № 22 «Веселинка»', displayName: 'ДС № 22 «Веселинка»', shortName: 'ДС 22', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds23_vasilyok', canonicalName: 'МБДОУ "Детский сад № 23 "Василек"',
    legacyCanonicalName: 'МБДОУ ДС № 23 «Василёк»', displayName: 'ДС № 23 «Василёк»', shortName: 'ДС 23', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds24_zhuravlik', canonicalName: 'МБДОУ "Детский сад № 24 "Журавлик"',
    legacyCanonicalName: 'МБДОУ ДС № 24 «Журавлик»', displayName: 'ДС № 24 «Журавлик»', shortName: 'ДС 24', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds26_rosinka', canonicalName: 'МБДОУ "Детский сад № 26 "Росинка"',
    legacyCanonicalName: 'МБДОУ ДС № 26 «Росинка»', displayName: 'ДС № 26 «Росинка»', shortName: 'ДС 26', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds27_pochemuchka', canonicalName: 'МБДОУ "Детский сад № 27 "Почемучка"',
    legacyCanonicalName: 'МБДОУ ДС № 27 «Почемучка»', displayName: 'ДС № 27 «Почемучка»', shortName: 'ДС 27', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds28_ryabinushka', canonicalName: 'МБДОУ "Детский сад № 28 "Рябинушка"',
    legacyCanonicalName: 'МБДОУ ДС № 28 «Рябинушка»', displayName: 'ДС № 28 «Рябинушка»', shortName: 'ДС 28', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds31_solnyshko', canonicalName: 'МБДОУ "Детский сад № 31 "Солнышко"',
    legacyCanonicalName: 'МБДОУ ДС № 31 «Солнышко»', displayName: 'ДС № 31 «Солнышко»', shortName: 'ДС 31', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds36_rucheyok', canonicalName: 'МБДОУ № 36',
    legacyCanonicalName: 'МБДОУ ДС № 36 «Ручеёк»', displayName: 'ДС № 36 «Ручеёк»', shortName: 'ДС 36', grbsId: 'УО', orgType: 'kindergarten' },
  { id: 'uo_ds37_belochka', canonicalName: 'МБДОУ "Детский сад № 37 "Белочка"',
    legacyCanonicalName: 'МБДОУ ДС № 37 «Белочка»', displayName: 'ДС № 37 «Белочка»', shortName: 'ДС 37', grbsId: 'УО', orgType: 'kindergarten' },

  // Школы (18)
  { id: 'uo_school_nsh5', canonicalName: 'МБОУ Елизовская НШ № 5',
    legacyCanonicalName: 'МБОУ «Елизовская начальная школа № 5»', displayName: 'ЕНШ № 5', shortName: 'НШ 5', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_osh4', canonicalName: 'МБОУ ЕОШ№ 4',
    legacyCanonicalName: 'МБОУ «Елизовская основная школа № 4»', displayName: 'ЕОШ № 4', shortName: 'ОШ 4', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_ssh1', canonicalName: 'МБОУ ЕСШ № 1 им.М.В.Ломоносова',
    legacyCanonicalName: 'МБОУ «Елизовская средняя школа № 1 имени М.В.Ломоносова»', displayName: 'ЕСШ № 1 им. Ломоносова', shortName: 'СШ 1', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_ssh2', canonicalName: 'МБОУ "ЕСШ № 2 им. Героя Советского Союза Г.С. Кузнецова"',
    legacyCanonicalName: 'МБОУ «Елизовская средняя школа № 2 им. Героя Советского Союза Г.С. Кузнецова»', displayName: 'ЕСШ № 2 им. Кузнецова', shortName: 'СШ 2', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_ssh3', canonicalName: 'МБОУ "ЕСШ № 3"',
    legacyCanonicalName: 'МБОУ «Елизовская средняя школа № 3»', displayName: 'ЕСШ № 3', shortName: 'СШ 3', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_ssh7', canonicalName: 'МБОУ ЕСШ № 7 им. О.Н. Мамченкова',
    legacyCanonicalName: 'МБОУ «Елизовская средняя школа № 7 им. О.Н. Мамченкова»', displayName: 'ЕСШ № 7 им. Мамченкова', shortName: 'СШ 7', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_ssh8', canonicalName: 'МБОУ "ЕСШ № 8 им. В.Н.Орловского"',
    legacyCanonicalName: 'МБОУ «Елизовская средняя школа № 8 им. В.Н. Орловского»', displayName: 'ЕСШ № 8 им. Орловского', shortName: 'СШ 8', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_ssh9', canonicalName: 'МБОУ "ЕСШ № 9 им. Р.В.Федины"',
    legacyCanonicalName: 'МБОУ «Елизовская средняя школа № 9 им. Р.В.Федины»', displayName: 'ЕСШ № 9 им. Федины', shortName: 'СШ 9', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_koryakskaya', canonicalName: 'МБОУ "Корякская СШ"',
    legacyCanonicalName: 'МБОУ «Корякская средняя школа»', displayName: 'Корякская СШ', shortName: 'Корякская', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_lesnovskaya', canonicalName: 'МБОУ "Лесновская ОШ"',
    legacyCanonicalName: 'МБОУ «Лесновская основная школа»', displayName: 'Лесновская ОШ', shortName: 'Лесновская', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_nagornenskaya', canonicalName: 'МБОУ "Нагорненская СШ"',
    legacyCanonicalName: 'МБОУ «Нагорненская средняя школа»', displayName: 'Нагорненская СШ', shortName: 'Нагорненская', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_nachikinskaya', canonicalName: 'МБОУ "Начикинская СШ"',
    legacyCanonicalName: 'МБОУ «Начикинская средняя школа»', displayName: 'Начикинская СШ', shortName: 'Начикинская', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_nikolaevskaya', canonicalName: 'МБОУ Николаевская СШ',
    legacyCanonicalName: 'МБОУ «Николаевская средняя школа»', displayName: 'Николаевская СШ', shortName: 'Николаевская', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_paratunskaya', canonicalName: 'МБОУ "Паратунская СШ"',
    legacyCanonicalName: 'МБОУ «Паратунская средняя школа»', displayName: 'Паратунская СШ', shortName: 'Паратунская', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_pionerskaya', canonicalName: 'МБОУ Пионерская СШ',
    legacyCanonicalName: 'МБОУ «Пионерская средняя школа имени М. А. Евсюковой»', displayName: 'Пионерская СШ им. Евсюковой', shortName: 'Пионерская', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_razdolnenskaya', canonicalName: 'МБОУ "Раздольненская СШ"',
    legacyCanonicalName: 'МБОУ «Раздольненская средняя школа имени В.Н. Ролдугина»', displayName: 'Раздольненская СШ им. Ролдугина', shortName: 'Раздольненская', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_vulkannogo', canonicalName: 'МБОУ "СШ Вулканного ГП"',
    legacyCanonicalName: 'МБОУ «Средняя школа Вулканного городского поселения»', displayName: 'СШ Вулканного ГП', shortName: 'Вулканная', grbsId: 'УО', orgType: 'school' },
  { id: 'uo_school_termalnenskaya', canonicalName: 'МБОУ "Термальненская СШ" им. Героя Российской Федерации А. Н. Попова',
    legacyCanonicalName: 'МБОУ «Термальненская средняя школа» им. Героя РФ А.Н. Попова', displayName: 'Термальненская СШ им. Попова', shortName: 'Термальненская', grbsId: 'УО', orgType: 'school' },

  // Дополнительное образование (3)
  { id: 'uo_do_luch', canonicalName: 'МБУ ДО "Центр "Луч"',
    legacyCanonicalName: 'МБУ ДО «Центр «Луч»', displayName: 'Центр «Луч»', shortName: 'Луч', grbsId: 'УО', orgType: 'additional_education' },
  { id: 'uo_do_patriot', canonicalName: 'МБУ ДО ПЦ "Патриот"',
    legacyCanonicalName: 'МБУДО Подростковый центр «Патриот»', displayName: 'ПЦ «Патриот»', shortName: 'Патриот', grbsId: 'УО', orgType: 'additional_education' },
  { id: 'uo_do_tsdt', canonicalName: 'МБУДО "ЦДТ"',
    legacyCanonicalName: 'ЦДТ', displayName: 'ЦДТ', shortName: 'ЦДТ', grbsId: 'УО', orgType: 'additional_education' },

  // МКУ (1)
  {
    id: 'uo_mku_cboimto',
    canonicalName: 'МКУ ЦБОИМТО',
    legacyCanonicalName: 'Муниципальное казённое учреждение «Центр бухгалтерского обслуживания и материально-технического обеспечения»',
    displayName: 'МКУ ЦБОиМТО',
    shortName: 'ЦБОиМТО',
    grbsId: 'УО',
    orgType: 'mkу',
  },

  // Категории строк книги УО (не юрлица)
  { id: 'uo_cat_administrirovanie', canonicalName: 'УО (Администрирование)',
    legacyCanonicalName: 'Администрирование', displayName: 'Администрирование', shortName: 'Админ.', grbsId: 'УО', isCategory: true, orgType: 'other' },
  { id: 'uo_cat_opeka', canonicalName: 'УО (Опека)',
    legacyCanonicalName: 'Опека', displayName: 'Опека', shortName: 'Опека', grbsId: 'УО', isCategory: true, orgType: 'other' },
  { id: 'uo_cat_sovmestnye', canonicalName: 'Совместные закупки (УО)',
    legacyCanonicalName: 'Совместные закупки', displayName: 'Совместные закупки', shortName: 'СЗ', grbsId: 'УО', isCategory: true, orgType: 'other' },

  // ── УКСиМП: Управление культуры, спорта и молодёжной политики ─
  //    (20 учреждений + «Совместная закупка» + _org_itself = 22 позиции Пульта)

  {
    id: 'uksimp_org_itself',
    canonicalName: 'Управление культуры, спорта и молодёжной политики АЕМР',
    displayName: 'УКСиМП (орг.)',
    shortName: 'УКСиМП',
    grbsId: 'УКСиМП',
    isOrgItself: true,
    orgType: 'org_itself',
  },

  // Школы искусств и музыкальные школы (7)
  { id: 'uksimp_kdmsh', canonicalName: 'МБУ ДО КДМШ',
    legacyCanonicalName: 'МБУ ДО «КДМШ»', displayName: 'КДМШ', shortName: 'КДМШ', grbsId: 'УКСиМП', orgType: 'additional_education' },
  { id: 'uksimp_ndshi', canonicalName: 'МБУ ДО НДШИ',
    legacyCanonicalName: 'МБУ ДО «НДШИ»', displayName: 'НДШИ', shortName: 'НДШИ', grbsId: 'УКСиМП', orgType: 'additional_education' },
  { id: 'uksimp_rdmsh', canonicalName: 'МБУ ДО РДМШ',
    legacyCanonicalName: 'МБУ ДО «РДМШ»', displayName: 'РДМШ', shortName: 'РДМШ', grbsId: 'УКСиМП', orgType: 'additional_education' },
  { id: 'uksimp_dshi_termalny', canonicalName: 'МБУ ДО ДШИ п. Термальный',
    legacyCanonicalName: 'МБУ ДО «ДШИ п. Термальный»', displayName: 'ДШИ п. Термальный', shortName: 'ДШИ Терм.', grbsId: 'УКСиМП', orgType: 'additional_education' },
  { id: 'uksimp_edmsh', canonicalName: 'МБУ ДО ЕДМШ',
    legacyCanonicalName: 'МБУ ДО «ЕДМШ»', displayName: 'ЕДМШ', shortName: 'ЕДМШ', grbsId: 'УКСиМП', orgType: 'additional_education' },
  { id: 'uksimp_edhsh', canonicalName: 'МБУ ДО ЕДХШ',
    legacyCanonicalName: 'МБУ ДО «ЕДХШ»', displayName: 'ЕДХШ', shortName: 'ЕДХШ', grbsId: 'УКСиМП', orgType: 'additional_education' },
  { id: 'uksimp_vdshi', canonicalName: 'МБУ ДО ВДШИ', displayName: 'ВДШИ', shortName: 'ВДШИ', grbsId: 'УКСиМП', orgType: 'additional_education' },

  // Спортивные учреждения (5)
  { id: 'uksimp_ssh_lider', canonicalName: 'МБУ ДО СШ "Лидер"',
    legacyCanonicalName: 'МБУ ДО СШ «Лидер»', displayName: 'СШ «Лидер»', shortName: 'Лидер', grbsId: 'УКСиМП', orgType: 'sport' },
  { id: 'uksimp_ssh_ratibor', canonicalName: 'МБУ ДО СШ "Ратибор"',
    legacyCanonicalName: 'МБУ ДО СШ «Ратибор»', displayName: 'СШ «Ратибор»', shortName: 'Ратибор', grbsId: 'УКСиМП', orgType: 'sport' },
  { id: 'uksimp_sshor_krechet', canonicalName: 'МБУ ДО СШОР единоборств "Кречет"',
    legacyCanonicalName: 'МБУ ДО СШОР единоборств «КРЕЧЕТ»', displayName: 'СШОР единоборств «Кречет»', shortName: 'Кречет', grbsId: 'УКСиМП', orgType: 'sport' },
  { id: 'uksimp_sshor_lvs', canonicalName: 'МБУ ДО СШОР по ЛВС', displayName: 'СШОР по ЛВС', shortName: 'СШОР ЛВС', grbsId: 'УКСиМП', orgType: 'sport' },
  { id: 'uksimp_tsfks', canonicalName: 'МБУ ЦФКС ЕМР', displayName: 'ЦФКС ЕМР', shortName: 'ЦФКС', grbsId: 'УКСиМП', orgType: 'sport' },

  // Учреждения культуры (7)
  { id: 'uksimp_erkm', canonicalName: 'МБУК ЕРКМ',
    legacyCanonicalName: 'МБУК «ЕРКМ» (Музей)', displayName: 'ЕРКМ (музей)', shortName: 'Музей', grbsId: 'УКСиМП', orgType: 'culture' },
  { id: 'uksimp_zoopark', canonicalName: 'МБУК ЕРЗ',
    legacyCanonicalName: 'МБУК «Елизовский районный зоопарк»', displayName: 'Елизовский зоопарк', shortName: 'Зоопарк', grbsId: 'УКСиМП', orgType: 'culture' },
  { id: 'uksimp_erdk', canonicalName: 'МБУК ЕРДК',
    legacyCanonicalName: 'МБУК «ЕРДК»', displayName: 'ЕРДК', shortName: 'ЕРДК', grbsId: 'УКСиМП', orgType: 'culture' },
  { id: 'uksimp_dk_galaktika', canonicalName: 'МБУК ДК "Галактика"',
    legacyCanonicalName: 'МБУК ДК «Галактика»', displayName: 'ДК «Галактика»', shortName: 'Галактика', grbsId: 'УКСиМП', orgType: 'culture' },
  { id: 'uksimp_erk_rv', canonicalName: 'МБУК ЕРК по РВ', displayName: 'ЕРК по РВ', shortName: 'ЕРК РВ', grbsId: 'УКСиМП', orgType: 'culture' },
  { id: 'uksimp_mdkm_yunost', canonicalName: 'МБУК МДКМ "Юность"',
    legacyCanonicalName: 'МБУК МДКМ «Юность»', displayName: 'МДКМ «Юность»', shortName: 'Юность', grbsId: 'УКСиМП', orgType: 'culture' },
  { id: 'uksimp_mtsbs', canonicalName: 'МБУК МЦБС', displayName: 'МЦБС', shortName: 'МЦБС', grbsId: 'УКСиМП', orgType: 'culture' },

  // МКУ (1)
  {
    id: 'uksimp_mku_tsb_aho',
    canonicalName: 'МКУ ЦБАХО',
    legacyCanonicalName: 'МКУ «Центр бухгалтерского и административно-хозяйственного обеспечения учреждений культуры и спорта»',
    displayName: 'МКУ ЦБ и АХО культуры и спорта',
    shortName: 'ЦБ АХО КиС',
    grbsId: 'УКСиМП',
    orgType: 'mkу',
  },

  // Категория строк книги УКСиМП (не юрлицо)
  { id: 'uksimp_cat_sovmestnaya', canonicalName: 'Совместные закупки (УКСиМП)',
    legacyCanonicalName: 'Совместная закупка', displayName: 'Совместная закупка', shortName: 'СЗ', grbsId: 'УКСиМП', isCategory: true, orgType: 'other' },

  // ── УАГиЗО: Управление архитектуры, градостроительства и земельных отношений

  {
    id: 'uagizo_org_itself',
    canonicalName: 'Управление архитектуры, градостроительства и земельных отношений АЕМР',
    displayName: 'УАГиЗО (орг.)',
    shortName: 'УАГиЗО',
    grbsId: 'УАГиЗО',
    isOrgItself: true,
    orgType: 'org_itself',
  },
  {
    id: 'uagizo_mku_elrус',
    canonicalName: 'МКУ "Елизовское РУС"',
    legacyCanonicalName: 'МКУ «Елизовское РУС»',
    displayName: 'МКУ Елизовское РУС',
    shortName: 'Елизово РУС',
    grbsId: 'УАГиЗО',
    sheetName: 'ПОДВЕД_МКУ "Елизовское РУС"',
    orgType: 'mkу',
    // TODO: fill ИНН/КПП из реестра
  },

  // ── УИО: Управление имущественных отношений ──────────────────────────────

  {
    id: 'uio_org_itself',
    // Было «МКУ „Управление имущественных отношений АЕМР“» — СОЧИНЁННОЕ имя
    // с приписанным юридическим статусом, которого в книгах нет (у УИО в
    // графе учреждения только «Х»). Поймано владельцем 29.08.2026. Приведено
    // в ряд с остальными семью управлениями: честная развёртка без выдумок.
    canonicalName: 'Управление имущественных отношений АЕМР',
    displayName: 'УИО',
    shortName: 'УИО',
    grbsId: 'УИО',
    isOrgItself: true,
    sheetName: 'УИО',
    orgType: 'org_itself',
  },

  // ── УФБП: Управление финансово-бюджетной политики ────────────────────────

  {
    id: 'ufbp_org_itself',
    canonicalName: 'Управление финансово-бюджетной политики АЕМР',
    displayName: 'УФБП',
    shortName: 'УФБП',
    grbsId: 'УФБП',
    isOrgItself: true,
    sheetName: 'УФБП',
    orgType: 'org_itself',
  },

  // ── УД: Управление делами ─────────────────────────────────────────────────

  {
    id: 'ud_org_itself',
    canonicalName: 'Управление делами Администрации АЕМР',
    displayName: 'УД (орг.)',
    shortName: 'УД',
    grbsId: 'УД',
    isOrgItself: true,
    orgType: 'org_itself',
  },
  {
    id: 'ud_mku_edds',
    canonicalName: 'МКУ "ЕДДС ЕМР"',
    legacyCanonicalName: 'МКУ «ЕДДС»',
    displayName: 'МКУ ЕДДС',
    shortName: 'ЕДДС',
    grbsId: 'УД',
    sheetName: 'МКУ "ЕДДС"',
    orgType: 'mkу',
    // TODO: fill ИНН/КПП из реестра
  },

  // ── УЭР: Управление экономического развития ──────────────────────────────

  {
    id: 'uer_org_itself',
    canonicalName: 'Управление экономического развития АЕМР',
    displayName: 'УЭР (орг.)',
    shortName: 'УЭР',
    grbsId: 'УЭР',
    isOrgItself: true,
    orgType: 'org_itself',
  },
  {
    id: 'uer_mku_tser',
    canonicalName: 'МКУ "ЦЭР"',
    legacyCanonicalName: 'МКУ «ЦЭР»',
    displayName: 'МКУ ЦЭР',
    shortName: 'МКУ ЦЭР',
    grbsId: 'УЭР',
    sheetName: 'МКУ "ЦЭР"',
    orgType: 'mkу',
    // TODO: fill ИНН/КПП из реестра
  },

  // ── УДТХ: Управление дорожно-транспортного хозяйства ─────────────────────

  {
    id: 'udtx_org_itself',
    canonicalName: 'Управление дорожно-транспортного хозяйства АЕМР',
    displayName: 'УДТХ',
    shortName: 'УДТХ',
    grbsId: 'УДТХ',
    isOrgItself: true,
    sheetName: 'УДТХ',
    orgType: 'org_itself',
  },
];

// ────────────────────────────────────────────────────────────
// 3. Lookup helpers
// ────────────────────────────────────────────────────────────

const _byId = new Map<string, SubordinateEntry>(
  SUBORDINATE_REGISTRY.map(s => [s.id, s]),
);

const _byGrbs = new Map<GrbsId, SubordinateEntry[]>();
for (const s of SUBORDINATE_REGISTRY) {
  const arr = _byGrbs.get(s.grbsId) ?? [];
  arr.push(s);
  _byGrbs.set(s.grbsId, arr);
}

/** Получить запись подведа по slug-ID */
export function getSubordinate(id: string): SubordinateEntry | undefined {
  return _byId.get(id);
}

/**
 * Получить все подведы одного ГРБС.
 * Принимает любую форму идентификатора (GrbsId «УАГиЗО», DepartmentId «УАГЗО»,
 * alias) — нормализует через toGrbsId, поэтому форма данных/фильтра больше не
 * промахивается мимо реестра, ключёванного канонической формой.
 */
export function getSubordinatesByGrbs(grbsId: GrbsId | string): SubordinateEntry[] {
  const canonical = toGrbsId(grbsId);
  if (!canonical) return [];
  return _byGrbs.get(canonical) ?? [];
}

/**
 * Специальный sentinel для строк, где колонка C пуста.
 * В таких строках закупает само управление, а не подвед.
 */
export const ORG_ITSELF_SENTINEL = '_org_itself' as const;
