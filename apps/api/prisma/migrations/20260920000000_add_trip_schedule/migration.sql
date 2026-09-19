CREATE TABLE "trip_schedules" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "busId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "departureTime" VARCHAR(5) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "daysOfWeek" INTEGER[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trip_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trip_schedules_isActive_idx" ON "trip_schedules"("isActive");
CREATE INDEX "trip_schedules_routeId_idx" ON "trip_schedules"("routeId");

ALTER TABLE "trip_schedules" ADD CONSTRAINT "trip_schedules_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip_schedules" ADD CONSTRAINT "trip_schedules_busId_fkey" FOREIGN KEY ("busId") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip_schedules" ADD CONSTRAINT "trip_schedules_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trips" ADD COLUMN "scheduleId" UUID;
ALTER TABLE "trips" ADD CONSTRAINT "trips_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "trip_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
