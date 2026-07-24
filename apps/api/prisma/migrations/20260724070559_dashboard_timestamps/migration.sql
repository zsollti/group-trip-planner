-- AlterTable
ALTER TABLE "options" ADD COLUMN     "headcountConfirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "membershipChangedAt" TIMESTAMP(3);
