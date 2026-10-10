// An explicitly empty selection means "show nothing", not "show everything".
// null is the only sentinel for an unrestricted axis.
export function toggleSelection(items, value) {
  const selected = items ?? [];
  return selected.includes(value)
    ? selected.filter(item => item !== value)
    : [...selected, value];
}
