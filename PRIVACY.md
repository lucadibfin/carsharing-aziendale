# PRIVACY.md — Servizi esterni e flussi di dati

Documento tecnico da mantenere aggiornato a ogni modifica. **Regola:** nessun servizio esterno può essere aggiunto senza aggiornare questo file e senza l'approvazione del DPO.

## Principi applicati
- **Hosting e dati esclusivamente in UE**, su VM gestita dall'azienda (docker-compose: PostgreSQL, API, Caddy).
- **Nessun tracker o analytics** di terze parti, nessun CDN, nessun font esterno. Font (Roboto, `@fontsource`) e icone (Material Symbols SVG) sono ospitati dall'app stessa.
- **Solo cookie tecnici**:
  - `__Host-sid`: sessione, httpOnly, Secure, SameSite=Lax;
  - `XSRF-TOKEN`: protezione CSRF.
- **Nessuna telemetria verso terzi**. In particolare non usare NestJS Observe, Sentry SaaS o simili.

## Servizi esterni

| Servizio | Quando | Dati inviati | Dati NON inviati | Sede |
|---|---|---|---|---|
| **API di autenticazione aziendale** (Active Directory) | Al login; facoltativamente ogni notte per la verifica dei dipendenti usciti | Username e password (solo HTTPS, solo al login); username (verifica notturna, senza password) | Nient'altro | Infrastruttura aziendale |
| **SMTP aziendale** | Notifiche email, solo per chi ha dato il consenso | Indirizzo aziendale (`username@dominio`), testo generico ("hai una nuova richiesta…") | Nomi di altri utenti, testi della chat, dettagli del viaggio | Infrastruttura aziendale |
| **Servizi push dei browser** (Google FCM per Chrome/Android, Apple per Safari/iOS, Mozilla per Firefox) | Notifiche push, solo per chi le attiva sul dispositivo | Payload **cifrato end-to-end** (RFC 8291) con un testo generico e un link interno; endpoint del dispositivo | Testi dei messaggi, nomi, dati personali | Dipende dal fornitore del browser: **da valutare con il DPO** (l'endpoint del dispositivo è un identificativo, il contenuto non è leggibile dal fornitore) |
| **OSRM self-hosted** (Fase 2) | Calcolo delle distanze stradali | Coordinate pubbliche di comuni e sedi | Qualunque dato degli utenti | VM aziendale (estratto OpenStreetMap dell'Italia) |

## Dati di riferimento pubblici inclusi nel repository
- Elenco dei comuni ISTAT (`apps/api/prisma/data/comuni.csv`), generato dal file ufficiale ISTAT "Elenco comuni italiani".
- Icone Material Symbols, licenza Apache 2.0 (`apps/web/public/icons/ms/LICENSE`).

## Dove stanno i dati personali
| Dato | Dove | Protezione |
|---|---|---|
| Profilo (nome, cognome, sede, comune) | PostgreSQL | Accesso solo dall'API (rete Docker interna, nessuna porta esposta) |
| Telefono | PostgreSQL, campo `phoneEnc` | Cifratura applicativa AES-256-GCM (`DATA_ENCRYPTION_KEYS`) |
| Testi della chat | PostgreSQL, campo `bodyEnc` | AES-256-GCM, cancellazione automatica dopo 30 giorni (configurabile) |
| Motivazioni delle segnalazioni (Fase 2) | PostgreSQL | AES-256-GCM |
| Sessioni | PostgreSQL | Si salva solo l'hash SHA-256 del token |
| Link d'invito | PostgreSQL | Solo l'hash del token; il token sta nel frammento `#` dell'URL e quindi non finisce nei log del server |
| Contatori anti brute-force | PostgreSQL | Chiavi HMAC di username e IP, nessun dato in chiaro |
| Log applicativi | stdout del container (rotazione 10×10 MB) | Senza corpo delle richieste, cookie, query string né nomi; utenti solo come pseudonimo HMAC |
| Log di accesso di Caddy | stdout del container | Senza query string né cookie, IP troncato (/16) |

**Password**: mai salvate, loggate o incluse in errori. Vengono inoltrate solo all'API aziendale via HTTPS (redirect disabilitati, nessun retry automatico). I test automatici verificano che non compaiano in log e risposte (`apps/api/test/auth.spec.ts`).

## Raccomandazioni per l'infrastruttura
- Cifratura del disco della VM (dati a riposo, inclusi i backup di PostgreSQL).
- Backup cifrati e conservati in UE; i backup seguono gli stessi tempi di conservazione.
- Segreti (`.env.prod`) leggibili solo dall'utente di servizio; rotazione periodica di `DATA_ENCRYPTION_KEYS` (supporta più versioni di chiave).
