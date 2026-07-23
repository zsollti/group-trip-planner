-- CreateEnum
CREATE TYPE "TripRole" AS ENUM ('OWNER', 'CO_ORGANIZER', 'PARTICIPANT', 'GUEST');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('ACTIVE', 'HISTORY');

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "destination" TEXT,
    "coverImageUrl" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "startDate" DATE,
    "endDate" DATE,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_memberships" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "TripRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trips_ownerId_idx" ON "trips"("ownerId");

-- CreateIndex
CREATE INDEX "trip_memberships_userId_idx" ON "trip_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "trip_memberships_tripId_userId_key" ON "trip_memberships"("tripId", "userId");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_memberships" ADD CONSTRAINT "trip_memberships_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_memberships" ADD CONSTRAINT "trip_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
