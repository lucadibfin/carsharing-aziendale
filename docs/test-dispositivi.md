# Test su iPhone e Android reali (HTTPS in rete locale)

Installazione della PWA, service worker e notifiche push funzionano **solo in HTTPS con un certificato considerato attendibile dal telefono**. L'ambiente di sviluppo normale (`http://localhost:4200`) non basta, per due motivi:
- il telefono non può raggiungere `localhost`;
- `ng serve` non registra il service worker, che esiste solo nella build di produzione.

Schema:

```
iPhone / Android ──HTTPS (Wi-Fi)──▶ PC: npm run serve:https (porta 8443)
                                        ├─ file statici: build di produzione della PWA
                                        └─ /api e /socket.io ──▶ API di sviluppo (127.0.0.1:3000)
API ──HTTPS in uscita──▶ servizi push di Google (Android) e Apple (iPhone)
```

## Quale soluzione
**Consigliata: rete locale + certificato di una CA di sviluppo (mkcert).**
- Il traffico non esce dalla rete, salvo l'invio delle push ai servizi di Google e Apple, come in produzione.
- Non serve nessun servizio di terze parti.

**Alternativa sconsigliata: tunnel pubblico** (es. Cloudflare Tunnel, ngrok).
- Espone il PC su Internet.
- Il traffico passa da un fornitore terzo, spesso extra-UE.
- Di solito richiede l'approvazione di IT/sicurezza.
- Va usato solo con i dati fittizi del provider mock. I *dev tunnels* di Microsoft sono esclusi dal vincolo "nessuno strumento Microsoft".
- Da considerare solo se la rete Wi-Fi isola i dispositivi tra loro e non c'è alternativa.

## Prerequisiti
- PC e telefoni sulla **stessa rete Wi-Fi**. Le reti "ospiti" e molte reti aziendali isolano i dispositivi tra loro: in quel caso usare un hotspot dedicato o una rete di laboratorio.
- **iPhone con iOS 16.4 o successivo**: prima di questa versione le push web non esistono.
- **Android con Chrome aggiornato.**
- Il PC deve poter raggiungere in uscita `fcm.googleapis.com` (Android) e `web.push.apple.com` (iPhone). Se la rete passa da un proxy aziendale, impostare `PUSH_HTTPS_PROXY` nell'`.env` dell'API.

## Preparazione (una volta)
1. **Indirizzo IP del PC** in Wi-Fi: `Get-NetIPAddress -AddressFamily IPv4`, oppure lo stampa `npm run serve:https` all'avvio. Negli esempi: `192.168.1.50`.
2. **Firewall di Windows**: aprire la porta 8443 solo per le reti private, in PowerShell come amministratore:
   ```powershell
   New-NetFirewallRule -DisplayName "FCS test dispositivi" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private
   ```
   La rete Wi-Fi deve essere impostata come "privata" in Windows.
3. **Certificato con mkcert** (https://github.com/FiloSottile/mkcert, licenza BSD; es. `winget install FiloSottile.mkcert`):
   ```powershell
   mkcert -install                                   # crea una CA locale e la rende attendibile sul PC
   mkdir certs
   mkcert -cert-file certs/dev-cert.pem -key-file certs/dev-key.pem 192.168.1.50 localhost
   mkcert -CAROOT                                    # cartella con rootCA.pem da copiare sui telefoni
   ```
   - Sui telefoni va copiato **solo `rootCA.pem`**.
   - `rootCA-key.pem` **non deve mai uscire dal PC**: chi lo possiede può creare certificati validi per qualunque sito sui dispositivi che si fidano della CA.
   - `certs/` è escluso da git.
4. **Installare la CA sull'iPhone**:
   1. inviare `rootCA.pem` all'iPhone (AirDrop, oppure email a sé stessi) e aprirlo: compare "Profilo scaricato";
   2. Impostazioni → Generali → **VPN e gestione dispositivi** → profilo mkcert → Installa;
   3. Impostazioni → Generali → Info → **Impostazioni certificati attendibili** → attivare la fiducia completa per la CA mkcert.
5. **Installare la CA su Android** (il percorso varia secondo il produttore):
   1. copiare `rootCA.pem` sul telefono;
   2. Impostazioni → Sicurezza (o "Sicurezza e privacy") → Altre impostazioni → **Crittografia e credenziali** → Installa un certificato → **Certificato CA**;
   3. Chrome considera attendibili le CA installate dall'utente.

## Avvio di una sessione di test
In tre terminali PowerShell sul PC (Node 24):
```powershell
# 1) database
npm run db:start

# 2) API: le variabili d'ambiente prevalgono sul file .env
$env:APP_ORIGIN = "https://192.168.1.50:8443"   # deve coincidere con l'indirizzo aperto sui telefoni
$env:TRUST_PROXY = "1"                          # IP reale dei telefoni per il limite dei tentativi di login
$env:VAPID_SUBJECT = "mailto:<casella reale del team>"   # Apple rifiuta subject non plausibili
npm run dev:api

# 3) build di produzione della PWA + server HTTPS
npm run build -w web
npm run serve:https
```
Poi, sui telefoni, aprire `https://192.168.1.50:8443`.

Note:
- Durante il test usare **solo** l'indirizzo HTTPS, anche dal PC, per il secondo utente: con `APP_ORIGIN` in https il cookie di sessione diventa `__Host-sid`, che funziona solo in HTTPS, e la chat accetta connessioni solo da quell'origine.
- **Utenti di prova** (provider mock): `mario.rossi`, `laura.bianchi`, `giuseppe.verdi`, `anna.neri` e gli altri del README, con la password del README. I codici di verifica email si leggono sul PC in `apps/api/.mail-outbox/`.
- **Dopo una modifica al frontend** rifare `npm run build -w web`. Sul telefono la nuova versione arriva dopo una o due riaperture dell'app: il service worker aggiorna in background.
- **Notifiche da far scattare**: tenere un utente sul telefono e un altro sul PC.
  | Azione sul PC | Notifica sul telefono | Categoria |
  |---|---|---|
  | Accetta la richiesta del telefono | Richiesta accettata | essenziale: push + email nella outbox |
  | Invia un invito a un utente "trovabile" | Nuovo invito | essenziale |
  | Annulla il viaggio | Viaggio annullato | essenziale |
  | Scrive in chat | Nuovi messaggi | solo push, raggruppata: arriva dopo circa 2 minuti |
  | Chiede di partecipare a un viaggio del telefono | Nuova richiesta | solo push |

## Checklist — Android (Chrome)
**Installazione**
- [ ] Il sito si apre senza avvisi di certificato (lucchetto normale).
- [ ] Compare la proposta "Installa app", oppure si trova nel menu ⋮ → "Installa app" / "Aggiungi a schermata Home".
- [ ] L'icona compare tra le app. Le icone attuali sono quelle segnaposto di Angular: **da sostituire** con quelle definitive.
- [ ] Aperta dall'icona, l'app è a schermo intero, senza barra degli indirizzi, con barra di stato verde (`theme_color`) e orientamento verticale.
- [ ] Login e primo accesso completi dall'app installata: informativa, termini, codice email, consensi tutti spenti, sede e comune.

**Notifiche push**
- [ ] Profilo → "Attiva le notifiche" → il permesso di Android compare solo dopo il tocco, non all'apertura dell'app.
- [ ] Per ogni riga della tabella sopra, la notifica arriva:
  - [ ] con l'app aperta;
  - [ ] con l'app in background;
  - [ ] con l'app chiusa;
  - [ ] con il telefono bloccato.
- [ ] Testo **generico**: nessun nome, nessun testo della chat, anche nell'anteprima sulla schermata di blocco.
- [ ] Toccando la notifica si apre la pagina giusta: il viaggio, oppure la chat per i messaggi.
- [ ] Più messaggi in chat in pochi minuti producono **una sola** notifica.
- [ ] Chat silenziata ("Silenzia") → nessuna notifica di chat. Le notifiche dei viaggi continuano ad arrivare.
- [ ] Permesso revocato dalle impostazioni di Android → il profilo mostra "Hai bloccato le notifiche…" e l'app continua a funzionare.
- [ ] "Disattiva" nel profilo → non arrivano più push su quel dispositivo; le email essenziali continuano (outbox).

**Uso quotidiano**
- [ ] La chat si aggiorna in tempo reale e riprende dopo un passaggio in background o un cambio di rete (Wi-Fi ↔ dati: in questo test solo Wi-Fi).
- [ ] La tastiera non copre il campo del messaggio. I selettori nativi di data e ora funzionano. La ricerca del comune funziona con la tastiera del telefono.
- [ ] In modalità aereo l'app si apre (shell dal service worker) e mostra "Connessione assente" invece di una pagina bianca.
- [ ] Nessuna richiesta verso domini terzi. Si verifica dal PC con `chrome://inspect` (debug remoto USB), scheda Network.

## Checklist — iPhone (Safari, iOS ≥ 16.4)
**Installazione**
- [ ] Il sito si apre in Safari senza avvisi di certificato. Se Safari avvisa, manca il passaggio "fiducia completa" (Preparazione, punto 4).
- [ ] In Safari, Profilo → sezione notifiche: compaiono le **istruzioni di installazione** e non il pulsante, perché su iPhone le push richiedono l'app installata.
- [ ] Condividi → **Aggiungi alla schermata Home**: nome "CarSharing" e icona (segnaposto, da sostituire).
- [ ] Aperta dall'icona, l'app è a schermo intero, senza interfaccia di Safari, e non ci sono contenuti nascosti sotto notch o Dynamic Island.
- [ ] L'app installata **non condivide la sessione** con Safari: va rifatto il login. È un comportamento atteso, da verificare che sia chiaro all'utente.

**Notifiche push** (solo dall'app installata)
- [ ] Profilo → "Attiva le notifiche" → compare il permesso di iOS.
- [ ] Stessi controlli della tabella e della checklist Android:
  - [ ] app aperta, in background, chiusa, telefono bloccato;
  - [ ] testo generico;
  - [ ] il tocco apre la pagina giusta;
  - [ ] chat raggruppata e silenziabile.
- [ ] Se le push **non arrivano** su iPhone ma su Android sì: controllare i log dell'API. Un errore 403 "BadJwtToken" indica un `VAPID_SUBJECT` non accettato da Apple. Un errore di rete verso `web.push.apple.com` indica il proxy o il firewall.
- [ ] Impostazioni iOS → Notifiche → CarSharing: disattivando, non arrivano più e l'app continua a funzionare.

**Uso quotidiano**
- [ ] Come per Android: chat in tempo reale dopo il background, tastiera, data e ora, comune, modalità aereo.
- [ ] Il debug remoto su iPhone richiede un Mac (Safari → Sviluppo). Senza Mac, controllare gli errori nei log dell'API.

## Fine dei test: pulizia
- [ ] Rimuovere la CA dai telefoni:
  - **iPhone**: Impostazioni → Generali → VPN e gestione dispositivi → profilo mkcert → Rimuovi;
  - **Android**: Crittografia e credenziali → Credenziali utente → rimuovere la CA mkcert.
- [ ] Rimuovere la regola del firewall: `Remove-NetFirewallRule -DisplayName "FCS test dispositivi"`, come amministratore.
- [ ] Facoltativo: `mkcert -uninstall` sul PC e cancellazione della cartella `certs/`.
- [ ] Chiudere i terminali: le variabili `$env:` impostate valgono solo per quella sessione.
