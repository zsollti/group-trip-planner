-- CreateEnum
CREATE TYPE "CategoryBuiltinKey" AS ENUM ('DATES', 'TRANSPORT', 'ACCOMMODATION', 'ACTIVITIES', 'BUDGET');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "singleChoice" BOOLEAN NOT NULL DEFAULT false,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "builtinKey" "CategoryBuiltinKey",
    "position" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_tripId_idx" ON "categories"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tripId_builtinKey_key" ON "categories"("tripId", "builtinKey");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
