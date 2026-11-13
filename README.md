# Car Sharing tra colleghi (PWA)

Progressive Web App per il car sharing casa-lavoro tra colleghi delle sedi italiane: installabile su iOS e Android senza store. Gli aggregati anonimi supportano il Mobility Manager nella redazione del PSCL.

## Struttura
```
apps/api         NestJS 12 (ESM) + Prisma 7 + PostgreSQL + Socket.IO + pg-boss
apps/web         Angular 22 (zoneless, standalone) + Angular Material + @angular/pwa
packages/shared  schemi zod, enum e DTO condivisi tra API e frontend
infra/           Dockerfile, docker-compose di produzione, Caddyfile
docs/legal       BOZZE di informativa e termini d'uso (da validare dal DPO)
PRIVACY.md       servizi esterni e flussi di dati
```

## Requisiti di sviluppo
- Node.js ≥ 22.22
- npm 11: `npx npm@11 install`. npm 10 ha un bug con i peer dependency dei workspace, e gli script di installazione consentiti sono elencati in `allowScripts`.
- **Nessun Docker né PostgreSQL da installare**: in sviluppo e nei test si usa PostgreSQL embedded (`embedded-postgres`).

## Avvio in sviluppo
```powershell
npx npm@11 install
copy apps\api\.env.example apps\api\.env   # poi generare chiavi e VAPID (istruzioni nel file)
npm run db:start                            # terminale 1: PostgreSQL embedded su localhost:5433
npm run db:migrate -w api                   # prima volta: migrazioni
npm run db:seed -w api                      # comuni ISTAT, testi legali v1, sedi di esempio
npm run dev:api                             # terminale 2: API su http://127.0.0.1:3000
npm run dev:web                             # terminale 3: PWA su http://localhost:4200 (proxy verso l'API)
```
Utenti di prova (provider mock, solo sviluppo): `admin` (admin globale), `mario.rossi`, `laura.bianchi`, `giuseppe.verdi`, `anna.neri`, `paolo.gialli`, `ex.dipendente` (non attivo). La password è in `apps/api/src/auth/mock-identity.provider.ts`. In produzione il provider mock è bloccato dalla validazione della configurazione.

## Test
```powershell
npm test                # shared + api (integrazione su PostgreSQL embedded usa-e-getta) + web
npm test -w api         # solo API
```
Logica critica coperta:
- **posti**: niente overbooking anche con accettazioni concorrenti;
- **permessi**;
- **visibilità dei viaggi privati**: 404 agli estranei, assenza dalle ricerche;
- **cancellazioni**: scadenza configurabile;
- **gestione delle credenziali**: la password non compare mai in log, risposte ed errori; throttling applicato *prima* di contattare AD;
- **chat WebSocket**: origine verificata, isolamento delle stanze;
- **disattivazione dei dipendenti usciti**.

## Produzione (VM aziendale)
```bash
cp infra/.env.prod.example infra/.env.prod   # compilare i segreti
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
```

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
- [ ] **Fase 2**:
  - statistiche e OSRM;
  - preferiti;
  - segnalazioni;
  - area admin;
  - audit log immutabile;
  - diritti GDPR self-service;
  - verifica notturna;
  - documento per il DPO.
- [ ] **Fase 3**:
  - viaggi ricorrenti e membri fissi;
  - lista d'attesa;
  - promemoria;
  - export CSV/Excel;
  - retention completa.
