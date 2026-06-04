// db_introspect.cjs — ground-truth интроспекция aemr.db (better-sqlite3).
// Список таблиц/views/индексов, число строк, колонки каждой таблицы.
// Usage: node scripts/db_introspect.cjs [path-to-db]
let Database;
for (const c of [
  'better-sqlite3',
  'C:/Users/filat/dash/node_modules/.pnpm/better-sqlite3@12.8.0/node_modules/better-sqlite3',
]) { try { Database = require(c); break; } catch (e) {} }
if (!Database) { console.error('cannot load better-sqlite3'); process.exit(1); }

const dbPath = process.argv[2] || 'C:/Users/filat/dash/packages/server/data/aemr.db';
const db = new Database(dbPath, { readonly: true });
const objs = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
const tables = objs.filter(o => o.type === 'table');
const views = objs.filter(o => o.type === 'view');
const indexes = objs.filter(o => o.type === 'index');
const triggers = objs.filter(o => o.type === 'trigger');

console.log(`DB: ${dbPath}`);
console.log(`tables=${tables.length} views=${views.length} indexes=${indexes.length} triggers=${triggers.length}`);

console.log('\n=== TABLES (rows | cols) ===');
for (const t of tables) {
  let n = '?';
  try { n = db.prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get().c; } catch (e) { n = 'ERR'; }
  const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
  console.log(`\n## ${t.name}  (${n} rows, ${cols.length} cols)`);
  console.log('   ' + cols.map(c => `${c.name}:${c.type}${c.pk ? '*' : ''}`).join(', '));
}

console.log('\n=== VIEWS ===');
if (views.length === 0) console.log('(нет ни одного view)');
for (const v of views) console.log(`- ${v.name}`);

console.log(`\n=== INDEXES: ${indexes.length}, TRIGGERS: ${triggers.length} ===`);
db.close();
