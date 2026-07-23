-- CreateTable
CREATE TABLE "trip_blocks" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "blockedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_blocks_userId_idx" ON "trip_blocks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "trip_blocks_tripId_userId_key" ON "trip_blocks"("tripId", "userId");

-- AddForeignKey
ALTER TABLE "trip_blocks" ADD CONSTRAINT "trip_blocks_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_blocks" ADD CONSTRAINT "trip_blocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_blocks" ADD CONSTRAINT "trip_blocks_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
