-- AlterTable
ALTER TABLE "options" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill: give existing options a stable manual order within each category by
-- creation time, so the new drag-to-reorder order starts gap-free (Phase 3.5).
-- No-op on a fresh database (e.g. CI), where the table is empty.
WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "categoryId" ORDER BY "createdAt" ASC, "id" ASC
  ) - 1 AS rn
  FROM "options"
)
UPDATE "options" o SET "position" = ordered.rn
FROM ordered
WHERE o."id" = ordered."id";
