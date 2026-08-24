import { z } from 'zod';
import { strongPassword } from '../../lib/password-policy.js';

const userPassword = strongPassword();

export const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: userPassword,
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(20).optional(),
  studentId: z.string().trim().min(2).max(40),
  department: z.string().trim().min(2).max(100),
  emergencyContact: z.string().trim().min(7).max(20).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: userPassword,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'The new password must be different from the current password',
  });
