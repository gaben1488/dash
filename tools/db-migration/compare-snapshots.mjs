import { readFileSync, writeFileSync } from 'node:fs';
import { reconcileSnapshots } from './identity-crosswalk.mjs';

// Local-only audited inputs. Never make a network request or write to source.
const [oldPath, newPath, decisionsPath, reportPath] = process.argv.slice(2);
if (!oldPath || !newPath) {
  process.stderr.write('Usage: node compare-snapshots.mjs old.json new.json [decisions.json] [report.json]\n');
  process.exitCode = 2;
} else {
  try {
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    const result = reconcileSnapshots({
      older: read(oldPath),
      newer: read(newPath),
      decisions: decisionsPath ? read(decisionsPath) : [],
    });
    const output = JSON.stringify(result, null, 2) + '\n';
    if (reportPath) writeFileSync(reportPath, output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    else process.stdout.write(output);
    if (result.summary.conflicts || result.summary.unresolvedOld || result.summary.unresolvedNew) process.exitCode = 1;
  } catch (error) {
    process.stderr.write('Migration audit input error: ' + String(error?.message ?? error) + '\n');
    process.exitCode = 2;
  }
}
