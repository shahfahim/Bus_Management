import { Prisma, TripStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import type { z } from 'zod';
import type { createScheduleSchema, scheduleQuerySchema, updateScheduleSchema } from './admin.schemas.js';
import { generateTrips } from '../trips/trip-generator.worker.js';
import { logger } from '../../lib/logger.js';

type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;
type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

const scheduleSelect = {
  id: true,
  routeId: true,
  busId: true,
  driverId: true,
  departureTime: true,
  isActive: true,
  validFrom: true,
  validTo: true,
  daysOfWeek: true,
  createdAt: true,
  updatedAt: true,
  route: { select: { id: true, name: true, code: true } },
  bus: { select: { id: true, fleetNumber: true, registrationNumber: true } },
  driver: {
    select: {
      userId: true,
      employeeNumber: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.TripScheduleSelect;

export const listSchedules = async (query: ScheduleQuery) => {
  const { page, limit, pageSize, status, routeId } = query;
  const take = pageSize ?? limit;
  const skip = (page - 1) * take;

  const where: Prisma.TripScheduleWhereInput = {
    ...(status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {}),
    ...(routeId ? { routeId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.tripSchedule.count({ where }),
    prisma.tripSchedule.findMany({
      where,
      select: scheduleSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  return { data: items, meta: { total, page, limit: take, totalPages: Math.ceil(total / take) } };
};

export const createSchedule = async (input: CreateScheduleInput) => {
  const route = await prisma.route.findUnique({ where: { id: input.routeId } });
  if (!route) throw new AppError(404, 'NOT_FOUND', 'Route not found');

  const bus = await prisma.bus.findUnique({ where: { id: input.busId } });
  if (!bus) throw new AppError(404, 'NOT_FOUND', 'Bus not found');

  const driver = await prisma.driverProfile.findUnique({ where: { userId: input.driverId } });
  if (!driver) throw new AppError(404, 'NOT_FOUND', 'Driver not found');

  const schedule = await prisma.tripSchedule.create({
    data: {
      routeId: input.routeId,
      busId: input.busId,
      driverId: input.driverId,
      departureTime: input.departureTime,
      isActive: input.isActive,
      validFrom: input.validFrom,
      validTo: input.validTo,
      daysOfWeek: input.daysOfWeek,
    },
    select: scheduleSelect,
  });

  // Automatically generate trips for this new schedule in the background
  generateTrips().catch((err) => logger.error({ err, scheduleId: schedule.id }, 'Failed to generate trips for new schedule'));

  return schedule;
};

export const getSchedule = async (id: string) => {
  const schedule = await prisma.tripSchedule.findUnique({ where: { id }, select: scheduleSelect });
  if (!schedule) throw new AppError(404, 'NOT_FOUND', 'Schedule not found');
  return schedule;
};

export const updateSchedule = async (id: string, input: UpdateScheduleInput) => {
  const schedule = await prisma.tripSchedule.findUnique({ where: { id } });
  if (!schedule) throw new AppError(404, 'NOT_FOUND', 'Schedule not found');

  if (input.routeId && input.routeId !== schedule.routeId) {
    const route = await prisma.route.findUnique({ where: { id: input.routeId } });
    if (!route) throw new AppError(404, 'NOT_FOUND', 'Route not found');
  }

  if (input.busId && input.busId !== schedule.busId) {
    const bus = await prisma.bus.findUnique({ where: { id: input.busId } });
    if (!bus) throw new AppError(404, 'NOT_FOUND', 'Bus not found');
  }

  if (input.driverId && input.driverId !== schedule.driverId) {
    const driver = await prisma.driverProfile.findUnique({ where: { userId: input.driverId } });
    if (!driver) throw new AppError(404, 'NOT_FOUND', 'Driver not found');
  }

  const updatedSchedule = await prisma.tripSchedule.update({
    where: { id },
    data: input,
    select: scheduleSelect,
  });

  // Regenerate trips in case days/times changed
  generateTrips().catch((err) => logger.error({ err, scheduleId: id }, 'Failed to generate trips for updated schedule'));

  return updatedSchedule;
};

export const deleteSchedule = async (id: string) => {
  const schedule = await prisma.tripSchedule.findUnique({ where: { id } });
  if (!schedule) throw new AppError(404, 'NOT_FOUND', 'Schedule not found');

  await prisma.$transaction([
    prisma.trip.deleteMany({
      where: {
        scheduleId: id,
        status: TripStatus.SCHEDULED,
      },
    }),
    prisma.tripSchedule.delete({ where: { id } }),
  ]);
};
