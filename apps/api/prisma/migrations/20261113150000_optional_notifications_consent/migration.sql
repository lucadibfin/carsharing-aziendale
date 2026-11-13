-- Il consenso "notifiche via email" diventa "notifiche facoltative" (promemoria,
-- nuovi viaggi dei preferiti, riepiloghi; push + email). Le notifiche essenziali
-- non richiedono più il consenso.
-- La finalità è cambiata, quindi i consensi dati in precedenza NON valgono per la
-- nuova: si azzerano e l'utente deve esprimerli di nuovo (art. 7 GDPR). Lo storico
-- in ConsentEvent resta con il vecchio nome a fini di prova.
ALTER TABLE "UserConsent" RENAME COLUMN "emailNotifications" TO "optionalNotifications";
UPDATE "UserConsent" SET "optionalNotifications" = false;