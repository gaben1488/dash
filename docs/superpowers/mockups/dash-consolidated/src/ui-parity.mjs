/**
 * UI parity inventory. Real production components, not mock replacements.
 * Every blocked page needs a separate visual + functional acceptance before promotion.
 * Source: current Dash pages and the owner's consolidation contract (2026-10-10).
 */
export const UI_PARITY_PAGES = [
  {
    "id": "dashboard",
    "label": "Пульс",
    "source": "packages/web/src/pages/Dashboard.tsx",
    "preview": "Общая оболочка",
    "status": "excluded",
    "note": "Содержимое Пульса исключено из переделки. Его нельзя заменять демонстрационной страницей.",
    "modes": []
  },
  {
    "id": "report",
    "label": "Отчёт",
    "source": "packages/web/src/pages/Report.tsx",
    "preview": "Упрощённый образец",
    "status": "blocked",
    "note": "Сохранить документную структуру, сверку, доказательства, историю срезов и все проверенные Word-выпуски. Образец не заменяет ReportPage.",
    "modes": [
      {
        "id": "main",
        "label": "Отчёт в Word",
        "kind": "action",
        "marker": "word.download('main')"
      },
      {
        "id": "extra",
        "label": "Доп. отчёт в Word",
        "kind": "action",
        "marker": "word.download('extra')"
      },
      {
        "id": "operational",
        "label": "Оперативный в Word",
        "kind": "action",
        "marker": "word.download('operational')"
      },
      {
        "id": "week-deltas",
        "label": "Что изменилось за неделю",
        "kind": "section",
        "marker": "Что изменилось за неделю"
      }
    ]
  },
  {
    "id": "svod",
    "label": "Свод",
    "source": "packages/web/src/pages/SvodView.tsx",
    "preview": "Сокращённый пример",
    "status": "blocked",
    "note": "Сверять официальный СВОД с расчётами, не теряя кварталы, бюджеты, способы и исходные ячейки.",
    "modes": []
  },
  {
    "id": "data",
    "label": "Реестр",
    "source": "packages/web/src/pages/DataBrowser.tsx",
    "preview": "Демонстрационная таблица",
    "status": "blocked",
    "note": "Восстановить настоящие столбцы, сортировку, виртуализацию, редактирование, выгрузку и карточку строки.",
    "modes": [
      {
        "id": "browse",
        "label": "Просмотр",
        "kind": "tab",
        "marker": "viewMode === 'browse'"
      },
      {
        "id": "editor",
        "label": "Редактор таблиц",
        "kind": "tab",
        "marker": "viewMode === 'editor'"
      }
    ]
  },
  {
    "id": "unfunded",
    "label": "Не обеспеченные",
    "source": "packages/web/src/pages/DataBrowser.tsx",
    "preview": "Демонстрационный срез",
    "status": "blocked",
    "note": "Корзина определяется действующими правилами источника; отсутствие года в тестовом наборе не заменяет классификацию.",
    "modes": [
      {
        "id": "browse",
        "label": "Просмотр",
        "kind": "tab",
        "marker": "viewMode === 'browse'"
      },
      {
        "id": "editor",
        "label": "Редактор таблиц",
        "kind": "tab",
        "marker": "viewMode === 'editor'"
      }
    ]
  },
  {
    "id": "yearlong",
    "label": "В течение года",
    "source": "packages/web/src/pages/DataBrowser.tsx",
    "preview": "Демонстрационный срез",
    "status": "blocked",
    "note": "Сохранить правила годовой категории, виды закупок, статусы и реальный редактор без фиктивных фильтров.",
    "modes": [
      {
        "id": "browse",
        "label": "Просмотр",
        "kind": "tab",
        "marker": "viewMode === 'browse'"
      },
      {
        "id": "editor",
        "label": "Редактор таблиц",
        "kind": "tab",
        "marker": "viewMode === 'editor'"
      }
    ]
  },
  {
    "id": "monitoring",
    "label": "Мониторинг",
    "source": "packages/web/src/pages/Monitoring.tsx",
    "preview": "Демонстрация связей",
    "status": "blocked",
    "note": "Все режимы читают разные формы реестра процедур. Очередь, свод, связи, справочники и первоисточники не сводятся в один макетный список.",
    "modes": [
      {
        "id": "work",
        "label": "В работе",
        "kind": "mode",
        "marker": "label: 'В работе'",
        "markerSource": "packages/web/src/lib/monitoring/modes.ts"
      },
      {
        "id": "all",
        "label": "Реестр",
        "kind": "mode",
        "marker": "id: 'all'",
        "markerSource": "packages/web/src/lib/monitoring/modes.ts"
      },
      {
        "id": "svod",
        "label": "Обзор",
        "kind": "mode",
        "marker": "label: 'Обзор'",
        "markerSource": "packages/web/src/lib/monitoring/modes.ts"
      },
      {
        "id": "journal",
        "label": "Связи",
        "kind": "mode",
        "marker": "label: 'Связи'",
        "markerSource": "packages/web/src/lib/monitoring/modes.ts"
      },
      {
        "id": "directory",
        "label": "Справочники",
        "kind": "mode",
        "marker": "label: 'Справочники'",
        "markerSource": "packages/web/src/lib/monitoring/modes.ts"
      }
    ]
  },
  {
    "id": "economy",
    "label": "Экономия",
    "source": "packages/web/src/pages/Economy.tsx",
    "preview": "Аналитический пример",
    "status": "blocked",
    "note": "Сохранить независимые виды экономии и AD-гейт; не пересчитывать экономию как план минус факт.",
    "modes": []
  },
  {
    "id": "competition",
    "label": "Конкуренция",
    "source": "packages/web/src/pages/Competition.tsx",
    "preview": "Аналитический пример",
    "status": "blocked",
    "note": "Не подменять действующие сравнения КП и ЕП декоративной карточкой.",
    "modes": []
  },
  {
    "id": "discipline",
    "label": "Дисциплина",
    "source": "packages/web/src/pages/Discipline.tsx",
    "preview": "Аналитический пример",
    "status": "blocked",
    "note": "Показать доказанные действия и последствия без придуманного рейтинга наказаний.",
    "modes": []
  },
  {
    "id": "analytics",
    "label": "Аналитика",
    "source": "packages/web/src/pages/Analytics.tsx",
    "preview": "Аналитический пример",
    "status": "blocked",
    "note": "Сохранить реальные метрики, интерактивность, основание каждого числа и границы периода.",
    "modes": []
  },
  {
    "id": "quality",
    "label": "Контроль",
    "source": "packages/web/src/pages/Quality.tsx",
    "preview": "Упрощённая очередь",
    "status": "blocked",
    "note": "Не прятать шесть рабочих разделов за одной демонстрационной таблицей.",
    "modes": [
      {
        "id": "recon",
        "label": "Сверка",
        "kind": "tab",
        "marker": "id: 'recon', label: 'Сверка'"
      },
      {
        "id": "trust",
        "label": "Качество заполнения",
        "kind": "tab",
        "marker": "id: 'trust', label: 'Качество заполнения'"
      },
      {
        "id": "issues",
        "label": "Замечания",
        "kind": "tab",
        "marker": "id: 'issues', label: 'Замечания'"
      },
      {
        "id": "scorecard",
        "label": "Оценка управлений",
        "kind": "tab",
        "marker": "id: 'scorecard', label: 'Оценка управлений'"
      },
      {
        "id": "recs",
        "label": "Рекомендации",
        "kind": "tab",
        "marker": "id: 'recs', label: 'Рекомендации'"
      },
      {
        "id": "journal",
        "label": "Журнал",
        "kind": "tab",
        "marker": "id: 'journal', label: 'Журнал'"
      }
    ]
  },
  {
    "id": "settings",
    "label": "Система",
    "source": "packages/web/src/pages/Settings.tsx",
    "preview": "Настройки демонстрации",
    "status": "blocked",
    "note": "Реальные источники данных, соответствия ячеек и подключения нельзя заменять переключением палитр.",
    "modes": [
      {
        "id": "sources",
        "label": "Источники данных",
        "kind": "tab",
        "marker": "id: 'sources', label: 'Источники данных'"
      },
      {
        "id": "mapping",
        "label": "Соответствие ячеек",
        "kind": "tab",
        "marker": "id: 'mapping', label: 'Соответствие ячеек'"
      },
      {
        "id": "connection",
        "label": "Подключение",
        "kind": "tab",
        "marker": "id: 'connection', label: 'Подключение'"
      }
    ]
  }
];

export const UI_PAGE_IDS = UI_PARITY_PAGES.map(p => p.id);
export const UI_PARITY_READY = UI_PARITY_PAGES.every(p => p.status === 'accepted' || p.status === 'excluded');
/** QA deep link into the existing isolated prototype. It does NOT select a production subtab. */
export function hashForPage(id) {
  return '#/page/' + (UI_PAGE_IDS.includes(id) ? id : 'data');
}
export function pageFromHash(value) {
  const match = String(value ?? '').match(/^#\/page\/([a-z]+)$/);
  return match && UI_PAGE_IDS.includes(match[1]) ? match[1] : 'data';
}
