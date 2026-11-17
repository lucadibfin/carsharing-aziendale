# Car Sharing tra colleghi (PWA)

Progressive Web App per il car sharing casa-lavoro tra colleghi delle sedi italiane: installabile su iOS e Android senza store. Gli aggregati anonimi supportano il Mobility Manager nella redazione del PSCL.

## Struttura
```
apps/api         NestJS 12 (ESM) + Prisma 7 + PostgreSQL + Socket.IO + pg-boss
apps/web         Angular 22 (zoneless, standalone) + Angular Material + @angular/pwa
packages/shared  schemi zod, enum e DTO condivisi tra API e frontend
e2e              test end-to-end Playwright
deploy/          file Docker NON mantenuti (vedi il README interno)
docs/legal       BOZZE di informativa e termini d'uso (da validare dal DPO)
PRIVACY.md       servizi esterni e flussi di dati
```

## Requisiti di sviluppo
- **Node.js 24 LTS** (include npm 11). Le versioni sono fissate in `package.json` (`engines`, `packageManager`) e in `.nvmrc`. Con nvm: `nvm install 24.18.1` e poi `nvm use 24.18.1`.
- Con versioni diverse `npm install` si ferma subito con l'errore `EBADENGINE` (`.npmrc` → `engine-strict`). Node 22 non è supportato: il suo npm 10 va in errore sui workspace di questo progetto.
- Gli script di installazione dei pacchetti sono consentiti solo per quelli elencati in `allowScripts`.
- **Nessun Docker né PostgreSQL da installare**: in sviluppo e nei test si usa PostgreSQL embedded (`embedded-postgres`).

## Avvio in sviluppo
```powershell
npm install
copy apps\api\.env.example apps\api\.env   # poi generare chiavi e VAPID (istruzioni nel file)
npm run db:start                            # terminale 1: PostgreSQL embedded su localhost:5433
npm run db:migrate -w api                   # prima volta: migrazioni
npm run db:seed -w api                      # comuni ISTAT, testi legali v1, sedi di esempio
npm run dev:api                             # terminale 2: API su http://127.0.0.1:3000
npm run dev:web                             # terminale 3: PWA su http://localhost:4200 (proxy verso l'API)
```
Utenti di prova (provider mock, solo sviluppo): `admin` (admin globale), `mario.rossi`, `laura.bianchi`, `giuseppe.verdi`, `anna.neri`, `paolo.gialli`, `ex.dipendente` (non attivo). La password è in `apps/api/src/auth/mock-identity.provider.ts`. In produzione il provider mock è bloccato dalla validazione della configurazione.

**Email in sviluppo**: con `MAIL_TRANSPORT=outbox` (default senza `SMTP_HOST`) le email non vengono spedite. Sono scritte come file JSON in `apps/api/.mail-outbox/`, e lì si trova il codice di verifica richiesto al primo accesso. In produzione è ammesso solo `smtp`.

**Test su iPhone e Android reali** (installazione PWA e push in HTTPS sulla rete locale): vedi [docs/test-dispositivi.md](docs/test-dispositivi.md), che contiene anche la checklist per ciascun dispositivo.

## Test
```powershell
npm test                # shared + api (integrazione su PostgreSQL embedded usa-e-getta) + web
npm test -w api         # solo API
npm run e2e             # end-to-end con Playwright (circa 30 secondi)
```
**Test end-to-end** (`e2e/`):
- Coprono il flusso principale su un telefono emulato (Pixel 7):
  1. login;
  2. primo accesso, con verifica dell'email tramite codice (anche errato);
  3. proposta di un viaggio privato;
  4. link d'invito aperto da un collega non ancora registrato, poi suo login, primo accesso e accettazione;
  5. chat in tempo reale tra i due, con un messaggio rapido.
- Lo stack è isolato:
  - PostgreSQL embedded usa-e-getta sulla porta 5440;
  - API compilata sulla 3100, con chiavi casuali a ogni esecuzione;
  - PWA sulla 4300.
  Non tocca il database di sviluppo; i codici email si leggono dalla outbox `e2e/.run/mail-outbox`.
- Usa Google Chrome già installato. In alternativa: `npx playwright install chromium` e `E2E_BROWSER_CHANNEL=chromium`.
- In caso di errore, screenshot e trace sono in `e2e/.run/results` (`npx playwright show-trace …`).
Logica critica coperta:
- **posti**: niente overbooking anche con accettazioni concorrenti;
- **permessi**;
- **visibilità dei viaggi privati**: 404 agli estranei, assenza dalle ricerche;
- **cancellazioni**: scadenza configurabile;
- **gestione delle credenziali**:
  - la password non compare mai in log, risposte ed errori;
  - il throttling è applicato *prima* di contattare AD;
  - il blocco è temporaneo (15 minuti, configurabile) e si toglie da solo;
- **email per le notifiche**: verifica con codice, scadenza, tentativi e limiti di invio; nessun indirizzo né codice nei log;
- **chat WebSocket**: origine verificata, isolamento delle stanze;
- **disattivazione dei dipendenti usciti**, verifica notturna con freno di sicurezza, cancellazione definitiva;
- **statistiche**: calcoli con auto di default e del conducente, OSRM simulato, fatti anonimi che sopravvivono alle cancellazioni;
- **segnalazioni**: chi può segnalare chi, cifratura, conservazione;
- **area admin**: ruoli, ambito di sede, minimizzazione, ultimo admin globale;
- **audit log**: catena di hash, trigger che vietano modifiche, rilevamento delle manomissioni;
- **diritti GDPR**: contenuto dell'esportazione, cancellazione dell'account.

Lo smoke test e2e `admin.spec.ts` apre tutte le sezioni dell'area amministrativa.


## Autenticazione
- Il modulo `apps/api/src/auth` è sostituibile.
- `IdentityProvider` ha due implementazioni: `MockIdentityProvider` e `CorporateIdentityProvider`. Il formato dell'API aziendale è **ipotizzato**: adattarlo in un solo file quando arriveranno le specifiche.
- Un futuro SSO (OIDC) dovrà solo creare la sessione con `SessionService.create()`.

## Stato
- [x] **Fase 1 (MVP)**:
  - login con API mock;
  - informativa e consensi versionati;
  - profilo;
  - viaggi pubblici e privati;
  - inviti (utente e link);
  - ricerca;
  - richieste con gestione transazionale dei posti;
  - cancellazioni;
  - chat in tempo reale con messaggi rapidi;
  - push generiche raggruppate, email;
  - chiusura del viaggio;
  - cancellazione della chat dopo 30 giorni.
- [x] **Fase 2**:
  - statistiche personali e fatti anonimi, distanze con OSRM o stima ([docs/distanze.md](docs/distanze.md));
  - preferiti con avviso per i loro nuovi viaggi;
  - segnalazioni di assenza;
  - area admin (dashboard, viaggi, segnalazioni, parametri, ruoli, sedi, testi legali, audit);
  - audit log immutabile;
  - diritti GDPR self-service (esportazione JSON, cancellazione dell'account);
  - verifica notturna dei dipendenti e cancellazione degli ex dipendenti;
  - [documento tecnico per il DPO](docs/dpo/documento-tecnico.md).
- Da fare prima dei test con gli utenti:
  - icone definitive ([docs/icone.md](docs/icone.md));
  - coordinate dei comuni dai confini ISTAT: `npm run coords:istat -w api -- <confini.shp>`, poi `npm run db:seed -w api` ([docs/distanze.md](docs/distanze.md#coordinate-dei-comuni-fonte-istat)).
- Aggiornamento annuale dell'elenco dei comuni: `npm run comuni:istat -w api -- <Elenco-comuni-italiani.csv>` e rigenerazione delle coordinate (stesso documento).
- [ ] **Fase 3**:
  - viaggi ricorrenti e membri fissi;
  - lista d'attesa;
  - promemoria;
  - export CSV/Excel;
  - retention completa.
