# Server di produzione: cosa configurare

Indicazioni per chi installa l'app sulla VM aziendale. Il deploy con Docker in `deploy/docker-non-mantenuto/` è solo un esempio non mantenuto. Servizi esterni e flussi di dati sono descritti in [PRIVACY.md](../PRIVACY.md).

## Log tecnici: conservazione 6 mesi
L'API scrive i log in JSON su stdout, senza dati personali in chiaro. Cosa contengono è descritto in PRIVACY.md, alla voce "Log applicativi". L'app non li salva su file, quindi la conservazione si imposta sul sistema che li raccoglie:
- **Durata:** **6 mesi** (decisione del titolare, indicata nell'informativa), poi cancellazione automatica.
- **Esempio con systemd/journald**, in `/etc/systemd/journald.conf.d/fcs.conf`:
  ```ini
  [Journal]
  Storage=persistent
  MaxRetentionSec=6month
  ```
  Poi `systemctl restart systemd-journald`. Se la VM ospita anche altri servizi, è meglio un'istanza journald dedicata, oppure la rotazione dei file con logrotate (`rotate 26`, `weekly`, `compress`).
- **Reverse proxy:** lo stesso limite di 6 mesi vale per i suoi log di accesso. Vanno configurati senza query string né cookie, possibilmente con l'IP troncato.
- **Backup:** vale anche per i backup che contengono log. Nessun invio a servizi esterni di raccolta log o monitoraggio (vedi `apps/api/AGENTS.md`).

## Database: permessi sull'audit log
L'audit log è append-only. In produzione:
- **Migrazioni:** le esegue l'utente proprietario dello schema, ed è suo anche la funzione `audit_log_purge`.
- **Utente dell'app:** sulla tabella `AuditLog` ha solo `INSERT` e `SELECT`, più `EXECUTE` sulla funzione:
  ```sql
  REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM fcs_app;
  GRANT SELECT, INSERT ON "AuditLog" TO fcs_app;
  GRANT USAGE ON SEQUENCE "AuditLog_id_seq" TO fcs_app;
  GRANT EXECUTE ON FUNCTION audit_log_purge(integer) TO fcs_app;
  ```
  Così l'app può cancellare righe dell'audit log solo per scadenza (minimo 6 mesi) e con l'ancora per la verifica della catena.

## Job notturni
Con `JOBS_ENABLED=true` (default) l'API pianifica i job da sola. La coda pg-boss sta nello schema `pgboss` dello stesso database, quindi non serve un cron di sistema. Orari (Europe/Rome):

| Ora | Job |
|---|---|
| 00:10 | date dei viaggi ricorrenti |
| 02:30 | verifica dei dipendenti |
| 03:15 | conservazione della chat |
| 03:20 | verifiche email non completate |
| 03:30 | conservazione delle segnalazioni |
| 03:45 | conservazione: viaggi, inviti, sessioni, audit log |
| 04:00 | cancellazione degli ex dipendenti |
| ogni 5 minuti | promemoria |

Se l'API gira in più istanze, pg-boss impedisce esecuzioni doppie.

## Marchio
Web e API devono usare lo stesso valore di `BRAND` (vedi [nuovo-marchio.md](nuovo-marchio.md)).
