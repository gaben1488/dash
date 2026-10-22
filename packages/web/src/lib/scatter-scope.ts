/** The live comparison uses plan-date months, never the auxiliary O/P cells. */
export function scatterScope(input: {
  snapshotId?: string;
  year: number | 'all'; period: string; periodMode: string; activeMonths: ReadonlySet<number>;
  selectedDepartments: ReadonlySet<string>; selectedSubordinates: ReadonlySet<string>;
  activityFilter?: string; selectedActivities?: ReadonlySet<string>; procurementFilter?: string;
  deptOnlyMode?: ReadonlySet<string>; searchQuery?: string;
}): Record<string, string> {
  const params: Record<string, string> = { year: String(input.year) };
  if (input.snapshotId) params.snapshot_id = input.snapshotId;
  if (input.selectedDepartments.size) params.dept = [...input.selectedDepartments].sort().join(',');
  if (input.selectedSubordinates.size) params.subordinate = [...input.selectedSubordinates].sort().join(',');
  if (input.deptOnlyMode?.size) params.deptOnly = [...input.deptOnlyMode].sort().join(',');
  if (input.selectedActivities?.size) params.activity = [...input.selectedActivities].sort().join(',');
  else if (input.activityFilter && input.activityFilter !== 'all') params.activity = input.activityFilter;
  if (input.procurementFilter && input.procurementFilter !== 'all') params.type = input.procurementFilter;
  if (input.searchQuery?.trim()) params.search = input.searchQuery.trim();
  if (input.periodMode === 'explicit') {
    if (input.activeMonths.size) params.months = [...input.activeMonths].sort((a, b) => a - b).join(',');
    else params.period = input.period;
  }
  return params;
}
