import { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { registerSchema } from './auth.schemas.js';

const common = {
  name: 'Registration User',
  email: 'person@gmail.com',
  password: 'student@2026',
};

describe('role-aware registration validation', () => {
  it('requires a student ID and department for students', () => {
    expect(() => registerSchema.parse({ ...common, role: Role.STUDENT })).toThrow();
    expect(registerSchema.parse({
      ...common,
      role: Role.STUDENT,
      studentId: 'STU-100',
      department: 'Computer Science',
    }).role).toBe(Role.STUDENT);
  });
});
