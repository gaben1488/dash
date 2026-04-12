import { createDemoSnapshot } from './src/services/demo-data.js';

const s = createDemoSnapshot();
console.log('Snapshot ID:', s.id);
console.log('Trust:', s.trust.overall, s.trust.grade);
console.log('Metrics:', Object.keys(s.officialMetrics).length);
console.log('Issues:', s.issues.length);
console.log('Deltas:', s.deltas.length);
