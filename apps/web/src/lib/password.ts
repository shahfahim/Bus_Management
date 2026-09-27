// Same rule as the API (apps/api/src/lib/password-policy.ts): the server has the final say, this
// only saves a round trip and explains what is missing.
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_HINT = 'At least 6 characters, with a letter, a number and a special character (e.g. ! @ # $).';

/** Returns what the password is missing, or undefined when it meets the rule. */
export function passwordProblem(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/\p{L}/u.test(password)) return 'Add at least one letter.';
  if (!/\p{N}/u.test(password)) return 'Add at least one number.';
  if (!/[^\p{L}\p{M}\p{N}\s]/u.test(password)) return 'Add at least one special character, such as ! @ # $ or %.';
  return undefined;
}
