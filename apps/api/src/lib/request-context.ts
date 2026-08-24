export const normalizeRequestId = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  return undefined;
};
