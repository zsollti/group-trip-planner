-- CreateTable
CREATE TABLE "personal_items" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "categoryId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_items_tripId_ownerId_position_idx" ON "personal_items"("tripId", "ownerId", "position");

-- CreateIndex
CREATE INDEX "personal_items_ownerId_idx" ON "personal_items"("ownerId");

-- CreateIndex
CREATE INDEX "personal_items_categoryId_idx" ON "personal_items"("categoryId");

-- AddForeignKey
ALTER TABLE "personal_items" ADD CONSTRAINT "personal_items_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_items" ADD CONSTRAINT "personal_items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_items" ADD CONSTRAINT "personal_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
