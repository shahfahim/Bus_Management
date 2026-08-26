import { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { registerSchema } from './auth.schemas.js';

const common = {
  name: 'Registration User',
  email: 'person@gmail.com',
  password: 'StrongPassword1',
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

  it('does not require a student ID for teachers', () => {
    const result = registerSchema.parse({ ...common, role: Role.TEACHER, department: 'Engineering' });
    expect(result.role).toBe(Role.TEACHER);
    expect(result).not.toHaveProperty('studentId');
  });

  it('requires driver credentials instead of a student ID', () => {
    const result = registerSchema.parse({
      ...common,
      role: Role.DRIVER,
      employeeNumber: 'DRV-100',
      licenseNumber: 'LIC-100',
      licenseExpiresAt: '2035-01-01',
    });
    expect(result.role).toBe(Role.DRIVER);
    expect(result).not.toHaveProperty('studentId');
  });
});
