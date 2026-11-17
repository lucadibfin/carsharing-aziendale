-- Fase 3: membri fissi delle serie ricorrenti, promemoria, conservazione automatica.

-- CreateTable
CREATE TABLE "SeriesMember" (
    "seriesId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "boardingComune" CHAR(6) NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeriesMember_pkey" PRIMARY KEY ("seriesId","userId")
);

CREATE INDEX "SeriesMember_userId_idx" ON "SeriesMember"("userId");

ALTER TABLE "SeriesMember" ADD CONSTRAINT "SeriesMember_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "TripSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeriesMember" ADD CONSTRAINT "SeriesMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "eveningReminderAt" TIMESTAMP(3),
ADD COLUMN "departureReminderAt" TIMESTAMP(3);

CREATE INDEX "Trip_date_idx" ON "Trip"("date");

-- Audit log: cancellazione per scadenza della conservazione.
-- La tabella resta append-only: UPDATE e TRUNCATE sono sempre vietati, DELETE è
-- ammesso solo dentro audit_log_purge(), che cancella le righe più vecchie di
-- `months` mesi (minimo 6) in un blocco contiguo dall'inizio, così la catena di
-- hash delle righe rimaste resta verificabile a partire dalla prima.
-- In produzione l'utente DB dell'app ha solo INSERT e SELECT sulla tabella e
-- EXECUTE su questa funzione, che gira con i diritti del proprietario dello
-- schema (SECURITY DEFINER): l'app non può cancellare righe in nessun altro modo.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('fcs.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AuditLog è append-only: % non consentito', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- L'istante di riferimento è l'orologio del database: l'app non può anticiparlo.
CREATE FUNCTION audit_log_purge(months integer)
RETURNS TABLE (deleted bigint, last_deleted_id bigint, anchor_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cutoff timestamp;
  max_id bigint;
  n bigint;
  anchor text;
BEGIN
  IF months IS NULL OR months < 6 THEN
    RAISE EXCEPTION 'conservazione dell''audit log: minimo 6 mesi';
  END IF;
  cutoff := (now() AT TIME ZONE 'UTC') - make_interval(months => months);
  SELECT max(id) INTO max_id FROM "AuditLog" WHERE "at" < cutoff;
  IF max_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  SELECT "hash" INTO anchor FROM "AuditLog" WHERE id = max_id;
  PERFORM set_config('fcs.audit_purge', 'on', true);
  DELETE FROM "AuditLog" WHERE id <= max_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('fcs.audit_purge', 'off', true);
  RETURN QUERY SELECT n, max_id, anchor;
END;
$$;
