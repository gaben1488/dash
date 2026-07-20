import { describe, expect, it } from 'vitest';
import { filterDeltas } from './deltas-filtering';

const deltas = [
  { metricKey: 'grbs.uer.kp.q1.count', delta: 2 },
  { metricKey: 'grbs.uio.ep.q1.count', delta: -1 },
  { delta: 0 }, // без metricKey
];

describe('filterDeltas (извлечено из useFilteredData §5)', () => {
  it('фильтра нет — все проходят (та же ссылка)', () => {
    expect(filterDeltas(deltas, new Set(), false)).toBe(deltas);
  });

  it('матчит депт из позиции 1 metricKey по любой форме ключа (Б5)', () => {
    const out = filterDeltas(deltas, new Set(['УЭР', 'uer']), true);
    expect(out.map(d => d.metricKey)).toEqual(['grbs.uer.kp.q1.count', undefined]);
  });

  it('дельта без metricKey проходит всегда', () => {
    const out = filterDeltas(deltas, new Set(['нет-такого']), true);
    expect(out).toEqual([{ delta: 0 }]);
  });
});
