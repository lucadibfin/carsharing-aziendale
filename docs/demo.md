# Demo pubblica su Render + Neon (gratuita)

Guida per pubblicare una **demo con dati fittizi** dell'app su Internet, da provare come PWA su più telefoni, senza costi:

- **Render** (piano gratuito, regione Francoforte) ospita l'applicazione. È un unico servizio web: l'API serve anche la PWA, quindi tutto ha la stessa origine, compresi cookie di sessione e WebSocket della chat.
- **Neon** (piano gratuito, regione Francoforte) ospita il database PostgreSQL.

> **Prima di iniziare**: la demo gira fuori dall'infrastruttura aziendale. Va concordato con l'azienda (e il DPO) dove ospitare il repository e se la demo può essere pubblicata: vedi la sezione "Demo pubblica" in [PRIVACY.md](../PRIVACY.md).

## Indice
1. [Cosa fa la modalità demo](#1-cosa-fa-la-modalità-demo)
2. [Limiti dei piani gratuiti e cosa non è affidabile](#2-limiti-dei-piani-gratuiti-e-cosa-non-è-affidabile)
3. [Neon: account e database](#3-neon-account-e-database)
4. [Segreti da generare](#4-segreti-da-generare)
5. [Render: account, repository e primo deploy](#5-render-account-repository-e-primo-deploy)
6. [Variabili d'ambiente (elenco completo)](#6-variabili-dambiente-elenco-completo)
7. [Verificare che tutto funzioni](#7-verificare-che-tutto-funzioni)
8. [Aggiornare la demo dopo nuove modifiche](#8-aggiornare-la-demo-dopo-nuove-modifiche)
9. [Riportare la demo allo stato iniziale](#9-riportare-la-demo-allo-stato-iniziale)
10. [Problemi frequenti](#10-problemi-frequenti)

---

## 1. Cosa fa la modalità demo

Si attiva con `DEMO_MODE=true`, già impostata in [`render.yaml`](../render.yaml).

| Funzione | Comportamento in demo |
|---|---|
| Login | Solo **utenti di prova fittizi**. La pagina di login li elenca: un tocco compila l'accesso, password `demo` per tutti. L'integrazione con l'API aziendale **non si può attivare**: con `AUTH_PROVIDER=corporate` o con `CORPORATE_AUTH_URL`/`CORPORATE_CHECK_URL` valorizzate l'app si rifiuta di partire, e il codice usa comunque solo il login di prova. |
| Email | **Nessuna email viene inviata**, mai. Il codice di verifica dell'email compare **a schermo** con una nota che spiega che è una demo. Qualunque indirizzo inventato va bene. |
| Banner | "**DEMO - dati fittizi** · non inserire dati personali reali", sempre visibile e non chiudibile. |
| Motori di ricerca | Esclusi in tre modi: `/robots.txt` con `Disallow: /`, header `X-Robots-Tag: noindex, nofollow` su ogni risposta, `<meta name="robots" content="noindex, nofollow">` nella pagina. |
| Dati di esempio | Caricati **automaticamente al primo avvio**, quando il database non ha utenti: utenti, 3 sedi, viaggi conclusi, uno da chiudere, una segnalazione, viaggi futuri e qualche messaggio in chat. Le date sono relative al giorno del caricamento. |
| Ripristino | Area admin → **Parametri** → sezione **Demo** → "Riporta la demo allo stato iniziale" (solo admin globale). Vedi il [§9](#9-riportare-la-demo-allo-stato-iniziale). |

Utenti di prova (password `demo`):

| Username | Ruolo nella demo |
|---|---|
| `admin` | Amministratore globale |
| `giuseppe.verdi` | Amministratore della Sede di Milano |
| `mario.rossi` | Conducente: storico, un viaggio da chiudere, uno domani |
| `laura.bianchi` | Passeggera: può segnalare un'assenza |
| `anna.neri` | Passeggera con una segnalazione aperta |
| `paolo.gialli` | Nuovo utente: per provare il primo accesso (informativa, email con codice a schermo, sede e comune) |

> La demo è **pubblica**: chiunque abbia l'indirizzo può entrare, anche come `admin`, e modificare o ripristinare i dati. Va bene perché i dati sono fittizi. Condividi il link solo con chi deve provarla.

## 2. Limiti dei piani gratuiti e cosa non è affidabile

I limiti dei piani gratuiti cambiano nel tempo: verificali sulle pagine prezzi di Render e Neon. Quelli che contano qui:

- **Render mette in pausa il servizio** dopo circa 15 minuti senza visite.
  - La visita successiva lo risveglia, ma la prima risposta può richiedere **fino a circa un minuto**.
  - Se la PWA è già installata, si apre subito dalla cache. Il banner mostra "Avvio del server in corso…" finché il server non risponde, poi tutto prosegue da solo.
  - La chat si riconnette in automatico.
- **Neon sospende il database** quando nessuno lo usa. Al primo accesso si riattiva in meno di un secondo.
- **Il filesystem di Render non è persistente**. L'app non ci salva niente: tutto è nel database.

Cosa succede alle attività programmate (coda pg-boss) durante la pausa:

| Attività | Normalmente | Dopo una pausa |
|---|---|---|
| Promemoria (ogni 5 minuti) | Sera prima e prima della salita | Al risveglio il giro perso si esegue **una volta**. I promemoria ancora utili partono. Quelli superati non partono: serale del giorno prima, salita o partenza già passata. |
| Pulizie notturne (chat, codici email, segnalazioni, viaggi vecchi, sessioni, audit) | Notte, tra le 3 e le 4 | Recuperate **una volta al risveglio**, invece che di notte. |
| Date dei viaggi ricorrenti | 00:10 | Recuperata una volta al risveglio. |
| Verifica notturna dipendenti | Solo con login aziendale | Mai attiva in demo. |

**Cosa NON funziona in modo affidabile nella demo:**
- **Promemoria e notifiche push** partono solo mentre il servizio è sveglio, cioè entro circa 15 minuti da una visita. Un promemoria previsto mentre la demo dorme arriva in ritardo al risveglio, solo se è ancora utile, oppure non arriva affatto.
- **Gli orari dei job notturni** non sono rispettati: girano alla prima visita successiva.
- **La prima apertura dopo una pausa** è lenta, fino a circa un minuto.
- **Notifiche push su iPhone**: funzionano solo con la PWA installata nella schermata Home (iOS 16.4 o successivo).
- **Stato iniziale**: con il passare dei giorni i viaggi "futuri" di esempio diventano passati. Il ripristino ([§9](#9-riportare-la-demo-allo-stato-iniziale)) ricrea i dati con le date riferite a oggi.
- **Audit log**: il ripristino non lo azzera, perché per costruzione è immutabile. Mantiene anche le voci delle prove precedenti.

## 3. Neon: account e database

1. Vai su **neon.tech** e crea un account (**Sign up**). Puoi usare un account GitHub o Google, oppure email e password.
2. Alla prima entrata Neon propone di creare un **progetto**:
   - **Project name**: per esempio `fcs-demo`.
   - **Postgres version**: lascia quella proposta.
   - **Region**: scegli **AWS Europe Central 1 (Frankfurt)**.
   - Conferma con **Create project**.
3. Nella pagina del progetto apri **Connect** (o "Connection details"):
   - **Database**: `neondb` (quello creato in automatico va bene).
   - **Connection pooling**: **disattivalo**. Serve la connessione **diretta**: le code dei job (pg-boss) e le migrazioni non funzionano bene attraverso il pooler. Nell'host della stringa diretta **non** compare `-pooler`.
   - Copia la **connection string**. Ha questa forma:
     ```
     postgresql://neondb_owner:PASSWORD@ep-nome-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require
     ```
   - Deve contenere **`?sslmode=require`**. Se in fondo c'è anche `&channel_binding=require`, **toglilo**: lascia solo `?sslmode=require`.
4. Tieni da parte la stringa: è il valore di `DATABASE_URL`. **È un segreto**, perché contiene la password: non incollarla in chat, ticket o nel repository.

Non serve creare tabelle: le crea il deploy con le migrazioni.

## 4. Segreti da generare

Generali sul tuo PC (Node 24, dalla cartella del progetto) e tienili da parte per il passo successivo.

**Chiave di cifratura dei dati** (`DATA_ENCRYPTION_KEYS`):
```bash
node -e "console.log('1:' + require('crypto').randomBytes(32).toString('base64'))"
```
Il risultato ha la forma `1:AbC…=`. Va copiato **tutto**, compreso `1:`.

**Chiave HMAC** (`HMAC_KEY`): la genera Render da solo (`generateValue` in `render.yaml`), non devi fare nulla.

**Chiavi per le notifiche push** (facoltative, ma servono per provare le push sui telefoni):
```bash
npx web-push generate-vapid-keys
```
Restituisce una *Public Key* e una *Private Key*. Vanno in `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`.

> Una volta pubblicata la demo, **non cambiare** `DATA_ENCRYPTION_KEYS`, `HMAC_KEY` e le chiavi VAPID:
> - con altre chiavi di cifratura i dati già salvati (email, telefoni, chat) non si leggono più. In quel caso basta un ripristino della demo;
> - con altre chiavi VAPID le iscrizioni push dei telefoni smettono di funzionare.

## 5. Render: account, repository e primo deploy

Render prende il codice da un repository **GitHub, GitLab o Bitbucket**. Il repository deve contenere il file `render.yaml` nella radice (c'è già) sul branch `main`.

1. **Account**: vai su **render.com**, poi **Get Started**. Conviene registrarsi con lo stesso servizio dove sta il repository (GitHub, GitLab o Bitbucket): il collegamento è immediato. Non serve una carta di credito per il piano gratuito.
2. **Collegare il repository**:
   - nella dashboard: **New +** → **Blueprint**;
   - se richiesto, autorizza Render ad accedere al tuo account Git. Puoi limitare l'accesso al solo repository della demo;
   - scegli il repository e il branch `main`.
3. **Blueprint**:
   - Render legge `render.yaml` e mostra il servizio **`fcs-demo`** (web, Node, Frankfurt, Free);
   - dai un nome al Blueprint, per esempio `fcs-demo`;
   - Render chiede i valori delle variabili segnate come da compilare: inseriscili come nella tabella del [§6](#6-variabili-dambiente-elenco-completo). Il minimo indispensabile è `DATABASE_URL` e `DATA_ENCRYPTION_KEYS`;
   - conferma con **Apply** (o "Deploy Blueprint").
4. **Primo deploy**:
   - apri il servizio `fcs-demo` → **Events** / **Logs**;
   - la build installa le dipendenze, compila web e API, applica le migrazioni sul database Neon e carica i dati di riferimento (comuni, testi legali, sedi di esempio). Richiede qualche minuto;
   - all'avvio, nel log compaiono "dati di esempio caricati (primo avvio della demo)" e poi "Nest application successfully started";
   - quando lo stato diventa **Live**, l'indirizzo pubblico è in alto nella pagina del servizio, per esempio `https://fcs-demo.onrender.com`. Se il nome è già preso, Render aggiunge un suffisso.

`APP_ORIGIN` **non serve**: se è vuota, l'app usa l'indirizzo pubblico che Render le comunica (`RENDER_EXTERNAL_URL`). Impostala a mano solo se aggiungi un dominio personalizzato.

## 6. Variabili d'ambiente (elenco completo)

Si vedono e si modificano in Render → servizio `fcs-demo` → **Environment**. Dopo una modifica Render chiede di salvare e ridistribuire: scegli **Save, rebuild, and deploy**, oppure "Save and deploy".

### Già impostate da `render.yaml` (non modificarle)

| Variabile | Valore | A cosa serve |
|---|---|---|
| `NODE_VERSION` | `24.18.1` | Versione di Node usata da Render, uguale a `.nvmrc`. Include npm 11.16.0, richiesto dal progetto. |
| `NODE_ENV` | `production` | Cookie sicuri, HSTS, ascolto su tutte le interfacce, log JSON. |
| `DEMO_MODE` | `true` | Attiva la modalità demo ([§1](#1-cosa-fa-la-modalità-demo)). |
| `AUTH_PROVIDER` | `mock` | Login con utenti di prova. In demo è l'unico ammesso. |
| `BRAND` | `default` | Marchio neutro "Car Sharing aziendale". Lo usano sia la build web sia l'API. |
| `WEB_DIST_DIR` | `apps/web/dist/web/browser` | Cartella della PWA compilata, servita dall'API. |
| `TRUST_PROXY` | `1` | L'app è dietro il proxy di Render: serve per l'IP reale, usato dai limiti dei tentativi di login. |
| `JOBS_ENABLED` | `true` | Coda dei job (promemoria e pulizie). |
| `LOG_LEVEL` | `info` | Livello dei log. |
| `HMAC_KEY` | generata da Render | Pseudonimi nei log e hash dei codici. 32 byte in base64. |

### Da inserire

| Variabile | Obbligatoria | Cosa inserire | Esempio |
|---|---|---|---|
| `DATABASE_URL` | **sì** | Stringa di connessione **diretta** di Neon, con `?sslmode=require` ([§3](#3-neon-account-e-database)) | `postgresql://neondb_owner:…@ep-….eu-central-1.aws.neon.tech/neondb?sslmode=require` |
| `DATA_ENCRYPTION_KEYS` | **sì** | `1:` seguito da una chiave casuale di 32 byte in base64 ([§4](#4-segreti-da-generare)) | `1:Qm9n…=` |
| `VAPID_PUBLIC_KEY` | no (per le push) | Public Key di `npx web-push generate-vapid-keys` | `BPx…` |
| `VAPID_PRIVATE_KEY` | no (per le push) | Private Key dello stesso comando | `3kQ…` |
| `VAPID_SUBJECT` | no (consigliata con le push) | `mailto:` seguito da un tuo indirizzo. Apple rifiuta le push con indirizzi poco plausibili. | `mailto:nome.cognome@azienda.it` |

### Facoltative (normalmente da non impostare)

| Variabile | Default | Quando impostarla |
|---|---|---|
| `APP_ORIGIN` | indirizzo pubblico di Render | Solo con un dominio personalizzato: `https://demo.esempio.it`, senza `/` finale. Deve coincidere **esattamente** con l'indirizzo aperto nel browser, altrimenti la chat non si connette. |
| `SESSION_MAX_DAYS` / `SESSION_IDLE_DAYS` | 14 / 7 | Durata delle sessioni. |
| `LOGIN_MAX_FAILURES_PER_USER`, `LOGIN_MAX_FAILURES_PER_IP`, `LOGIN_LOCK_MINUTES` | 3 / 20 / 15 | Blocco dopo troppi errori di password. |
| `ROUTING_PROVIDER` | `estimate` | Lasciare `estimate`: distanze stimate in linea d'aria, nessun servizio esterno. |

### Da NON impostare in demo
- `CORPORATE_AUTH_URL`, `CORPORATE_CHECK_URL`: l'app si rifiuta di partire.
- `MAIL_TRANSPORT`, `SMTP_*`: in demo non si inviano email. Un `MAIL_TRANSPORT` diverso da `disabled` blocca l'avvio.
- `PORT`: la imposta Render.

## 7. Verificare che tutto funzioni

Sostituisci `https://fcs-demo.onrender.com` con il tuo indirizzo.

**Dal computer:**
1. `https://fcs-demo.onrender.com/api/health` risponde `{"ok":true}`: app e database funzionano.
2. `https://fcs-demo.onrender.com/robots.txt` mostra `Disallow: /`.
3. La pagina principale mostra il banner **DEMO - dati fittizi** e, nel login, l'elenco degli utenti di prova.
4. Login come `mario.rossi`. In Home ci sono un viaggio da chiudere e i viaggi futuri.
5. Login come `admin` → **Area admin**: dashboard, segnalazioni e parametri (con la sezione **Demo** in fondo).
6. Header noindex (facoltativo). In Chrome: F12 → **Network** → ricarica → clic sulla prima richiesta → **Headers**: c'è `X-Robots-Tag: noindex, nofollow`.

**Dai telefoni:**

7. **Primo accesso**: entra come `paolo.gialli`, accetta informativa e termini e inserisci un'email inventata. Il codice compare a schermo: inseriscilo e completa sede e comune.
8. **Chat in tempo reale**:
   - telefono A come `mario.rossi`, telefono B come `laura.bianchi`;
   - entrambi aprono il viaggio di domani → **Chat del viaggio**;
   - un messaggio inviato da A compare subito su B.
9. **Installazione PWA**:
   - Android/Chrome: menu ⋮ → **Installa app** (o "Aggiungi a schermata Home");
   - iPhone/Safari: **Condividi** → **Aggiungi alla schermata Home**.
10. **Push** (con le chiavi VAPID impostate):
    - dal profilo attiva le notifiche sul telefono (su iPhone solo dalla PWA installata);
    - da un altro telefono fai un'azione che genera una notifica, per esempio una richiesta di posto su un viaggio dell'utente.
11. **Risveglio**:
    - lascia la demo inutilizzata per più di 15 minuti, poi riaprila;
    - la prima risposta tarda (banner "Avvio del server in corso…"), poi tutto riprende senza errori;
    - nei log di Render si vede il riavvio.
12. **Ripristino**: come `admin` → Parametri → Demo → spunta la conferma → **Riporta la demo allo stato iniziale**. Si torna al login e i dati sono quelli di partenza.

Altri controlli per dispositivo: [docs/test-dispositivi.md](test-dispositivi.md).

## 8. Aggiornare la demo dopo nuove modifiche

- **Automatico**: ogni push sul branch `main` del repository collegato avvia un nuovo deploy.
- **Manuale**: servizio `fcs-demo` → **Manual Deploy** → **Deploy latest commit**.
- Se una build fallisce in modo strano dopo un cambio di dipendenze: **Manual Deploy** → **Clear build cache & deploy**.

A ogni deploy:
- le **migrazioni** del database si applicano da sole (`prisma migrate deploy` nel comando di build), così come il seed dei dati di riferimento, che è idempotente;
- i **dati della demo restano**: utenti e viaggi non si cancellano. Per ripartire da zero usa il ripristino ([§9](#9-riportare-la-demo-allo-stato-iniziale));
- se il deploy fallisce, Render lascia attiva la versione precedente.

> Una migrazione viene applicata già durante la build. Se poi l'avvio della nuova versione fallisce, resta attiva la versione precedente con lo schema nuovo. Con migrazioni che solo aggiungono, come quelle del progetto, non è un problema.

Per cambiare una variabile: **Environment** → modifica → salva e ridistribuisci.

## 9. Riportare la demo allo stato iniziale

**Dall'app** (consigliato): login come `admin` → **Area admin** → **Parametri** → in fondo, sezione **Demo** → spunta "Ho capito…" → **Riporta la demo allo stato iniziale**.

Effetti del ripristino:
- cancella utenti, viaggi, chat, segnalazioni, statistiche, iscrizioni push e sessioni. Chiunque stia usando la demo dovrà rifare il login;
- riporta sedi, testi legali e parametri allo stato iniziale;
- ricrea i dati di esempio con le date riferite a oggi;
- lascia intatto l'audit log, dove registra il ripristino.

**Da riga di comando** (alternativa; il piano gratuito di Render non ha una shell). Dal tuo PC, con il codice aggiornato e `npm install` già fatto, in PowerShell:
```powershell
$env:DEMO_MODE='true'; $env:NODE_ENV='production'; $env:AUTH_PROVIDER='mock'
$env:APP_ORIGIN='https://fcs-demo.onrender.com'
$env:DATABASE_URL='<stessa DATABASE_URL di Render>'
$env:DATA_ENCRYPTION_KEYS='<stessa di Render>'; $env:HMAC_KEY='<stessa di Render>'
npm run db:demo
```
Le chiavi devono essere **le stesse** del servizio Render: si leggono in **Environment**, con l'icona per mostrare il valore. Con chiavi diverse i dati creati non sarebbero leggibili dall'app. Chiudi poi la finestra di PowerShell, così le variabili non restano in memoria.

Per **svuotare del tutto** il database e ripartire dal primo avvio: in Neon → **Branches** → *Reset* / ripristino del branch, oppure elimina e ricrea il progetto e aggiorna `DATABASE_URL`. Poi **Manual Deploy**.

## 10. Problemi frequenti

| Sintomo | Causa probabile e rimedio |
|---|---|
| Build fallita con `Unsupported engine` | Versione di Node o npm diversa: controlla che `NODE_VERSION` sia `24.18.1`. |
| Avvio fallito con `Configurazione non valida: DATABASE_URL` / `DATA_ENCRYPTION_KEYS` / `HMAC_KEY` | Variabile mancante o nel formato sbagliato. Il messaggio indica quale, mai il valore. `DATA_ENCRYPTION_KEYS` deve iniziare con `1:`. |
| Avvio fallito con `AUTH_PROVIDER`, `CORPORATE_*` o `MAIL_TRANSPORT` | Sono impostate variabili non ammesse in demo ([§6](#6-variabili-dambiente-elenco-completo)): rimuovile. |
| Migrazioni fallite con errori di connessione o SSL | `DATABASE_URL` deve essere la stringa **diretta** (senza `-pooler`) e terminare con `?sslmode=require`. |
| La chat non si aggiorna in tempo reale | `APP_ORIGIN` impostata a mano e diversa dall'indirizzo aperto: cancellala oppure correggila. |
| "Troppi tentativi non riusciti" per tutti | Troppi errori di password dallo stesso IP: si sblocca da solo dopo 15 minuti. Controlla che `TRUST_PROXY` sia `1`. |
| Le push non arrivano | Chiavi VAPID mancanti o cambiate, notifiche non attivate sul telefono, iPhone senza PWA installata, oppure servizio in pausa ([§2](#2-limiti-dei-piani-gratuiti-e-cosa-non-è-affidabile)). |
| Dopo un aggiornamento il telefono mostra la versione vecchia | La PWA si aggiorna al riavvio successivo: chiudila del tutto e riaprila. |
