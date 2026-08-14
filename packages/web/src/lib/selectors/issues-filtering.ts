/**
 * Фильтрация замечаний (issues) по осям ГРБС / подвед / поиск / вид деятельности.
 *
 * Извлечено move-only из useFilteredData.ts §4 (:203–229), §4b (:231–238)
 * и severity-разбиение (:843–844), разрез E11-1.
 *
 * ВНИМАНИЕ (спека filter-system-target-2026-07-16 §3.4): двухформенный матчинг
 * депт-ключей (selectedDeptBothForms) умирает при канонизации DepartmentId
 * в FilterContext; до резки — обе формы (Б5).
 */
import { isRetiredIssue } from '../diagnostics/mechanism-groups';

export function filterIssues(allIssues: any[], opts: {
  hasDeptFilter: boolean;
  /** Обе формы выбранных ключей ГРБС (кириллица+латиница), см. bothDeptKeyForms */
  selectedDeptBothForms: Set<string>;
  selectedSubordinates: Set<string>;
  normalizedSearch: string;
  selectedActivities: Set<string>;
}): any[] {
  const { hasDeptFilter, selectedDeptBothForms, selectedSubordinates, normalizedSearch, selectedActivities } = opts;
  const hasSubFilter = selectedSubordinates.size > 0;

  // Проверки, снятые каноном (td_with_program, п.30 интервью 14.08.2026):
  // ядро их больше не рождает, но старые снимки могут хранить такие записи —
  // на экран (полоса, счётчики сигналов, список «Контроля») они не выходят.
  // Массив пересобирается только при реальной находке: без фильтров функция
  // обязана возвращать ту же ссылку (контракт memo-цепочки useFilteredData).
  if (allIssues.some((i: any) => isRetiredIssue(i ?? {}))) {
    allIssues = allIssues.filter((i: any) => !isRetiredIssue(i ?? {}));
  }

  // Обе формы ключа ГРБС (кириллица+латиница): данные разного происхождения
  // несут разные формы, сравнение по одной форме молча пропускало фильтр (Б5).
  let issues = hasDeptFilter
    ? allIssues.filter((i: any) => {
        if (!i.departmentId) return true;
        return selectedDeptBothForms.has(i.departmentId) || selectedDeptBothForms.has(i.department);
      })
    : allIssues;

  if (hasSubFilter) {
    issues = issues.filter((i: any) => {
      // Issues without subordinateId pass through (org-level issues)
      if (!i.subordinateId) return true;
      return selectedSubordinates.has(i.subordinateId);
    });
  }

  if (normalizedSearch) {
    issues = issues.filter((i: any) => {
      const title = (i.title ?? '').toLowerCase();
      const desc = (i.description ?? '').toLowerCase();
      const dept = (i.departmentId ?? '').toLowerCase();
      return title.includes(normalizedSearch) || desc.includes(normalizedSearch) || dept.includes(normalizedSearch);
    });
  }

  // §4b. Activity filter for issues (multi-select)
  if (selectedActivities.size > 0) {
    issues = issues.filter((i: any) => {
      // Issues without activityType (СВОД-level, mapping) pass through
      if (!i.activityType) return true;
      return selectedActivities.has(i.activityType);
    });
  }

  return issues;
}

/**
 * Оси шапки, которые объявлены для Замечаний, но не подкреплены данными.
 *
 * Замечание (`Issue` в @aemr/shared) не несёт ни периода данных, ни способа
 * закупки: конвейер строит его из строки листа, но плановый квартал (колонка O)
 * и способ (колонка K) в запись не переносит. Единственное временное поле —
 * `detectedAt` — это момент ПРОГОНА конвейера, одинаковый у всех замечаний
 * снимка, а на экране он и вовсе подменяется `lastRefreshed`; резать по нему
 * значит выдать за фильтр периода фильтр по времени последнего обновления.
 * Канон карты оси времени, класс Е: «у замечаний нет даты, detectedAt — фейк»
 * (`docs/superpowers/specs/2026-08-07-time-axis-map.md`).
 *
 * Поэтому фильтр не имитируется: ось объявляется отсутствующей, интерфейс
 * говорит об этом вслух. `issueAxesWithoutData` — страж от протухания подписи:
 * как только конвейер начнёт носить поле, ось исчезнет из списка, и подпись
 * «не применяется» перестанет печататься раньше, чем станет ложью.
 */
export type IssueAxisId = 'period' | 'procurement';

export interface IssueAxisGap {
  id: IssueAxisId;
  /** Название оси так, как она подписана в шапке. */
  label: string;
  /** Чего именно нет в данных — предъявимая причина, а не «не поддерживается». */
  reason: string;
}

/** Поля-зонды: непустое значение хотя бы у одного замечания = ось появилась. */
const AXIS_PROBE_FIELDS: Record<IssueAxisId, readonly string[]> = {
  // detectedAt сознательно НЕ зонд: это время прогона, а не период данных.
  period: ['planQuarter', 'planYear', 'factQuarter', 'planDate', 'factDate', 'periodKey'],
  procurement: ['method', 'procurementMethod'],
};

const ISSUE_AXES_REQUIRING_DATA: readonly IssueAxisGap[] = [
  {
    id: 'period',
    label: 'Период',
    reason: 'у замечания нет ни планового, ни фактического квартала: конвейер не переносит их из строки листа',
  },
  {
    id: 'procurement',
    label: 'Способ закупки (КП/ЕП)',
    reason: 'у замечания нет способа закупки: конвейер не переносит его из строки листа',
  },
];

/** Оси, которых нет в переданной выборке замечаний. Пустой список = обе оси доступны. */
export function issueAxesWithoutData(issues: readonly unknown[]): IssueAxisGap[] {
  return ISSUE_AXES_REQUIRING_DATA.filter(gap => !issues.some(issue => {
    const record = issue as Record<string, unknown> | null | undefined;
    if (!record) return false;
    return AXIS_PROBE_FIELDS[gap.id].some(field => {
      const value = record[field];
      return value !== undefined && value !== null && value !== '';
    });
  }));
}

/** Severity-разбиение отфильтрованных issues (бывшие :843–844). */
export function splitIssuesBySeverity(issues: any[]): { criticalIssues: any[]; warningIssues: any[] } {
  return {
    criticalIssues: issues.filter((i: any) => i.severity === 'critical' || i.severity === 'error'),
    warningIssues: issues.filter((i: any) => i.severity === 'warning' || i.severity === 'significant'),
  };
}
