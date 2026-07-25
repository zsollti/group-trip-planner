-- CreateTable
CREATE TABLE "channel_reads" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_reads_userId_idx" ON "channel_reads"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_reads_channelId_userId_key" ON "channel_reads"("channelId", "userId");

-- AddForeignKey
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
