import { describe, expect, it } from 'vitest';
import { strongPassword } from './password-policy.js';

const policy = strongPassword();

describe('password policy', () => {
  it('accepts 6+ characters with a letter, a number and a special character, in any case', () => {
    for (const password of ['abc12!', 'ABC12!', 'bus@2026', 'মেট্রো১#']) expect(policy.safeParse(password).success).toBe(true);
  });

  it('rejects passwords that are too short or miss a required kind of character', () => {
    expect(policy.safeParse('ab1!').success).toBe(false);
    expect(policy.safeParse('abcdef!').success).toBe(false);
    expect(policy.safeParse('123456!').success).toBe(false);
    expect(policy.safeParse('abc123').success).toBe(false);
    expect(policy.safeParse('abc 123').success).toBe(false);
    // Bangla vowel signs are letters' marks, not special characters.
    expect(policy.safeParse('মেট্রো১২').success).toBe(false);
  });
});
