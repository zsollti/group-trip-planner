-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('PER_PERSON', 'TOTAL');

-- CreateEnum
CREATE TYPE "OptionStatus" AS ENUM ('PROPOSED', 'LOCKED');

-- CreateTable
CREATE TABLE "options" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "proposerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL,
    "costType" "CostType" NOT NULL DEFAULT 'PER_PERSON',
    "headcount" INTEGER,
    "headcountIsFixed" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "status" "OptionStatus" NOT NULL DEFAULT 'PROPOSED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "materialChangedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "options_categoryId_idx" ON "options"("categoryId");

-- AddForeignKey
ALTER TABLE "options" ADD CONSTRAINT "options_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "options" ADD CONSTRAINT "options_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
