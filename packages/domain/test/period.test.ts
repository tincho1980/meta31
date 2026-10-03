import { describe, expect, it } from 'vitest';
import { currentPeriod, todayInBuenosAires } from '../src/period.js';

describe('period', () => {
  it('calcula hoy en Buenos Aires, no en UTC', () => {
    // 1/11 02:00 UTC = 31/10 23:00 en Buenos Aires (UTC-3)
    const now = new Date('2026-11-01T02:00:00Z');
    expect(todayInBuenosAires(now)).toBe('2026-10-31');
    expect(currentPeriod(now)).toBe('2026-10-01');
  });

  it('el mes en curso siempre tiene día 1', () => {
    expect(currentPeriod(new Date('2026-10-15T15:00:00Z'))).toBe('2026-10-01');
  });
});
