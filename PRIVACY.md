# PRIVACY.md — Servizi esterni e flussi di dati

Documento tecnico da mantenere aggiornato a ogni modifica. **Regola:** nessun servizio esterno può essere aggiunto senza aggiornare questo file e senza l'approvazione del DPO.

## Principi applicati
- **Hosting e dati esclusivamente in UE**, su VM gestita dall'azienda: PostgreSQL, API Node.js e reverse proxy HTTPS. La modalità di installazione è ancora da definire.
- **Nessun tracker o analytics** di terze parti, nessun CDN, nessun font esterno. Font (Roboto, `@fontsource`) e icone (Material Symbols SVG) sono ospitati dall'app stessa.
- **Solo cookie tecnici**:
  - `__Host-sid`: sessione, httpOnly, Secure, SameSite=Lax;
  - `XSRF-TOKEN`: protezione CSRF.
- **Nessuna telemetria verso terzi**. In particolare non usare NestJS Observe, Sentry SaaS o simili.

## Servizi esterni

| Servizio | Quando | Dati inviati | Dati NON inviati | Sede |
|---|---|---|---|---|
| **API di autenticazione aziendale** (Active Directory) | Al login; facoltativamente ogni notte per la verifica dei dipendenti usciti | Username e password (solo HTTPS, solo al login); username (verifica notturna, senza password) | Nient'altro | Infrastruttura aziendale |
| **SMTP aziendale** | Codice di verifica quando l'utente inserisce o cambia l'email; notifiche **essenziali** sempre; notifiche **facoltative** solo con il consenso; **mai** la chat | Indirizzo scelto dall'utente (aziendale o personale), codice di verifica a 6 cifre oppure testo generico ("hai una nuova richiesta…") | Nomi di altri utenti, testi della chat, dettagli del viaggio | Infrastruttura aziendale; per gli indirizzi personali il messaggio arriva anche al fornitore di posta scelto dall'utente |
| **Servizi push dei browser** (Google FCM per Chrome/Android, Apple per Safari/iOS, Mozilla per Firefox) | Notifiche push, solo per chi le attiva sul dispositivo | Payload **cifrato end-to-end** (RFC 8291) con un testo generico e un link interno; endpoint del dispositivo | Testi dei messaggi, nomi, dati personali | Dipende dal fornitore del browser: **da valutare con il DPO** (l'endpoint del dispositivo è un identificativo, il contenuto non è leggibile dal fornitore) |
| **OSRM self-hosted** (facoltativo, `ROUTING_PROVIDER=osrm`) | Prima volta che serve la distanza tra un comune e una sede (poi in cache) | Solo coordinate pubbliche: punto interno al comune (confini ISTAT) e sede | Qualunque dato degli utenti, compreso chi ha viaggiato | Infrastruttura aziendale (estratto OpenStreetMap dell'Italia). Con `ROUTING_PROVIDER=estimate` nessun servizio: stima in linea d'aria. Vedi `docs/distanze.md` |

## Notifiche: categorie e canali
La classificazione si trova in `apps/api/src/notifications/notifications.service.ts` (`NOTIFICATION_CATEGORY`), che è l'unico punto da modificare, ed è verificata da un test (`apps/api/test/email.spec.ts`). Le basi giuridiche sono nel par. 5-bis dell'informativa.

| Categoria | Tipi | Push | Email | Consenso |
|---|---|---|---|---|
| Essenziale | `TRIP_CANCELLED`, `TRIP_RESCHEDULED`, `REQUEST_ACCEPTED`, `REQUEST_REJECTED`, `REMOVED_FROM_TRIP`, `INVITATION`, `ACCOUNT_DEACTIVATED` | sì, se attivata | sempre | no (6.1.b) |
| Operativa | `JOIN_REQUEST`, `PARTICIPANT_LEFT`, `INVITATION_ACCEPTED`, `INVITATION_DECLINED`, `CHAT_MESSAGES` | sì, se attivata | mai | no (6.1.b) |
| Facoltativa | `TRIP_REMINDER`, `FAVORITE_NEW_TRIP`, `DIGEST` | solo con consenso | solo con consenso | `optionalNotifications` (6.1.a) |

- **Push.** L'attivazione avviene sempre per scelta dell'utente sul singolo dispositivo, tramite il permesso del browser.
- **Testi.** Sono sempre generici, sia nelle push sia nelle email.
- **Avviso di disattivazione.** `ACCOUNT_DEACTIVATED` è inviato subito, fuori dalla coda, prima di cancellare l'email e le sottoscrizioni push.
## Dati di riferimento pubblici inclusi nel repository
- Elenco dei comuni ISTAT (`apps/api/prisma/data/comuni.csv`), generato dal file ufficiale ISTAT "Elenco comuni italiani", e coordinate dei comuni (`comuni-coordinate.csv`) ricavate dai confini comunali ISTAT. Fonte: ISTAT, licenza CC BY 4.0. Sono file scaricati una tantum e versionati: l'app non contatta ISTAT. Aggiornamento: `docs/distanze.md`.
- Icone Material Symbols, licenza Apache 2.0 (`apps/web/public/icons/ms/LICENSE`).

## Dove stanno i dati personali
| Dato | Dove | Protezione |
|---|---|---|
| Profilo (nome, cognome, sede, comune) | PostgreSQL | Accesso solo dall'API (database non esposto sulla rete) |
| Telefono | PostgreSQL, campo `phoneEnc` | Cifratura applicativa AES-256-GCM (`DATA_ENCRYPTION_KEYS`) |
| Email per le notifiche | PostgreSQL, `User.emailEnc` e `EmailVerification.emailEnc` | AES-256-GCM. Del codice di verifica si salva solo l'HMAC. Il codice scade dopo 15 minuti e ammette 5 tentativi; si possono chiedere al massimo un codice al minuto e 5 codici all'ora. Le verifiche non completate si cancellano dopo 24 ore; l'email si cancella alla disattivazione |
| Testi della chat | PostgreSQL, campo `bodyEnc` | AES-256-GCM, cancellazione automatica dopo 30 giorni (configurabile) |
| Motivazioni delle segnalazioni e note degli admin | PostgreSQL, `AbsenceReport` | AES-256-GCM; visibili solo agli admin della sede (accesso registrato), cancellate dopo 12 mesi |
| Sessioni | PostgreSQL | Si salva solo l'hash SHA-256 del token |
| Link d'invito | PostgreSQL | Solo l'hash del token; il token sta nel frammento `#` dell'URL e quindi non finisce nei log del server |
| Contatori anti brute-force | PostgreSQL | Chiavi HMAC di username e IP, nessun dato in chiaro |
| Statistiche personali | PostgreSQL, `UserStatEntry` | Visibili solo all'interessato; si cancellano con l'account |
| Statistiche aggregate | PostgreSQL, `TripStatFact` | Anonime: sede, data, posti, passeggeri, km e risparmi, senza identificativi di utenti. Restano dopo la cancellazione degli account |
| Audit log | PostgreSQL, `AuditLog` | Append-only (trigger che vietano modifiche e cancellazioni) con catena di hash; solo UUID e codici di azione, nessun dato in chiaro |
| Log applicativi | stdout del processo | Senza corpo delle richieste, cookie, query string, nomi, indirizzi email né codici di verifica; utenti solo come pseudonimo HMAC |
| Log di accesso del reverse proxy | Da definire con l'installazione | Raccomandato: senza query string né cookie, IP troncato |

**Password**: mai salvate, loggate o incluse in errori. Vengono inoltrate solo all'API aziendale via HTTPS (redirect disabilitati, nessun retry automatico). I test automatici verificano che non compaiano in log e risposte (`apps/api/test/auth.spec.ts`).

## Raccomandazioni per l'infrastruttura
- Cifratura del disco della VM (dati a riposo, inclusi i backup di PostgreSQL).
- Backup cifrati e conservati in UE; i backup seguono gli stessi tempi di conservazione.
- Segreti (`.env.prod`) leggibili solo dall'utente di servizio; rotazione periodica di `DATA_ENCRYPTION_KEYS` (supporta più versioni di chiave).
