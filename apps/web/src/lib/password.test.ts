import { describe, expect, it } from 'vitest';
import { passwordProblem } from './password';

describe('password rule', () => {
  it('accepts any letter case with a number and a special character', () => {
    expect(passwordProblem('abc12!')).toBeUndefined();
    expect(passwordProblem('ABC12!')).toBeUndefined();
  });

  it('names what is missing', () => {
    expect(passwordProblem('a1!')).toMatch(/6 characters/);
    expect(passwordProblem('123456!')).toMatch(/letter/);
    expect(passwordProblem('abcdef!')).toMatch(/number/);
    expect(passwordProblem('abc123')).toMatch(/special/);
  });
});
