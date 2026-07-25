-- Monotonic insert order for messages (Phase 4.4). SERIAL backfills existing
-- rows with unique sequential values, so the unique index is safe to add.
ALTER TABLE "messages" ADD COLUMN "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "messages_seq_key" ON "messages"("seq");
