import Database from 'better-sqlite3';
import fs from 'fs';
const db = new Database('C:/Users/filat/dash/packages/server/data/aemr.db', { readonly: true, fileMustExist: true });
const out = [];
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
out.push('TABLES: ' + tables.join(', '));
for (const t of tables) {
  try { const c = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; out.push(`${t}\t${c}`); } catch(e){ out.push(`${t}\tERR ${e.message}`); }
}
// journal-specific
for (const t of ['snapshots','audit_log','issue_history']) {
  if (!tables.includes(t)) continue;
  const col = t==='snapshots' ? 'created_at' : 'timestamp';
  try {
    const r = db.prepare(`SELECT MIN(${col}) mn, MAX(${col}) mx, COUNT(*) c FROM "${t}"`).get();
    out.push(`${t} range ${r.mn} .. ${r.mx} n=${r.c}`);
  } catch(e){ out.push(`${t} range ERR ${e.message}`); }
}
if (tables.includes('audit_log')) {
  const rows = db.prepare(`SELECT action, COUNT(*) c FROM audit_log GROUP BY action ORDER BY c DESC`).all();
  out.push('audit_log by action: ' + JSON.stringify(rows));
  const newest100 = db.prepare(`SELECT action, COUNT(*) c FROM (SELECT action FROM audit_log ORDER BY timestamp DESC LIMIT 100) GROUP BY action`).all();
  out.push('audit_log newest100 by action: ' + JSON.stringify(newest100));
}
fs.writeFileSync('C:/Users/filat/AppData/Local/Temp/claude/C--Users-filat-dash/d62f77a0-8ae8-4a83-bcfd-4d9009e386f2/scratchpad/q1.txt', out.join('\n'), 'utf8');
