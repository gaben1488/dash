import { afterEach, expect, it } from 'vitest';
import { officialProvenanceFor, setOfficialProvenance } from './provenance-registry';

afterEach(() => setOfficialProvenance(undefined));

it('never attributes a missing quarter or month to an annual source', () => {
  setOfficialProvenance({ 'competitive.year.count': { sourceSheet: 'СВОД', sourceCell: 'D20', numericValue: 20 } });
  expect(officialProvenanceFor('plan_count', 'q1')).toEqual([]);
  expect(officialProvenanceFor('plan_count', 'm1')).toEqual([]);
  expect(officialProvenanceFor('plan_count', 'year')).toHaveLength(1);
});

it('does not mix missing quarter operands with annual ones', () => {
  setOfficialProvenance({
    'competitive.q1.count': { sourceSheet: 'СВОД', sourceCell: 'D4', numericValue: 2 },
    'sole.year.count': { sourceSheet: 'СВОД', sourceCell: 'D30', numericValue: 50 },
  });
  expect(officialProvenanceFor('plan_count', 'q1').map(source => source.cell)).toEqual(['D4']);
});
