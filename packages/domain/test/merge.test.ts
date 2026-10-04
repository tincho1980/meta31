import { describe, expect, it } from 'vitest';
import { unstoredCandidates } from '../src/merge.js';

const c = (sourceKey: string) => ({ sourceKey });

describe('virtual + stored merge (D1)', () => {
  const candidates = [c('re:luz:2026-10-01'), c('ln:loan1:7'), c('cc:visa:2026-10-01:ARS')];

  it('keeps candidates that are not stored', () => {
    expect(unstoredCandidates(candidates, new Set())).toEqual(candidates);
  });

  it('drops a candidate whose key is stored, even if the stored row moved or was cancelled', () => {
    // ln:loan1:7 was postponed to November; re:luz was cancelled (paid by card, rule 2)
    const stored = new Set(['ln:loan1:7', 're:luz:2026-10-01']);
    expect(unstoredCandidates(candidates, stored)).toEqual([c('cc:visa:2026-10-01:ARS')]);
  });

  it('keys are compared exactly: another month or currency is another key', () => {
    const stored = new Set(['re:luz:2026-09-01', 'cc:visa:2026-10-01:USD']);
    expect(unstoredCandidates(candidates, stored)).toHaveLength(3);
  });
});
