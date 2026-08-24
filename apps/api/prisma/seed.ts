import bcrypt from 'bcryptjs';
import {
  AssignmentStatus,
  BusStatus,
  DriverStatus,
  PrismaClient,
  Role,
  RouteStatus,
  TripStatus,
  UserStatus,
} from '@prisma/client';
import { env } from '../src/config/env.js';

const prisma = new PrismaClient();

const password = async (value: string) => bcrypt.hash(value, 12);

const ensureSeedUser = async ({
  email,
  passwordValue,
  name,
  role,
  phone,
}: {
  email: string;
  passwordValue: string;
  name: string;
  role: Role;
  phone: string;
}) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const isSameSeedAccount =
      existing.role === role &&
      existing.status === UserStatus.ACTIVE &&
      existing.deletedAt === null &&
      (await bcrypt.compare(passwordValue, existing.passwordHash));
    if (!isSameSeedAccount) {
      throw new Error(
        `Refusing to reuse or modify the existing account ${email}. Use a clean database or different seed credentials.`,
      );
    }
    return existing;
  }
  return prisma.user.create({
    data: {
      email,
      passwordHash: await password(passwordValue),
      passwordChangedAt: new Date(),
      name,
      role,
      phone,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
};

const tomorrowAt = (hour: number, minutes = 0): Date => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(hour, minutes, 0, 0);
  return date;
};

const main = async () => {
  const admin = await ensureSeedUser({
    email: env.SEED_ADMIN_EMAIL.toLowerCase(),
    passwordValue: env.SEED_ADMIN_PASSWORD,
    name: 'Transport Administrator',
    role: Role.ADMIN,
    phone: '+8801700000001',
  });
  const driver = await ensureSeedUser({
    email: 'driver@example.edu',
    passwordValue: env.SEED_DRIVER_PASSWORD,
    name: 'Demo Driver',
    role: Role.DRIVER,
    phone: '+8801700000002',
  });
  await prisma.driverProfile.upsert({
    where: { userId: driver.id },
    create: {
      userId: driver.id,
      employeeNumber: 'DRV-001',
      licenseNumber: 'DHAKA-DEMO-001',
      licenseExpiresAt: new Date('2030-12-31'),
      status: DriverStatus.ACTIVE,
      hiredAt: new Date('2024-01-01'),
    },
    update: { status: DriverStatus.ACTIVE, licenseExpiresAt: new Date('2030-12-31') },
  });
  const student = await ensureSeedUser({
    email: 'student@example.edu',
    passwordValue: env.SEED_STUDENT_PASSWORD,
    name: 'Demo Student',
    role: Role.STUDENT,
    phone: '+8801700000003',
  });
  await prisma.studentProfile.upsert({
    where: { userId: student.id },
    create: { userId: student.id, studentNumber: 'STU-001', department: 'Computer Science' },
    update: { department: 'Computer Science' },
  });

  const bus = await prisma.bus.upsert({
    where: { fleetNumber: 'BUS-01' },
    create: {
      fleetNumber: 'BUS-01',
      registrationNumber: 'DHAKA-METRO-B-0001',
      make: 'University Fleet',
      model: 'Campus Shuttle',
      modelYear: 2025,
      capacity: 32,
      status: BusStatus.ACTIVE,
      amenities: ['GPS', 'FIRST_AID', 'FIRE_EXTINGUISHER'],
    },
    update: { capacity: 32, status: BusStatus.ACTIVE },
  });
  await prisma.busSeat.createMany({
    data: Array.from({ length: 32 }, (_, index) => ({
      busId: bus.id,
      seatNumber: String(index + 1).padStart(2, '0'),
      rowNumber: Math.floor(index / 4) + 1,
      columnLabel: ['A', 'B', 'C', 'D'][index % 4],
      type: index < 2 ? ('ACCESSIBLE' as const) : ('STANDARD' as const),
    })),
    skipDuplicates: true,
  });

  const stopData = [
    { code: 'MIRPUR-10', name: 'Mirpur 10', address: 'Mirpur 10 Circle, Dhaka', latitude: 23.8069, longitude: 90.3687 },
    { code: 'AGARGAON', name: 'Agargaon', address: 'Agargaon Bus Stop, Dhaka', latitude: 23.7774, longitude: 90.3802 },
    { code: 'FARMGATE', name: 'Farmgate', address: 'Farmgate, Dhaka', latitude: 23.7588, longitude: 90.3897 },
    { code: 'CAMPUS', name: 'University Campus', address: 'Main Campus Gate', latitude: 23.7289, longitude: 90.3984 },
  ];
  const stops = [];
  for (const item of stopData) {
    stops.push(
      await prisma.stop.upsert({
        where: { code: item.code },
        create: item,
        update: { name: item.name, address: item.address, latitude: item.latitude, longitude: item.longitude, isActive: true },
      }),
    );
  }
  const route = await prisma.route.upsert({
    where: { code: 'R-MIRPUR-CAMPUS' },
    create: {
      code: 'R-MIRPUR-CAMPUS',
      name: 'Mirpur to Campus',
      description: 'Morning university service via Agargaon and Farmgate',
      status: RouteStatus.ACTIVE,
      distanceMeters: 12_500,
      estimatedDurationMinutes: 55,
    },
    update: { status: RouteStatus.ACTIVE, estimatedDurationMinutes: 55 },
  });
  for (const [index, stop] of stops.entries()) {
    await prisma.routeStop.upsert({
      where: { routeId_sequence: { routeId: route.id, sequence: index + 1 } },
      create: {
        routeId: route.id,
        stopId: stop.id,
        sequence: index + 1,
        plannedOffsetMinutes: [0, 15, 30, 55][index],
        distanceFromStartMeters: [0, 3_500, 7_000, 12_500][index],
      },
      update: {
        stopId: stop.id,
        plannedOffsetMinutes: [0, 15, 30, 55][index],
        distanceFromStartMeters: [0, 3_500, 7_000, 12_500][index],
      },
    });
  }

  const startsAt = tomorrowAt(2, 0);
  const endsAt = new Date(startsAt.getTime() + 55 * 60_000);
  let assignment = await prisma.driverAssignment.findFirst({
    where: { driverId: driver.id, busId: bus.id, routeId: route.id, startsAt },
  });
  assignment ??= await prisma.driverAssignment.create({
    data: {
      driverId: driver.id,
      busId: bus.id,
      routeId: route.id,
      createdById: admin.id,
      startsAt,
      endsAt,
      status: AssignmentStatus.SCHEDULED,
    },
  });
  const publicCode = `DEMO-${startsAt.toISOString().slice(0, 10).replaceAll('-', '')}`;
  const trip = await prisma.trip.upsert({
    where: { publicCode },
    create: {
      publicCode,
      assignmentId: assignment.id,
      routeId: route.id,
      busId: bus.id,
      driverId: driver.id,
      status: TripStatus.SCHEDULED,
      scheduledStartAt: startsAt,
      scheduledEndAt: endsAt,
      boardingOpensAt: new Date(startsAt.getTime() - 30 * 60_000),
      bookingClosesAt: new Date(startsAt.getTime() - 5 * 60_000),
      fareAmount: 50,
      currency: 'BDT',
    },
    update: { busId: bus.id, driverId: driver.id, routeId: route.id, fareAmount: 50 },
  });
  const routeStops = await prisma.routeStop.findMany({ where: { routeId: route.id }, orderBy: { sequence: 'asc' } });
  for (const routeStop of routeStops) {
    await prisma.tripStop.upsert({
      where: { tripId_sequence: { tripId: trip.id, sequence: routeStop.sequence } },
      create: {
        tripId: trip.id,
        routeStopId: routeStop.id,
        sequence: routeStop.sequence,
        scheduledArrivalAt: new Date(startsAt.getTime() + (routeStop.plannedOffsetMinutes ?? 0) * 60_000),
      },
      update: {
        routeStopId: routeStop.id,
        scheduledArrivalAt: new Date(startsAt.getTime() + (routeStop.plannedOffsetMinutes ?? 0) * 60_000),
      },
    });
  }

  const plan = await prisma.subscriptionPlan.upsert({
    where: { code: 'MONTHLY-40' },
    create: {
      code: 'MONTHLY-40',
      name: 'Monthly Campus Pass',
      description: 'Up to 40 trips over 30 days on the Mirpur campus route',
      price: 1_500,
      currency: 'BDT',
      durationDays: 30,
      tripLimit: 40,
    },
    update: { price: 1_500, durationDays: 30, tripLimit: 40, isActive: true },
  });
  await prisma.subscriptionPlanRoute.upsert({
    where: { planId_routeId: { planId: plan.id, routeId: route.id } },
    create: { planId: plan.id, routeId: route.id },
    update: {},
  });

  console.log('Seed complete');
  console.log(`Admin: ${env.SEED_ADMIN_EMAIL}`);
  console.log('Driver: driver@example.edu');
  console.log('Student: student@example.edu');
};

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
