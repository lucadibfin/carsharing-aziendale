-- Orario di partenza del viaggio, orari stimati di passaggio, promemoria per partecipante.
ALTER TABLE "TripSeries" ADD COLUMN "departureTime" VARCHAR(5);
ALTER TABLE "TripStop" ADD COLUMN "passTime" VARCHAR(5);
ALTER TABLE "TripParticipant" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
