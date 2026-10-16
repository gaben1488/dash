// Read-only exact-candidate validation. Receipts and credentials never leave VPS.
/* global require, module, fetch, AbortSignal, console, process */
/* eslint-disable @typescript-eslint/no-require-imports -- CJS runs as node -e in the existing image, without installing a module. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function loadCandidate(input, packageFile) {
  const installed = createRequire(packageFile);
  const ts = installed('typescript');
  const compile = (source, dependencies) => {
    const module = { exports: {} };
    const requireApproved = (name) => {
      if (!Object.hasOwn(dependencies, name)) throw new Error('UNAPPROVED_PROBE_IMPORT');
      return dependencies[name];
    };
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    new Function('require', 'exports', 'module', compiled)(requireApproved, module.exports, module);
    return module.exports;
  };
  const registry = compile(input.registry, {});
  return compile(input.schemas, { zod: installed('zod'), './department-registry.js': registry });
}

const fields = new Set(['contract', 'user_action_count', 'engine_action_count', 'source_observations',
  'nonprocurement_identity_observations', 'fully_automated', 'active_recommendations', 'link_status_counts',
  'action_status_counts', 'actions', 'meaning', 'events', 'kind', 'target', 'field', 'column', 'quote',
  'source_text', 'evidence_kind', 'source_row_key', 'selected', 'attempt', 'latest_matching', 'release_id',
  'snapshot_id', 'report_date', 'cutoff_at', 'published_at', 'model_sha256', 'rules_version', 'renderer_version',
  'status', 'report_year', 'quarter', 'operational_available', 'automation_assurance', 'weekly_summary']);
function invalidFields(parsed) {
  return parsed.success ? [] : [...new Set(parsed.error.issues.map(issue =>
    issue.path.filter(part => fields.has(part)).join('.') + ':' + issue.code))].slice(0, 16);
}

function checkAssurance(schema, value) {
  if (value === undefined) return { accepted: true, version: 'absent' };
  const parsed = schema.safeParse(value);
  return { accepted: parsed.success, version: parsed.success ? parsed.data.contract : 'invalid', invalid_fields: invalidFields(parsed) };
}

/** Only called with a schema-validated envelope; receipts and IDs stay private. */
function selectionShape(value) {
  const selected = value.selected ?? null, matching = value.latest_matching ?? null;
  return { selected_present: selected !== null, latest_matching_present: matching !== null,
    same_release: selected && matching ? selected.release_id === matching.release_id : null };
}

function* models(root) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('UNSAFE_PROBE_SOURCE');
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('UNSAFE_PROBE_SOURCE');
    if (entry.isDirectory()) yield* models(file);
    else if (entry.isFile() && entry.name === 'report_model.json') yield file;
  }
}

async function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const schemas = loadCandidate(input, '/app/packages/shared/package.json');
  const root = '/app/packages/server/data/reports';
  const totals = { absent: 0, 'actionable-assurance-v1': 0, 'actionable-assurance-v2': 0, invalid: 0 };
  const failures = new Set();
  for (const folder of [path.join(root, 'published/releases'), ...fs.readdirSync(path.join(root, 'archives'))
    .filter(name => name.startsWith('WEEKLY-')).map(name => path.join(root, 'archives', name))]) {
    for (const file of models(folder)) {
      const checked = checkAssurance(schemas.ReportAssuranceSchema, JSON.parse(fs.readFileSync(file, 'utf8')).automation_assurance);
      totals[checked.version] += 1;
      for (const field of checked.invalid_fields || []) failures.add(field);
    }
  }
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kamchatka',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const url = 'http://server:3000/api/report-releases?date=' + day + '&year=' + day.slice(0, 4)
    + '&quarter=' + Math.ceil(Number(day.slice(5, 7)) / 3);
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + (process.env.AEMR_API_KEY || '') },
    signal: AbortSignal.timeout(25000) });
  const parsed = response.status === 200 ? schemas.SelectedReportReleaseStatusSchema.safeParse(await response.json()) : null;
  const accepted = totals.invalid === 0 && totals['actionable-assurance-v2'] > 0 && parsed?.success === true && parsed.data.selected !== null;
  console.log(JSON.stringify({ candidate_schema_history: accepted ? 'PASS' : 'FAIL', historical_model_presentations: totals,
    historical_invalid_fields: [...failures].slice(0, 16), current_invalid_fields: parsed ? invalidFields(parsed) : [],
    current_selected_response: parsed?.success ? 'PASS' : 'FAIL', http_status: response.status,
    current_selection: parsed?.success ? selectionShape(parsed.data) : null }));
  process.exitCode = accepted ? 0 : 2;
}

module.exports = { loadCandidate, checkAssurance, selectionShape, main };
if (require.main === module) main().catch(() => { console.log('CANDIDATE_SCHEMA_PROBE_FAILED'); process.exitCode = 2; });
