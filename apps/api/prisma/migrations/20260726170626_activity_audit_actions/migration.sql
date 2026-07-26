-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_ROLE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_KICKED';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_UNBLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_LEFT';
ALTER TYPE "AuditAction" ADD VALUE 'OWNERSHIP_TRANSFERRED';

-- DropIndex
DROP INDEX "audit_events_tripId_idx";

-- CreateIndex
CREATE INDEX "audit_events_tripId_createdAt_id_idx" ON "audit_events"("tripId", "createdAt", "id");
