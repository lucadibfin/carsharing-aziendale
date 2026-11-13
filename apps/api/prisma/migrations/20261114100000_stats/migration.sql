-- Distanze comune-sede, fatti statistici anonimi e statistiche personali.
-- CreateEnum
CREATE TYPE "DistanceSource" AS ENUM ('ROUTED', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "TripFactStatus" AS ENUM ('PROPOSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StatRole" AS ENUM ('DRIVER', 'PASSENGER');

-- CreateTable
CREATE TABLE "DistanceCache" (
    "comuneIstat" CHAR(6) NOT NULL,
    "siteId" UUID NOT NULL,
    "meters" INTEGER NOT NULL,
    "source" "DistanceSource" NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistanceCache_pkey" PRIMARY KEY ("comuneIstat","siteId")
);

-- CreateTable
CREATE TABLE "TripStatFact" (
    "id" UUID NOT NULL,
    "tripId" UUID,
    "siteId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "visibility" "TripVisibility" NOT NULL,
    "status" "TripFactStatus" NOT NULL,
    "seats" INTEGER NOT NULL,
    "passengers" INTEGER NOT NULL DEFAULT 0,
    "legs" INTEGER NOT NULL DEFAULT 1,
    "driverKm" DOUBLE PRECISION,
    "kmAvoided" DOUBLE PRECISION,
    "co2SavedKg" DOUBLE PRECISION,
    "fuelSaved" DOUBLE PRECISION,
    "fuelUnit" TEXT,
    "eurSaved" DOUBLE PRECISION,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "complete" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripStatFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStatEntry" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "role" "StatRole" NOT NULL,
    "sharedKm" DOUBLE PRECISION NOT NULL,
    "kmAvoided" DOUBLE PRECISION NOT NULL,
    "co2SavedKg" DOUBLE PRECISION NOT NULL,
    "fuelSaved" DOUBLE PRECISION NOT NULL,
    "fuelUnit" TEXT NOT NULL,
    "eurSaved" DOUBLE PRECISION NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserStatEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripStatFact_tripId_key" ON "TripStatFact"("tripId");

-- CreateIndex
CREATE INDEX "TripStatFact_siteId_date_idx" ON "TripStatFact"("siteId", "date");

-- CreateIndex
CREATE INDEX "TripStatFact_date_idx" ON "TripStatFact"("date");

-- CreateIndex
CREATE INDEX "UserStatEntry_userId_date_idx" ON "UserStatEntry"("userId", "date");

-- AddForeignKey
ALTER TABLE "DistanceCache" ADD CONSTRAINT "DistanceCache_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStatFact" ADD CONSTRAINT "TripStatFact_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStatEntry" ADD CONSTRAINT "UserStatEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Viaggi già esistenti: fatti senza metriche di distanza (calcolate solo alla chiusura).
INSERT INTO "TripStatFact" ("id", "tripId", "siteId", "date", "visibility", "status", "seats", "legs", "complete", "updatedAt")
SELECT gen_random_uuid(), t."id", t."siteId", t."date", COALESCE(t."visibilityOverride", s."visibility"),
       CASE t."status" WHEN 'CLOSED' THEN 'COMPLETED'::"TripFactStatus"
                       WHEN 'CANCELLED' THEN 'CANCELLED'::"TripFactStatus"
                       ELSE 'PROPOSED'::"TripFactStatus" END,
       t."seats", CASE WHEN t."returnTime" IS NULL THEN 1 ELSE 2 END,
       t."status" <> 'CLOSED', CURRENT_TIMESTAMP
FROM "Trip" t JOIN "TripSeries" s ON s."id" = t."seriesId";