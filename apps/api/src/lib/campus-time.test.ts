import { describe, expect, it } from 'vitest';
import { campusDayEnd, campusDayStart } from './campus-time.js';

describe('campus day', () => {
  it('uses the Dhaka calendar day even when UTC is still on the previous date', () => {
    // 20:00 UTC on 22 Sep is 02:00 on 23 Sep in Dhaka.
    const instant = new Date('2026-09-22T20:00:00Z');
    expect(campusDayStart(instant).toISOString()).toBe('2026-09-22T18:00:00.000Z');
    expect(campusDayEnd(instant).toISOString()).toBe('2026-09-23T18:00:00.000Z');
  });
});
