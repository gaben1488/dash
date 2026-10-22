// Only the prototype uses this exporter. Production retains its own export.
// Escape the semicolon-delimited CSV correctly, including quotes and newlines.
function csvCell(value, textField = false) {
  const original = value == null ? '' : String(value);
  // Quoting alone does not stop spreadsheet formula evaluation after import.
  // Only free-text fields are escaped this way; genuine numeric amounts stay numeric.
  const safe = textField && /^\s*[=+\-@]/u.test(original) ? "'" + original : original;
  return /[;"\r\n]/u.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function serializeSelectionCsv(rows) {
  const lines = [
    ['№', 'Управление', 'Предмет', 'План, тыс. руб.', 'Факт, тыс. руб.'].map(x => csvCell(x)).join(';'),
    ...rows.map(r => [
      csvCell(r.number, true),
      csvCell(r.dept, true),
      csvCell(r.subject, true),
      csvCell(r.plan),
      csvCell(r.fact),
    ].join(';')),
  ];
  return lines.join('\r\n');
}
