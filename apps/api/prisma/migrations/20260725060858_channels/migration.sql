-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('GENERAL', 'CATEGORY');

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "categoryId" UUID,
    "type" "ChannelType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channels_categoryId_key" ON "channels"("categoryId");

-- CreateIndex
CREATE INDEX "channels_tripId_idx" ON "channels"("tripId");

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
