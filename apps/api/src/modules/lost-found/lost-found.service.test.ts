import { MatchStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { canTransitionLostFoundMatch } from './lost-found.service.js';

describe('lost-and-found match lifecycle', () => {
  it('permits only documented forward transitions', () => {
    expect(canTransitionLostFoundMatch(MatchStatus.SUGGESTED, MatchStatus.CONFIRMED)).toBe(true);
    expect(canTransitionLostFoundMatch(MatchStatus.SUGGESTED, MatchStatus.REJECTED)).toBe(true);
    expect(canTransitionLostFoundMatch(MatchStatus.CONFIRMED, MatchStatus.RESOLVED)).toBe(true);
    expect(canTransitionLostFoundMatch(MatchStatus.CONFIRMED, MatchStatus.REJECTED)).toBe(true);
  });

  it('keeps terminal states terminal and rejects repeated reviews', () => {
    expect(canTransitionLostFoundMatch(MatchStatus.REJECTED, MatchStatus.CONFIRMED)).toBe(false);
    expect(canTransitionLostFoundMatch(MatchStatus.RESOLVED, MatchStatus.REJECTED)).toBe(false);
    expect(canTransitionLostFoundMatch(MatchStatus.CONFIRMED, MatchStatus.CONFIRMED)).toBe(false);
  });
});
