# Fincons Car Sharing (FCS): car sharing tra colleghi (PWA)

Progressive Web App per il car sharing casa-lavoro tra colleghi delle sedi italiane: installabile su iOS e Android senza store. Gli aggregati anonimi supportano il Mobility Manager nella redazione del PSCL.

## Struttura
```
apps/api         NestJS 12 (ESM) + Prisma 7 + PostgreSQL + Socket.IO + pg-boss
apps/web         Angular 22 (zoneless, standalone) + Angular Material + @angular/pwa
packages/shared  schemi zod, enum e DTO condivisi tra API e frontend
packages/brand   marchi white label: schema, design token, verifica del contrasto WCAG
brands/          un marchio per cliente (brand.json, logo, font): scelto con BRAND
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
npm run db:migrate                          # migrazioni (anche dopo ogni aggiornamento del codice)
npm run db:seed                             # comuni ISTAT, testi legali v1, sedi di esempio
npm run dev:api                             # terminale 2: API su http://127.0.0.1:3000
npm run dev:web                             # terminale 3: PWA su http://localhost:4200 (proxy verso l'API)
```
Utenti di prova, dati di esempio e giro completo: vedi la sezione [Test in locale](#test-in-locale).

**Email in sviluppo**: con `MAIL_TRANSPORT=outbox` (default senza `SMTP_HOST`) le email non vengono spedite. Sono scritte come file JSON in `apps/api/.mail-outbox/`, e lì si trova il codice di verifica richiesto al primo accesso. In produzione è ammesso solo `smtp`.

**Marchio (white label)**: grafica, nome, email e dati legali arrivano da `brands/<BRAND>/` (default: `default`). Per provare il marchio Fincons: `$env:BRAND='fincons'; npm run dev:web` e `BRAND=fincons` in `apps/api/.env`. Guida di stile (solo sviluppo): <http://localhost:4200/dev/stile>. Nuovo cliente: [docs/nuovo-marchio.md](docs/nuovo-marchio.md); analisi del marchio Fincons: [docs/brand-fincons.md](docs/brand-fincons.md). Dopo l'aggiornamento che ha introdotto i marchi, rilanciare `npm run db:seed` per caricare i testi legali con i segnaposto (in sviluppo la v1 si riallinea ai file).

**Test su iPhone e Android reali** (installazione PWA e push in HTTPS sulla rete locale): vedi [docs/test-dispositivi.md](docs/test-dispositivi.md), che contiene anche la checklist per ciascun dispositivo.

## Test in locale
Giro di prova completo su Windows con **Git Bash**. I comandi si lanciano dalla radice del repository.

### Node 24 senza diritti di amministratore
`nvm use` di nvm-windows richiede i diritti di amministratore, perché crea un collegamento in `C:\Program Files`. In alternativa si mette Node 24 in testa al `PATH` della shell. Con nvm-windows installato in `C:\nvm`:
```bash
# una volta sola: in ~/.bashrc di Git Bash, come PRIMA riga
export PATH="/c/nvm/v24.18.1:$PATH"
```
La riga deve stare **prima** di ogni comando che usa Node, ad esempio `source <(ng completion script)` per il completamento di Angular CLI. Altrimenti quel comando parte con una versione vecchia di Node e mostra un errore a ogni apertura del terminale. Se nel file c'è anche un `export PATH` verso un'altra versione di Node, va tolto.
Poi si apre un nuovo terminale Git Bash, oppure si lancia `source ~/.bashrc`, e si verifica:
```bash
node -v   # v24.18.1
npm -v    # 11.16.0
```
In PowerShell, solo per la sessione corrente: `$env:Path = "C:\nvm\v24.18.1;" + $env:Path`.

### Prima volta
```bash
npm install
cp apps/api/.env.example apps/api/.env
# chiavi di cifratura e HMAC (32 byte casuali ciascuna)
sed -i "s|^DATA_ENCRYPTION_KEYS=.*|DATA_ENCRYPTION_KEYS=1:$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")|" apps/api/.env
sed -i "s|^HMAC_KEY=.*|HMAC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")|" apps/api/.env
```
Le notifiche push sono facoltative. Per provarle: `npx web-push generate-vapid-keys`, poi copiare le due chiavi in `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` di `apps/api/.env`.

### Avvio (ogni volta)
Servono tre terminali.
```bash
# terminale 1: database (resta in esecuzione; se è già avviato lo dice ed esce)
npm run db:start

# terminale 2: migrazioni, dati di riferimento, dati di esempio, API
npm run db:migrate     # applica le migrazioni mancanti e rigenera il client Prisma
npm run db:seed        # comuni, sedi, testi legali (idempotente)
npm run db:demo        # FACOLTATIVO: dati di esempio (vedi sotto). Cancella utenti e viaggi esistenti!
npm run dev:api        # API su http://127.0.0.1:3000

# terminale 3: PWA
npm run dev:web        # http://localhost:4200
```
`npm run db:demo` ricompila l'API: va lanciato **prima** di `npm run dev:api`, oppure con l'API ferma.

### Utenze di prova
Login fittizio, attivo solo in sviluppo (`AUTH_PROVIDER=mock`). **Password per tutte: `demo`.**

| Username | Nome e cognome | Con `npm run db:demo` |
|---|---|---|
| `admin` | Amministratore Demo | admin globale |
| `mario.rossi` | Mario Rossi | conducente (Bergamo, auto a gasolio), storico di viaggi, un viaggio da chiudere, uno domani |
| `laura.bianchi` | Laura Bianchi | passeggera (Monza), ha Mario tra i preferiti, può segnalare Anna |
| `giuseppe.verdi` | Giuseppe Verdi | passeggero (Sesto San Giovanni) e **admin della Sede di Milano** |
| `anna.neri` | Anna Neri | passeggera (Monza), assente a un viaggio, con una segnalazione aperta |
| `paolo.gialli` | Paolo Gialli | non creato: serve per provare il **primo accesso** (informativa, email, consensi) |
| `ex.dipendente` | Ex Dipendente | login sempre rifiutato: simula un dipendente uscito |

Le utenze sono definite in `apps/api/src/auth/mock-identity.provider.ts`. In produzione il provider mock è bloccato dalla validazione della configurazione.

**Admin globale.** In `apps/api/.env`:
```
INITIAL_GLOBAL_ADMIN=admin
```
È già il valore di `.env.example`. L'utenza indicata riceve il ruolo al login. In produzione va messo lo username aziendale reale: con `admin` l'API non parte. Gli altri ruoli si assegnano dall'area admin → Ruoli.

**Admin di sede.** `npm run db:demo` rende `giuseppe.verdi` admin della Sede di Milano. Senza i dati di esempio: login come `admin`, poi area admin → Ruoli → cerca "Verdi" → Admin di sede → Sede di Milano.

### Dati di esempio (`npm run db:demo`)
Lo script è solo per lo sviluppo: rifiuta di partire con `NODE_ENV=production` o con il login aziendale. Il codice è in `apps/api/src/dev/demo-data.ts`.

**Cosa cancella.** Svuota utenti, viaggi, chat, segnalazioni e statistiche del database di sviluppo. Restano comuni, sedi, testi legali, parametri e audit log.

**Cosa ricrea.** Le date sono **relative al giorno in cui lo si lancia**:
- 5 viaggi **conclusi** di Mario nelle ultime 5 settimane, un viaggio privato concluso di Laura e un viaggio annullato. Popolano le statistiche personali e la dashboard admin, con statistiche calcolate dagli stessi servizi dell'app;
- un viaggio di **2 giorni fa**, concluso con Anna assente:
  - Laura lo trova in Home → Viaggi recenti e può segnalare Anna;
  - c'è già una segnalazione aperta di Mario per l'area admin;
- un viaggio di **ieri da chiudere**: Mario lo trova in Home → Viaggi da chiudere. Chiudendolo con un passeggero assente si provano chiusura, statistiche e segnalazioni;
- viaggi **futuri**:
  - domani, di Mario con Laura e due messaggi in chat;
  - tra 3 giorni, di Laura, pubblico e senza passeggeri: lo si trova cercando un passaggio con Anna o Paolo;
  - tra 2 giorni, di Giuseppe, privato.

Si può rilanciare quando si vuole, per ripartire da una situazione nota.

### Comuni con le coordinate
Le distanze, e quindi km e risparmi, si calcolano solo per i comuni con coordinate. Finché non si generano quelle ISTAT (vedi [docs/distanze.md](docs/distanze.md)), in sviluppo ce le hanno solo:

| Comune | Codice ISTAT |
|---|---|
| Milano (sede "Sede di Milano") | 015146 |
| Monza | 108033 |
| Sesto San Giovanni | 015209 |
| Bergamo | 016024 |
| Roma (sede "Sede di Roma") | 058091 |
| Torino (sede "Sede di Torino") | 001272 |

Per vedere km e risparmi usare questi comuni nei profili e nei viaggi: ad esempio Bergamo → Monza → Sesto San Giovanni verso la Sede di Milano. Con altri comuni il viaggio conta comunque, ma senza km, e la dashboard lo indica come "incompleto".

### Codici di verifica email
In sviluppo le email non vengono spedite: con `MAIL_TRANSPORT=outbox` sono scritte come file JSON in **`apps/api/.mail-outbox/`**, uno per messaggio. Per leggere il codice dell'ultimo messaggio:
```bash
ls -t apps/api/.mail-outbox | head -1 | xargs -I{} cat apps/api/.mail-outbox/{}
```
Le utenze create da `npm run db:demo` hanno già l'email verificata (`<username>@example.test`). Il codice serve per il primo accesso di `paolo.gialli` e per i cambi di email dal profilo.

### Suggerimenti per il giro di prova
- Usare due browser diversi, oppure una finestra normale e una in incognito, per avere due utenti collegati insieme: ad esempio il conducente e un passeggero per la chat in tempo reale.
- La PWA di sviluppo (`dev:web`) non installa il service worker. Installazione e notifiche push si provano con [docs/test-dispositivi.md](docs/test-dispositivi.md).
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
  - approvazione dell'azienda all'uso di logo e marchio Fincons ([docs/brand-fincons.md](docs/brand-fincons.md)); le icone si generano dal logo del marchio ([docs/icone.md](docs/icone.md));
  - dati legali del titolare (`legal` in `brands/<id>/brand.json`);
  - coordinate dei comuni dai confini ISTAT: `npm run coords:istat -w api -- <confini.shp>`, poi `npm run db:seed -w api` ([docs/distanze.md](docs/distanze.md#coordinate-dei-comuni-fonte-istat)).
- Aggiornamento dell'elenco dei comuni (elenco SITUAS a oggi, confini al 1° gennaio): `npm run comuni:istat -w api -- <situas.csv> --al <data estrazione>`, poi `coords:istat` e `db:seed`. Ricodifiche, fusioni e incorporazioni sono gestite come descritto in [docs/distanze.md](docs/distanze.md#elenco-e-confini-date-diverse).
- [x] **Grafica white label**: design token, marchi `default` e `fincons`, icone PWA generate, contrasto WCAG AA verificato dai test.
- [x] **Fase 3** ([dettagli](docs/fase3.md)):
  - viaggi ricorrenti con gruppo fisso, "non ci sono" per una singola data e data resa pubblica;
  - lista d'attesa con avviso quando si libera un posto;
  - promemoria facoltativi la sera prima e prima della partenza;
  - report aggregati per il PSCL in CSV ed Excel, con soglia minima;
  - conservazione automatica di viaggi conclusi, inviti, sessioni e audit log.
