-- Segnalazioni di assenza (motivazione cifrata, gestite solo dagli admin).
-- CreateEnum
CREATE TYPE "AbsenceReportStatus" AS ENUM ('OPEN', 'DISMISSED', 'ACKNOWLEDGED');

-- CreateTable
CREATE TABLE "AbsenceReport" (
    "id" UUID NOT NULL,
    "tripId" UUID,
    "siteId" UUID NOT NULL,
    "tripDate" DATE NOT NULL,
    "reporterId" UUID,
    "reportedId" UUID NOT NULL,
    "reasonEnc" TEXT NOT NULL,
    "status" "AbsenceReportStatus" NOT NULL DEFAULT 'OPEN',
    "decisionNoteEnc" TEXT,
    "handledById" UUID,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbsenceReport_siteId_status_idx" ON "AbsenceReport"("siteId", "status");

-- CreateIndex
CREATE INDEX "AbsenceReport_reportedId_idx" ON "AbsenceReport"("reportedId");

-- CreateIndex
CREATE INDEX "AbsenceReport_createdAt_idx" ON "AbsenceReport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceReport_tripId_reporterId_reportedId_key" ON "AbsenceReport"("tripId", "reporterId", "reportedId");

-- AddForeignKey
ALTER TABLE "AbsenceReport" ADD CONSTRAINT "AbsenceReport_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceReport" ADD CONSTRAINT "AbsenceReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceReport" ADD CONSTRAINT "AbsenceReport_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceReport" ADD CONSTRAINT "AbsenceReport_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
