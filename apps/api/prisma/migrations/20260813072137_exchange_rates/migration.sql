-- CreateTable
CREATE TABLE "exchange_rates" (
    "code" TEXT NOT NULL,
    "perEur" DECIMAL(20,10) NOT NULL,
    "asOf" DATE NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("code")
);
