-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'DRIVER', 'CONDUCTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "AccountTokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "BusStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "SeatType" AS ENUM ('STANDARD', 'ACCESSIBLE', 'PRIORITY', 'CREW');

-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('ACTIVE', 'UNAVAILABLE', 'UNDER_MAINTENANCE');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('SCHEDULED', 'BOARDING', 'IN_PROGRESS', 'DELAYED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripStopStatus" AS ENUM ('SCHEDULED', 'APPROACHING', 'ARRIVED', 'DEPARTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TrackingStatus" AS ENUM ('NOT_STARTED', 'ACTIVE', 'DEGRADED', 'OFFLINE', 'ENDED');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('GPS', 'NETWORK', 'LAST_KNOWN');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('WEB', 'MOBILE', 'ADMIN');

-- CreateEnum
CREATE TYPE "SeatAllocationStatus" AS ENUM ('HELD', 'CONFIRMED', 'CHECKED_IN', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QrCodeStatus" AS ENUM ('ACTIVE', 'USED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CheckInResult" AS ENUM ('ACCEPTED', 'REJECTED_INVALID', 'REJECTED_DUPLICATE', 'REJECTED_EXPIRED', 'REJECTED_REVOKED', 'REJECTED_WRONG_TRIP');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CARD', 'MOBILE_BANKING', 'BANK_TRANSFER', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentTransactionType" AS ENUM ('AUTHORIZATION', 'CAPTURE', 'CHARGE', 'REFUND', 'VOID', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'BUS_ETA_15_MINUTES', 'BUS_MAINTENANCE', 'ROAD_ALERT', 'TRIP_DELAYED', 'TRIP_CANCELLED', 'LOST_FOUND_MATCH', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('INSPECTION', 'PREVENTIVE', 'REPAIR', 'BREAKDOWN', 'CLEANING', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoadAlertCategory" AS ENUM ('TRAFFIC', 'ROADBLOCK', 'ACCIDENT', 'CONSTRUCTION', 'WEATHER', 'OTHER');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'MINOR', 'MODERATE', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RoadAlertStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RESOLVED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LostFoundReportType" AS ENUM ('LOST', 'FOUND');

-- CreateEnum
CREATE TYPE "LostFoundStatus" AS ENUM ('PENDING_VERIFICATION', 'OPEN', 'MATCHED', 'CLAIM_PENDING', 'CLAIMED', 'RETURNED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('EMERGENCY', 'ACCIDENT', 'BREAKDOWN', 'TRAFFIC', 'ROADBLOCK', 'WEATHER', 'MEDICAL', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(32),
    "avatarUrl" TEXT,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "passwordChangedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "userId" UUID NOT NULL,
    "studentNumber" VARCHAR(64) NOT NULL,
    "department" VARCHAR(160),
    "faculty" VARCHAR(160),
    "program" VARCHAR(160),
    "academicYear" INTEGER,
    "emergencyContact" VARCHAR(32),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "userId" UUID NOT NULL,
    "employeeNumber" VARCHAR(64) NOT NULL,
    "licenseNumber" VARCHAR(96) NOT NULL,
    "licenseExpiresAt" DATE NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "averageRating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "hiredAt" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(255) NOT NULL,
    "familyId" UUID NOT NULL,
    "userAgent" TEXT,
    "ipAddress" VARCHAR(45),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revocationReason" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "AccountTokenPurpose" NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buses" (
    "id" UUID NOT NULL,
    "fleetNumber" VARCHAR(32) NOT NULL,
    "registrationNumber" VARCHAR(64) NOT NULL,
    "make" VARCHAR(80),
    "model" VARCHAR(80),
    "modelYear" INTEGER,
    "capacity" INTEGER NOT NULL,
    "status" "BusStatus" NOT NULL DEFAULT 'ACTIVE',
    "amenities" JSONB,
    "trackingDeviceId" VARCHAR(128),
    "lastInspectionAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "buses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_seats" (
    "id" UUID NOT NULL,
    "busId" UUID NOT NULL,
    "seatNumber" VARCHAR(16) NOT NULL,
    "rowNumber" INTEGER,
    "columnLabel" VARCHAR(8),
    "type" "SeatType" NOT NULL DEFAULT 'STANDARD',
    "status" "SeatStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bus_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "status" "RouteStatus" NOT NULL DEFAULT 'ACTIVE',
    "encodedPolyline" TEXT,
    "distanceMeters" INTEGER,
    "estimatedDurationMinutes" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stops" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "address" TEXT,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(10,6) NOT NULL,
    "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 75,
    "accessibility" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "stopId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "distanceFromStartMeters" INTEGER,
    "plannedOffsetMinutes" INTEGER,
    "dwellTimeSeconds" INTEGER NOT NULL DEFAULT 60,
    "isPickup" BOOLEAN NOT NULL DEFAULT true,
    "isDropoff" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_assignments" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "busId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "publicCode" VARCHAR(40) NOT NULL,
    "assignmentId" UUID,
    "routeId" UUID NOT NULL,
    "busId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "conductorId" UUID,
    "status" "TripStatus" NOT NULL DEFAULT 'SCHEDULED',
    "trackingStatus" "TrackingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "scheduledStartAt" TIMESTAMPTZ(3) NOT NULL,
    "scheduledEndAt" TIMESTAMPTZ(3),
    "actualStartAt" TIMESTAMPTZ(3),
    "actualEndAt" TIMESTAMPTZ(3),
    "boardingOpensAt" TIMESTAMPTZ(3),
    "bookingClosesAt" TIMESTAMPTZ(3),
    "fareAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "locationIntervalSeconds" INTEGER NOT NULL DEFAULT 15,
    "lastLocationAt" TIMESTAMPTZ(3),
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "delayReason" TEXT,
    "cancellationReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_stops" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "routeStopId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "scheduledArrivalAt" TIMESTAMPTZ(3),
    "estimatedArrivalAt" TIMESTAMPTZ(3),
    "actualArrivalAt" TIMESTAMPTZ(3),
    "actualDepartureAt" TIMESTAMPTZ(3),
    "status" "TripStopStatus" NOT NULL DEFAULT 'SCHEDULED',
    "etaUpdatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_locations" (
    "id" BIGSERIAL NOT NULL,
    "tripId" UUID NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(10,6) NOT NULL,
    "accuracyMeters" DECIMAL(7,2),
    "speedKph" DECIMAL(6,2),
    "headingDegrees" DECIMAL(6,2),
    "altitudeMeters" DECIMAL(8,2),
    "source" "LocationSource" NOT NULL DEFAULT 'GPS',
    "isMoving" BOOLEAN,
    "batteryPercent" INTEGER,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "bookingNumber" VARCHAR(40) NOT NULL,
    "studentId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "boardingTripStopId" UUID NOT NULL,
    "dropoffTripStopId" UUID NOT NULL,
    "subscriptionId" UUID,
    "status" "BookingStatus" NOT NULL DEFAULT 'HELD',
    "source" "BookingSource" NOT NULL DEFAULT 'WEB',
    "idempotencyKey" VARCHAR(128),
    "fareAmount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "holdExpiresAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "checkedInAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_allocations" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "seatId" UUID NOT NULL,
    "status" "SeatAllocationStatus" NOT NULL DEFAULT 'HELD',
    "allocatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),
    "releaseReason" VARCHAR(255),

    CONSTRAINT "seat_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_qr_codes" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "keyId" VARCHAR(64),
    "status" "QrCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "singleUse" BOOLEAN NOT NULL DEFAULT true,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" VARCHAR(255),

    CONSTRAINT "booking_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_ins" (
    "id" UUID NOT NULL,
    "bookingId" UUID,
    "qrCodeId" UUID,
    "tripId" UUID NOT NULL,
    "busId" UUID NOT NULL,
    "scannedById" UUID NOT NULL,
    "result" "CheckInResult" NOT NULL,
    "scannedTokenFingerprint" VARCHAR(128) NOT NULL,
    "denialReason" VARCHAR(255),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(10,6),
    "checkedInAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "durationDays" INTEGER NOT NULL,
    "tripLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan_routes" (
    "planId" UUID NOT NULL,
    "routeId" UUID NOT NULL,

    CONSTRAINT "subscription_plan_routes_pkey" PRIMARY KEY ("planId","routeId")
);

-- CreateTable
CREATE TABLE "student_subscriptions" (
    "id" UUID NOT NULL,
    "subscriptionNumber" VARCHAR(40) NOT NULL,
    "studentId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "remainingTrips" INTEGER,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "paymentNumber" VARCHAR(40) NOT NULL,
    "payerId" UUID NOT NULL,
    "bookingId" UUID,
    "subscriptionId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerPaymentReference" VARCHAR(191),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "methodType" "PaymentMethodType",
    "cardBrand" VARCHAR(32),
    "cardLast4" CHAR(4),
    "amount" DECIMAL(12,2) NOT NULL,
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "failureCode" VARCHAR(128),
    "failureMessage" TEXT,
    "metadata" JSONB,
    "paidAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerTransactionId" VARCHAR(191),
    "type" "PaymentTransactionType" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "failureCode" VARCHAR(128),
    "failureMessage" TEXT,
    "metadata" JSONB,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_receipts" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "receiptNumber" VARCHAR(48) NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentUrl" TEXT,
    "breakdown" JSONB,

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_gateway_events" (
    "id" UUID NOT NULL,
    "paymentId" UUID,
    "provider" VARCHAR(64) NOT NULL,
    "providerEventId" VARCHAR(191) NOT NULL,
    "eventType" VARCHAR(128) NOT NULL,
    "payloadHash" VARCHAR(128) NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "processingError" TEXT,

    CONSTRAINT "payment_gateway_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "dedupeKey" VARCHAR(191),
    "scheduledFor" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "providerMessageId" VARCHAR(191),
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "deviceName" VARCHAR(128),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" UUID NOT NULL,
    "busId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "expectedReturnAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cost" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "road_alerts" (
    "id" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "category" "RoadAlertCategory" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'MODERATE',
    "status" "RoadAlertStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "locationText" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(10,6),
    "startsAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "road_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "road_alert_routes" (
    "alertId" UUID NOT NULL,
    "routeId" UUID NOT NULL,

    CONSTRAINT "road_alert_routes_pkey" PRIMARY KEY ("alertId","routeId")
);

-- CreateTable
CREATE TABLE "lost_found_reports" (
    "id" UUID NOT NULL,
    "reportNumber" VARCHAR(40) NOT NULL,
    "reporterId" UUID NOT NULL,
    "verifiedById" UUID,
    "type" "LostFoundReportType" NOT NULL,
    "status" "LostFoundStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "category" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "color" VARCHAR(64),
    "brand" VARCHAR(96),
    "locationText" TEXT NOT NULL,
    "happenedAt" TIMESTAMPTZ(3) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(10,6),
    "verificationNotes" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lost_found_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_found_images" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "altText" VARCHAR(255),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lost_found_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_found_claims" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "claimantId" UUID NOT NULL,
    "reviewedById" UUID,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "ownershipProof" TEXT NOT NULL,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lost_found_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_found_matches" (
    "id" UUID NOT NULL,
    "lostReportId" UUID NOT NULL,
    "foundReportId" UUID NOT NULL,
    "confidence" DECIMAL(5,4),
    "status" "MatchStatus" NOT NULL DEFAULT 'SUGGESTED',
    "matchReasons" JSONB,
    "notifiedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lost_found_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_ratings" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_incidents" (
    "id" UUID NOT NULL,
    "incidentNumber" VARCHAR(40) NOT NULL,
    "tripId" UUID,
    "driverId" UUID NOT NULL,
    "resolvedById" UUID,
    "category" "IncidentCategory" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'MAJOR',
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(10,6),
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_attachments" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "mediaType" VARCHAR(96) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(128) NOT NULL,
    "entityType" VARCHAR(128) NOT NULL,
    "entityId" VARCHAR(128),
    "requestId" VARCHAR(128),
    "ipAddress" VARCHAR(45),
    "userAgent" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_status_createdAt_idx" ON "users"("status", "createdAt");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_studentNumber_key" ON "student_profiles"("studentNumber");

-- CreateIndex
CREATE INDEX "student_profiles_department_idx" ON "student_profiles"("department");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_employeeNumber_key" ON "driver_profiles"("employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_licenseNumber_key" ON "driver_profiles"("licenseNumber");

-- CreateIndex
CREATE INDEX "driver_profiles_status_idx" ON "driver_profiles"("status");

-- CreateIndex
CREATE INDEX "driver_profiles_licenseExpiresAt_idx" ON "driver_profiles"("licenseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_expiresAt_idx" ON "sessions"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "account_tokens_tokenHash_key" ON "account_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "account_tokens_userId_purpose_expiresAt_idx" ON "account_tokens"("userId", "purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "buses_fleetNumber_key" ON "buses"("fleetNumber");

-- CreateIndex
CREATE UNIQUE INDEX "buses_registrationNumber_key" ON "buses"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "buses_trackingDeviceId_key" ON "buses"("trackingDeviceId");

-- CreateIndex
CREATE INDEX "buses_status_idx" ON "buses"("status");

-- CreateIndex
CREATE INDEX "bus_seats_busId_status_idx" ON "bus_seats"("busId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bus_seats_busId_seatNumber_key" ON "bus_seats"("busId", "seatNumber");

-- CreateIndex
CREATE UNIQUE INDEX "routes_code_key" ON "routes"("code");

-- CreateIndex
CREATE INDEX "routes_status_name_idx" ON "routes"("status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stops_code_key" ON "stops"("code");

-- CreateIndex
CREATE INDEX "stops_isActive_name_idx" ON "stops"("isActive", "name");

-- CreateIndex
CREATE INDEX "stops_latitude_longitude_idx" ON "stops"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "route_stops_routeId_stopId_idx" ON "route_stops"("routeId", "stopId");

-- CreateIndex
CREATE INDEX "route_stops_stopId_idx" ON "route_stops"("stopId");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_routeId_sequence_key" ON "route_stops"("routeId", "sequence");

-- CreateIndex
CREATE INDEX "driver_assignments_driverId_status_startsAt_idx" ON "driver_assignments"("driverId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "driver_assignments_busId_status_startsAt_idx" ON "driver_assignments"("busId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "driver_assignments_routeId_status_startsAt_idx" ON "driver_assignments"("routeId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "trips_publicCode_key" ON "trips"("publicCode");

-- CreateIndex
CREATE INDEX "trips_routeId_status_scheduledStartAt_idx" ON "trips"("routeId", "status", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "trips_busId_status_scheduledStartAt_idx" ON "trips"("busId", "status", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "trips_driverId_status_scheduledStartAt_idx" ON "trips"("driverId", "status", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "trips_status_scheduledStartAt_idx" ON "trips"("status", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "trips_lastLocationAt_idx" ON "trips"("lastLocationAt");

-- CreateIndex
CREATE INDEX "trip_stops_tripId_status_estimatedArrivalAt_idx" ON "trip_stops"("tripId", "status", "estimatedArrivalAt");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_tripId_sequence_key" ON "trip_stops"("tripId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_tripId_routeStopId_key" ON "trip_stops"("tripId", "routeStopId");

-- CreateIndex
CREATE INDEX "trip_locations_tripId_recordedAt_idx" ON "trip_locations"("tripId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "trip_locations_receivedAt_idx" ON "trip_locations"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_bookingNumber_key" ON "bookings"("bookingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_idempotencyKey_key" ON "bookings"("idempotencyKey");

-- CreateIndex
CREATE INDEX "bookings_studentId_status_createdAt_idx" ON "bookings"("studentId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "bookings_tripId_status_idx" ON "bookings"("tripId", "status");

-- CreateIndex
CREATE INDEX "bookings_holdExpiresAt_status_idx" ON "bookings"("holdExpiresAt", "status");

-- CreateIndex
CREATE INDEX "bookings_subscriptionId_idx" ON "bookings"("subscriptionId");

-- CreateIndex
CREATE INDEX "seat_allocations_tripId_seatId_status_idx" ON "seat_allocations"("tripId", "seatId", "status");

-- CreateIndex
CREATE INDEX "seat_allocations_bookingId_status_idx" ON "seat_allocations"("bookingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "booking_qr_codes_tokenHash_key" ON "booking_qr_codes"("tokenHash");

-- CreateIndex
CREATE INDEX "booking_qr_codes_bookingId_status_expiresAt_idx" ON "booking_qr_codes"("bookingId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "booking_qr_codes_status_expiresAt_idx" ON "booking_qr_codes"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "check_ins_tripId_result_checkedInAt_idx" ON "check_ins"("tripId", "result", "checkedInAt");

-- CreateIndex
CREATE INDEX "check_ins_bookingId_checkedInAt_idx" ON "check_ins"("bookingId", "checkedInAt");

-- CreateIndex
CREATE INDEX "check_ins_qrCodeId_result_idx" ON "check_ins"("qrCodeId", "result");

-- CreateIndex
CREATE INDEX "check_ins_scannedById_checkedInAt_idx" ON "check_ins"("scannedById", "checkedInAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE INDEX "subscription_plans_isActive_idx" ON "subscription_plans"("isActive");

-- CreateIndex
CREATE INDEX "subscription_plan_routes_routeId_idx" ON "subscription_plan_routes"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "student_subscriptions_subscriptionNumber_key" ON "student_subscriptions"("subscriptionNumber");

-- CreateIndex
CREATE INDEX "student_subscriptions_studentId_status_endsAt_idx" ON "student_subscriptions"("studentId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "student_subscriptions_planId_status_idx" ON "student_subscriptions"("planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_paymentNumber_key" ON "payments"("paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_payerId_status_createdAt_idx" ON "payments"("payerId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "payments_bookingId_status_idx" ON "payments"("bookingId", "status");

-- CreateIndex
CREATE INDEX "payments_subscriptionId_status_idx" ON "payments"("subscriptionId", "status");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_providerPaymentReference_key" ON "payments"("provider", "providerPaymentReference");

-- CreateIndex
CREATE INDEX "payment_transactions_paymentId_createdAt_idx" ON "payment_transactions"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_transactions_status_createdAt_idx" ON "payment_transactions"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_provider_providerTransactionId_key" ON "payment_transactions"("provider", "providerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_paymentId_key" ON "payment_receipts"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_receiptNumber_key" ON "payment_receipts"("receiptNumber");

-- CreateIndex
CREATE INDEX "payment_gateway_events_processedAt_receivedAt_idx" ON "payment_gateway_events"("processedAt", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateway_events_provider_providerEventId_key" ON "payment_gateway_events"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "payment_gateway_events_paymentId_receivedAt_idx" ON "payment_gateway_events"("paymentId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_scheduledFor_createdAt_idx" ON "notifications"("scheduledFor", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_type_createdAt_idx" ON "notifications"("type", "createdAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notification_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_key" ON "notification_deliveries"("notificationId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_revokedAt_idx" ON "push_subscriptions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "maintenance_records_busId_status_startsAt_idx" ON "maintenance_records"("busId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "maintenance_records_status_expectedReturnAt_idx" ON "maintenance_records"("status", "expectedReturnAt");

-- CreateIndex
CREATE INDEX "road_alerts_status_startsAt_endsAt_idx" ON "road_alerts"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "road_alerts_category_severity_status_idx" ON "road_alerts"("category", "severity", "status");

-- CreateIndex
CREATE INDEX "road_alerts_latitude_longitude_idx" ON "road_alerts"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "road_alert_routes_routeId_idx" ON "road_alert_routes"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "lost_found_reports_reportNumber_key" ON "lost_found_reports"("reportNumber");

-- CreateIndex
CREATE INDEX "lost_found_reports_type_status_happenedAt_idx" ON "lost_found_reports"("type", "status", "happenedAt" DESC);

-- CreateIndex
CREATE INDEX "lost_found_reports_category_status_idx" ON "lost_found_reports"("category", "status");

-- CreateIndex
CREATE INDEX "lost_found_reports_reporterId_createdAt_idx" ON "lost_found_reports"("reporterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "lost_found_images_reportId_sortOrder_idx" ON "lost_found_images"("reportId", "sortOrder");

-- CreateIndex
CREATE INDEX "lost_found_claims_status_createdAt_idx" ON "lost_found_claims"("status", "createdAt");

-- CreateIndex
CREATE INDEX "lost_found_claims_claimantId_status_idx" ON "lost_found_claims"("claimantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lost_found_claims_reportId_claimantId_key" ON "lost_found_claims"("reportId", "claimantId");

-- CreateIndex
CREATE INDEX "lost_found_matches_status_confidence_idx" ON "lost_found_matches"("status", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "lost_found_matches_lostReportId_foundReportId_key" ON "lost_found_matches"("lostReportId", "foundReportId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_ratings_bookingId_key" ON "driver_ratings"("bookingId");

-- CreateIndex
CREATE INDEX "driver_ratings_driverId_isVisible_createdAt_idx" ON "driver_ratings"("driverId", "isVisible", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "driver_ratings_studentId_tripId_key" ON "driver_ratings"("studentId", "tripId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_incidents_incidentNumber_key" ON "driver_incidents"("incidentNumber");

-- CreateIndex
CREATE INDEX "driver_incidents_status_severity_occurredAt_idx" ON "driver_incidents"("status", "severity", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "driver_incidents_driverId_occurredAt_idx" ON "driver_incidents"("driverId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "driver_incidents_tripId_idx" ON "driver_incidents"("tripId");

-- CreateIndex
CREATE INDEX "incident_attachments_incidentId_idx" ON "incident_attachments"("incidentId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_requestId_idx" ON "audit_logs"("requestId");

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_seats" ADD CONSTRAINT "bus_seats_busId_fkey" FOREIGN KEY ("busId") REFERENCES "buses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_busId_fkey" FOREIGN KEY ("busId") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "driver_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_busId_fkey" FOREIGN KEY ("busId") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_conductorId_fkey" FOREIGN KEY ("conductorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_routeStopId_fkey" FOREIGN KEY ("routeStopId") REFERENCES "route_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_locations" ADD CONSTRAINT "trip_locations_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_boardingTripStopId_fkey" FOREIGN KEY ("boardingTripStopId") REFERENCES "trip_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_dropoffTripStopId_fkey" FOREIGN KEY ("dropoffTripStopId") REFERENCES "trip_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "student_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_allocations" ADD CONSTRAINT "seat_allocations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_allocations" ADD CONSTRAINT "seat_allocations_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_allocations" ADD CONSTRAINT "seat_allocations_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "bus_seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_qr_codes" ADD CONSTRAINT "booking_qr_codes_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "booking_qr_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_busId_fkey" FOREIGN KEY ("busId") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plan_routes" ADD CONSTRAINT "subscription_plan_routes_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plan_routes" ADD CONSTRAINT "subscription_plan_routes_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subscriptions" ADD CONSTRAINT "student_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "student_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_gateway_events" ADD CONSTRAINT "payment_gateway_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_busId_fkey" FOREIGN KEY ("busId") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_alerts" ADD CONSTRAINT "road_alerts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_alert_routes" ADD CONSTRAINT "road_alert_routes_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "road_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_alert_routes" ADD CONSTRAINT "road_alert_routes_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_found_reports" ADD CONSTRAINT "lost_found_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_found_reports" ADD CONSTRAINT "lost_found_reports_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_found_images" ADD CONSTRAINT "lost_found_images_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "lost_found_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_found_claims" ADD CONSTRAINT "lost_found_claims_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "lost_found_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_found_claims" ADD CONSTRAINT "lost_found_claims_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_found_claims" ADD CONSTRAINT "lost_found_claims_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_found_matches" ADD CONSTRAINT "lost_found_matches_lostReportId_fkey" FOREIGN KEY ("lostReportId") REFERENCES "lost_found_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_found_matches" ADD CONSTRAINT "lost_found_matches_foundReportId_fkey" FOREIGN KEY ("foundReportId") REFERENCES "lost_found_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_ratings" ADD CONSTRAINT "driver_ratings_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_ratings" ADD CONSTRAINT "driver_ratings_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_ratings" ADD CONSTRAINT "driver_ratings_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_ratings" ADD CONSTRAINT "driver_ratings_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_incidents" ADD CONSTRAINT "driver_incidents_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_incidents" ADD CONSTRAINT "driver_incidents_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_incidents" ADD CONSTRAINT "driver_incidents_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "driver_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain constraints which Prisma cannot currently express in the data model.
-- Keep these at the end of the initial migration so all referenced tables exist.

-- Authentication identifiers are case-insensitive even when callers forget to normalize.
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (LOWER("email"));

-- Basic numeric, coordinate, time-window, and money invariants.
ALTER TABLE "driver_profiles"
  ADD CONSTRAINT "driver_profiles_rating_range_check"
    CHECK ("averageRating" >= 0 AND "averageRating" <= 5),
  ADD CONSTRAINT "driver_profiles_rating_count_check"
    CHECK ("ratingCount" >= 0);

ALTER TABLE "buses"
  ADD CONSTRAINT "buses_capacity_positive_check" CHECK ("capacity" > 0),
  ADD CONSTRAINT "buses_model_year_check" CHECK ("modelYear" IS NULL OR "modelYear" BETWEEN 1950 AND 2200);

ALTER TABLE "bus_seats"
  ADD CONSTRAINT "bus_seats_row_positive_check" CHECK ("rowNumber" IS NULL OR "rowNumber" > 0);

ALTER TABLE "routes"
  ADD CONSTRAINT "routes_distance_nonnegative_check" CHECK ("distanceMeters" IS NULL OR "distanceMeters" >= 0),
  ADD CONSTRAINT "routes_duration_nonnegative_check" CHECK ("estimatedDurationMinutes" IS NULL OR "estimatedDurationMinutes" >= 0);

ALTER TABLE "stops"
  ADD CONSTRAINT "stops_latitude_check" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "stops_longitude_check" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "stops_geofence_radius_check" CHECK ("geofenceRadiusMeters" > 0);

ALTER TABLE "route_stops"
  ADD CONSTRAINT "route_stops_sequence_check" CHECK ("sequence" >= 0),
  ADD CONSTRAINT "route_stops_distance_check" CHECK ("distanceFromStartMeters" IS NULL OR "distanceFromStartMeters" >= 0),
  ADD CONSTRAINT "route_stops_offset_check" CHECK ("plannedOffsetMinutes" IS NULL OR "plannedOffsetMinutes" >= 0),
  ADD CONSTRAINT "route_stops_dwell_check" CHECK ("dwellTimeSeconds" >= 0);

ALTER TABLE "driver_assignments"
  ADD CONSTRAINT "driver_assignments_time_window_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");

ALTER TABLE "trips"
  ADD CONSTRAINT "trips_scheduled_window_check" CHECK ("scheduledEndAt" IS NULL OR "scheduledEndAt" > "scheduledStartAt"),
  ADD CONSTRAINT "trips_actual_window_check" CHECK ("actualEndAt" IS NULL OR ("actualStartAt" IS NOT NULL AND "actualEndAt" >= "actualStartAt")),
  ADD CONSTRAINT "trips_location_interval_check" CHECK ("locationIntervalSeconds" BETWEEN 5 AND 300),
  ADD CONSTRAINT "trips_delay_nonnegative_check" CHECK ("delayMinutes" >= 0),
  ADD CONSTRAINT "trips_fare_nonnegative_check" CHECK ("fareAmount" >= 0),
  ADD CONSTRAINT "trips_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "trips_version_positive_check" CHECK ("version" > 0);

ALTER TABLE "trip_stops"
  ADD CONSTRAINT "trip_stops_sequence_check" CHECK ("sequence" >= 0),
  ADD CONSTRAINT "trip_stops_actual_window_check" CHECK ("actualDepartureAt" IS NULL OR ("actualArrivalAt" IS NOT NULL AND "actualDepartureAt" >= "actualArrivalAt"));

ALTER TABLE "trip_locations"
  ADD CONSTRAINT "trip_locations_latitude_check" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "trip_locations_longitude_check" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "trip_locations_accuracy_check" CHECK ("accuracyMeters" IS NULL OR "accuracyMeters" >= 0),
  ADD CONSTRAINT "trip_locations_speed_check" CHECK ("speedKph" IS NULL OR "speedKph" >= 0),
  ADD CONSTRAINT "trip_locations_heading_check" CHECK ("headingDegrees" IS NULL OR ("headingDegrees" >= 0 AND "headingDegrees" < 360)),
  ADD CONSTRAINT "trip_locations_battery_check" CHECK ("batteryPercent" IS NULL OR "batteryPercent" BETWEEN 0 AND 100);

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_distinct_stops_check" CHECK ("boardingTripStopId" <> "dropoffTripStopId"),
  ADD CONSTRAINT "bookings_fare_nonnegative_check" CHECK ("fareAmount" >= 0),
  ADD CONSTRAINT "bookings_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "bookings_version_positive_check" CHECK ("version" > 0);

ALTER TABLE "booking_qr_codes"
  ADD CONSTRAINT "booking_qr_codes_expiry_check" CHECK ("expiresAt" > "issuedAt"),
  ADD CONSTRAINT "booking_qr_codes_used_timestamp_check" CHECK ("status" <> 'USED' OR "usedAt" IS NOT NULL),
  ADD CONSTRAINT "booking_qr_codes_revoked_timestamp_check" CHECK ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL),
  ADD CONSTRAINT "booking_qr_codes_terminal_timestamp_check" CHECK (NOT ("usedAt" IS NOT NULL AND "revokedAt" IS NOT NULL));

ALTER TABLE "check_ins"
  ADD CONSTRAINT "check_ins_accepted_identity_check"
    CHECK ("result" <> 'ACCEPTED' OR ("bookingId" IS NOT NULL AND "qrCodeId" IS NOT NULL)),
  ADD CONSTRAINT "check_ins_latitude_check" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "check_ins_longitude_check" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_price_nonnegative_check" CHECK ("price" >= 0),
  ADD CONSTRAINT "subscription_plans_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "subscription_plans_duration_positive_check" CHECK ("durationDays" > 0),
  ADD CONSTRAINT "subscription_plans_trip_limit_check" CHECK ("tripLimit" IS NULL OR "tripLimit" > 0);

ALTER TABLE "student_subscriptions"
  ADD CONSTRAINT "student_subscriptions_window_check" CHECK ("endsAt" IS NULL OR ("startsAt" IS NOT NULL AND "endsAt" > "startsAt")),
  ADD CONSTRAINT "student_subscriptions_remaining_trips_check" CHECK ("remainingTrips" IS NULL OR "remainingTrips" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_exactly_one_subject_check"
    CHECK ((("bookingId" IS NOT NULL)::integer + ("subscriptionId" IS NOT NULL)::integer) = 1),
  ADD CONSTRAINT "payments_amount_positive_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_refunded_amount_check" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "amount"),
  ADD CONSTRAINT "payments_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "payments_card_last4_check" CHECK ("cardLast4" IS NULL OR "cardLast4" ~ '^[0-9]{4}$');

ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_amount_positive_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "payment_transactions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "maintenance_records"
  ADD CONSTRAINT "maintenance_records_return_window_check" CHECK ("expectedReturnAt" IS NULL OR "expectedReturnAt" > "startsAt"),
  ADD CONSTRAINT "maintenance_records_completion_window_check" CHECK ("completedAt" IS NULL OR "completedAt" >= "startsAt"),
  ADD CONSTRAINT "maintenance_records_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0);

ALTER TABLE "road_alerts"
  ADD CONSTRAINT "road_alerts_window_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt"),
  ADD CONSTRAINT "road_alerts_latitude_check" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "road_alerts_longitude_check" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

ALTER TABLE "lost_found_reports"
  ADD CONSTRAINT "lost_found_reports_latitude_check" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "lost_found_reports_longitude_check" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

ALTER TABLE "lost_found_matches"
  ADD CONSTRAINT "lost_found_matches_distinct_reports_check" CHECK ("lostReportId" <> "foundReportId"),
  ADD CONSTRAINT "lost_found_matches_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1);

ALTER TABLE "driver_ratings"
  ADD CONSTRAINT "driver_ratings_score_check" CHECK ("score" BETWEEN 1 AND 5);

ALTER TABLE "driver_incidents"
  ADD CONSTRAINT "driver_incidents_latitude_check" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "driver_incidents_longitude_check" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

-- These partial unique indexes are the concurrency boundary for booking and QR entry.
CREATE UNIQUE INDEX "seat_allocations_active_trip_seat_key"
  ON "seat_allocations" ("tripId", "seatId")
  WHERE "status" IN ('HELD', 'CONFIRMED', 'CHECKED_IN');

CREATE UNIQUE INDEX "seat_allocations_active_booking_key"
  ON "seat_allocations" ("bookingId")
  WHERE "status" IN ('HELD', 'CONFIRMED', 'CHECKED_IN');

CREATE UNIQUE INDEX "bookings_active_student_trip_key"
  ON "bookings" ("studentId", "tripId")
  WHERE "status" IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN');

CREATE UNIQUE INDEX "booking_qr_codes_one_active_per_booking_key"
  ON "booking_qr_codes" ("bookingId")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "check_ins_accepted_qr_key"
  ON "check_ins" ("qrCodeId")
  WHERE "result" = 'ACCEPTED' AND "qrCodeId" IS NOT NULL;

CREATE UNIQUE INDEX "check_ins_accepted_booking_key"
  ON "check_ins" ("bookingId")
  WHERE "result" = 'ACCEPTED' AND "bookingId" IS NOT NULL;

-- The allocation must refer to the same trip as its booking and to a seat on that trip's bus.
CREATE FUNCTION "validate_seat_allocation_consistency"() RETURNS trigger AS $$
DECLARE
  booking_trip UUID;
  trip_bus UUID;
  seat_bus UUID;
BEGIN
  SELECT "tripId" INTO booking_trip FROM "bookings" WHERE "id" = NEW."bookingId";
  SELECT "busId" INTO trip_bus FROM "trips" WHERE "id" = NEW."tripId";
  SELECT "busId" INTO seat_bus FROM "bus_seats" WHERE "id" = NEW."seatId";

  IF booking_trip IS DISTINCT FROM NEW."tripId" THEN
    RAISE EXCEPTION 'seat allocation trip does not match booking trip' USING ERRCODE = '23514';
  END IF;

  IF trip_bus IS DISTINCT FROM seat_bus THEN
    RAISE EXCEPTION 'allocated seat does not belong to trip bus' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "seat_allocations_consistency_trigger"
  AFTER INSERT OR UPDATE OF "bookingId", "tripId", "seatId" ON "seat_allocations"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION "validate_seat_allocation_consistency"();

-- Both booking stops must be snapshots from the booked trip and boarding must precede drop-off.
CREATE FUNCTION "validate_booking_stop_consistency"() RETURNS trigger AS $$
DECLARE
  boarding_trip UUID;
  boarding_sequence INTEGER;
  dropoff_trip UUID;
  dropoff_sequence INTEGER;
BEGIN
  SELECT "tripId", "sequence" INTO boarding_trip, boarding_sequence
    FROM "trip_stops" WHERE "id" = NEW."boardingTripStopId";
  SELECT "tripId", "sequence" INTO dropoff_trip, dropoff_sequence
    FROM "trip_stops" WHERE "id" = NEW."dropoffTripStopId";

  IF boarding_trip IS DISTINCT FROM NEW."tripId"
     OR dropoff_trip IS DISTINCT FROM NEW."tripId"
     OR boarding_sequence >= dropoff_sequence THEN
    RAISE EXCEPTION 'booking stops must belong to its trip and be in travel order' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "bookings_stop_consistency_trigger"
  AFTER INSERT OR UPDATE OF "tripId", "boardingTripStopId", "dropoffTripStopId" ON "bookings"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION "validate_booking_stop_consistency"();

-- Payment ownership is derived from its booking or subscription, never from client input alone.
CREATE FUNCTION "validate_payment_subject_owner"() RETURNS trigger AS $$
DECLARE
  subject_owner UUID;
BEGIN
  IF NEW."bookingId" IS NOT NULL THEN
    SELECT "studentId" INTO subject_owner FROM "bookings" WHERE "id" = NEW."bookingId";
  ELSE
    SELECT "studentId" INTO subject_owner FROM "student_subscriptions" WHERE "id" = NEW."subscriptionId";
  END IF;

  IF subject_owner IS DISTINCT FROM NEW."payerId" THEN
    RAISE EXCEPTION 'payment payer does not own its booking or subscription' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "payments_subject_owner_trigger"
  AFTER INSERT OR UPDATE OF "payerId", "bookingId", "subscriptionId" ON "payments"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION "validate_payment_subject_owner"();

-- Successful check-ins must agree with their trip, bus, booking, and server-issued QR.
CREATE FUNCTION "validate_check_in_consistency"() RETURNS trigger AS $$
DECLARE
  trip_bus UUID;
  booking_trip UUID;
  qr_booking UUID;
BEGIN
  SELECT "busId" INTO trip_bus FROM "trips" WHERE "id" = NEW."tripId";
  IF trip_bus IS DISTINCT FROM NEW."busId" THEN
    RAISE EXCEPTION 'check-in bus does not match trip bus' USING ERRCODE = '23514';
  END IF;

  IF NEW."bookingId" IS NOT NULL THEN
    SELECT "tripId" INTO booking_trip FROM "bookings" WHERE "id" = NEW."bookingId";
    IF booking_trip IS DISTINCT FROM NEW."tripId" THEN
      RAISE EXCEPTION 'check-in booking does not belong to trip' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."qrCodeId" IS NOT NULL THEN
    SELECT "bookingId" INTO qr_booking FROM "booking_qr_codes" WHERE "id" = NEW."qrCodeId";
    IF NEW."bookingId" IS NULL OR qr_booking IS DISTINCT FROM NEW."bookingId" THEN
      RAISE EXCEPTION 'check-in QR does not belong to booking' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "check_ins_consistency_trigger"
  AFTER INSERT OR UPDATE OF "bookingId", "qrCodeId", "tripId", "busId" ON "check_ins"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION "validate_check_in_consistency"();

-- Match rows must have a LOST report on the left and a FOUND report on the right.
CREATE FUNCTION "validate_lost_found_match_types"() RETURNS trigger AS $$
DECLARE
  lost_type "LostFoundReportType";
  found_type "LostFoundReportType";
BEGIN
  SELECT "type" INTO lost_type FROM "lost_found_reports" WHERE "id" = NEW."lostReportId";
  SELECT "type" INTO found_type FROM "lost_found_reports" WHERE "id" = NEW."foundReportId";

  IF lost_type IS DISTINCT FROM 'LOST' OR found_type IS DISTINCT FROM 'FOUND' THEN
    RAISE EXCEPTION 'lost/found match sides have incorrect report types' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "lost_found_matches_type_trigger"
  AFTER INSERT OR UPDATE OF "lostReportId", "foundReportId" ON "lost_found_matches"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION "validate_lost_found_match_types"();

-- Rating ownership and driver identity must agree with the completed booking/trip.
CREATE FUNCTION "validate_driver_rating_consistency"() RETURNS trigger AS $$
DECLARE
  booking_student UUID;
  booking_trip UUID;
  trip_driver UUID;
BEGIN
  SELECT "studentId", "tripId" INTO booking_student, booking_trip
    FROM "bookings" WHERE "id" = NEW."bookingId";
  SELECT "driverId" INTO trip_driver FROM "trips" WHERE "id" = NEW."tripId";

  IF booking_student IS DISTINCT FROM NEW."studentId"
     OR booking_trip IS DISTINCT FROM NEW."tripId"
     OR trip_driver IS DISTINCT FROM NEW."driverId" THEN
    RAISE EXCEPTION 'rating does not match its booking, trip, student, and driver' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "driver_ratings_consistency_trigger"
  AFTER INSERT OR UPDATE OF "studentId", "driverId", "tripId", "bookingId" ON "driver_ratings"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION "validate_driver_rating_consistency"();
