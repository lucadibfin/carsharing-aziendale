# Documento tecnico per il DPO — App Fincons Car Sharing

> **BOZZA tecnica** a supporto del registro dei trattamenti (art. 30) e della valutazione d'impatto (art. 35).
> Descrive l'applicazione **come implementata** a fine Fase 2. I punti aperti sono raccolti nel par. 12.
> Riferimenti: [informativa (bozza)](../legal/informativa-BOZZA.md), [PRIVACY.md](../../PRIVACY.md) (servizi esterni), [distanze e statistiche](../distanze.md).

## 1. Descrizione del trattamento
- **Cosa fa l'app.** È una PWA che mette in contatto colleghi della stessa sede che arrivano dagli stessi comuni, per condividere l'auto nel tragitto casa-lavoro.
- **Uso volontario.** Non usarla non ha alcuna conseguenza.
- **Divieto di uso per il controllo.** I dati non sono usati per valutare o controllare l'attività lavorativa (art. 4 L. 300/1970). L'app non offre funzioni che lo permettano:
  - nessuna posizione GPS;
  - nessun indirizzo;
  - l'area admin non mostra chi viaggia con chi, salvo nelle segnalazioni (par. 6).
- **Interessati.** Dipendenti delle sedi italiane che scelgono di registrarsi.
- **Titolare.** [DA COMPILARE].
- **Hosting.** VM dell'infrastruttura aziendale in UE. Nessun servizio cloud di terze parti.
- **Componenti:**
  - frontend Angular (PWA);
  - API NestJS;
  - PostgreSQL;
  - code di job pg-boss, sullo stesso database;
  - facoltativo: OSRM self-hosted per le distanze stradali.

## 2. Dati trattati e dove si trovano
| Dato | Tabella | Protezione | Visibile a |
|---|---|---|---|
| Username, nome, cognome | `User` | — | Interessato; altri utenti nei viaggi comuni; admin solo in segnalazioni e ruoli |
| Sede, comune di residenza (no indirizzo) | `User` | — | Interessato; il comune **non** è mostrato ad altri (si vede solo il comune di salita scelto per un viaggio). Aggiornato d'ufficio se il comune viene fuso o incorporato, con avviso all'utente (par. 12, C5) |
| Telefono (facoltativo) | `User.phoneEnc` | AES-256-GCM | Partecipanti confermati dello stesso viaggio, solo con consenso |
| Email per le notifiche | `User.emailEnc` | AES-256-GCM | Solo l'interessato; usata solo per l'invio |
| Codice di verifica email | `EmailVerification.codeHash` | HMAC-SHA256, scade dopo 15 minuti | Nessuno |
| Auto (alimentazione, consumo) | `User` | — | Interessato; usata nei calcoli |
| Consensi e loro storico | `UserConsent`, `ConsentEvent` | — | Interessato |
| Prese visione di informativa e termini | `PolicyAcceptance` | — | Interessato; admin solo come conteggio per versione |
| Viaggi, tappe (comuni), partecipazioni, inviti | `TripSeries`, `TripStop`, `Trip`, `TripParticipant`, `Invitation` | Token d'invito solo come hash | Secondo `TripAccessPolicy`: i viaggi privati sono invisibili (404) agli estranei |
| Messaggi chat | `ChatMessage.bodyEnc` | AES-256-GCM | Conducente e partecipanti confermati |
| Preferiti | `Favorite` | — | Solo chi crea la lista |
| Segnalazioni di assenza | `AbsenceReport.reasonEnc`, `decisionNoteEnc` | AES-256-GCM | Admin della sede; il segnalante (le proprie); il segnalato solo nell'esportazione, senza segnalante |
| Statistiche personali | `UserStatEntry` | — | Solo l'interessato |
| Statistiche anonime | `TripStatFact` | Nessun identificativo di persona | Admin (dashboard aggregata) |
| Sessioni | `Session.tokenHash` | SHA-256 del token | — |
| Sottoscrizioni push | `PushSubscription` | — | — |
| Contatori anti brute-force | `LoginThrottle` | Chiavi HMAC di username e IP | — |
| Audit log | `AuditLog` | Append-only con catena di hash; solo UUID e codici | Admin globali |

Dati **mai** trattati:
- password (par. 7);
- indirizzi di residenza;
- coordinate o posizione degli utenti;
- categorie particolari (art. 9);
- dati di navigazione o di profilazione.

## 3. Finalità, basi giuridiche e notifiche
Sono descritte nell'informativa (par. 5 e 5-bis), con le note per il DPO. In sintesi:
- **Servizio:** art. 6.1.b. Comprende le notifiche essenziali, anche via email, e quelle operative, solo push.
- **Funzioni facoltative:** art. 6.1.a, con consensi separati e non preselezionati. Sono il telefono visibile, la trovabilità e le notifiche facoltative.
- **Statistiche anonime per il PSCL:** art. 6.1.c e/o 6.1.f.
- **Sicurezza e audit:** art. 6.1.f e art. 32.
- **Segnalazioni:** art. 6.1.f, senza decisioni automatizzate.

## 4. Conservazione e cancellazione
| Dato | Regola | Come |
|---|---|---|
| Messaggi chat | 30 giorni (parametro) | Job alle 03:15 |
| Segnalazioni | 12 mesi (parametro) | Job alle 03:30 |
| Verifiche email non completate | 24 ore | Job alle 03:20 |
| Ex dipendenti | Disattivazione immediata, cancellazione dopo 30 giorni (parametro `deactivatedPurgeDays`) | Job alle 04:00 |
| Account cancellato dall'utente | Immediata | `DELETE /api/me` |
| Viaggi (con partecipazioni, inviti, gruppi fissi; le serie senza più date e terminate con percorso e chat) | 12 mesi dalla data del viaggio (parametro `tripRetentionMonths`). Restano i fatti anonimi `TripStatFact` e le statistiche personali dell'interessato | Job alle 03:45 |
| Inviti scaduti, revocati, rifiutati o usati | 30 giorni (parametro `inviteRetentionDays`) | Job alle 03:45 |
| Sessioni scadute; contatori anti brute-force inattivi da 48 ore | Alla scadenza | Job alle 03:45 |
| Audit log | 24 mesi (parametro `auditRetentionMonths`, minimo 6 imposto dal database) [DA CONFERMARE]. Le righe si cancellano solo con la funzione `audit_log_purge` (SECURITY DEFINER): in produzione l'utente DB dell'app ha INSERT e SELECT sulla tabella ed EXECUTE sulla funzione. Si cancella un blocco contiguo dall'inizio e si registra l'hash dell'ultima riga eliminata, da cui riparte la verifica della catena | Job alle 03:45 |
| Log tecnici dell'applicazione | **6 mesi**: escono su stdout senza dati personali in chiaro; la conservazione è a carico del sistema che li raccoglie (journald, rotazione dei file; vedi [docs/produzione.md](../produzione.md)) | Infrastruttura |

Ogni esecuzione del job registra nell'audit log (`RETENTION_RUN`) solo i conteggi delle righe cancellate.

**Cosa avviene alla cancellazione definitiva di un account:**
- si cancellano utente, consensi e storico, ruoli, sessioni, push, email, partecipazioni, inviti, preferiti, statistiche personali, contatori di login, messaggi chat inviati e viaggi proposti (con le relative chat);
- si cancellano le segnalazioni **ricevute**; quelle **inviate** restano agli admin senza il segnalante;
- restano i `TripStatFact`, che non contengono identificativi di persona e perdono anche il collegamento al viaggio;
- resta l'audit log, che contiene l'UUID dell'account e nessun altro dato che permetta di risalire alla persona dopo la cancellazione.

**Anonimizzazione delle statistiche.** Ogni `TripStatFact` contiene:
- sede, data e visibilità;
- posti e passeggeri presenti;
- km, CO2, carburante ed euro.

Non contiene comuni né persone. Rischio residuo: in una sede piccola, con pochi viaggi in un giorno, chi conosce chi ha viaggiato quel giorno potrebbe ricondurre il fatto a quelle persone. La dashboard però mostra solo **totali su un periodo**, mai i singoli fatti. Valutare una soglia minima di pubblicazione per i report destinati all'esterno (par. 12).

## 5. Diritti dell'interessato (implementazione)
| Diritto | Dove |
|---|---|
| Accesso e portabilità (artt. 15, 20) | *Profilo → I miei dati*: consultazione per sezioni e download JSON (`GET /api/me/data`). L'operazione è registrata (`USER_DATA_EXPORT`) |
| Rettifica (art. 16) | *Profilo*. Nome e cognome provengono dal sistema aziendale |
| Cancellazione (art. 17) | *I miei dati → Cancella l'account*: un passaggio con conferma, effetto immediato |
| Revoca del consenso (art. 7.3) | Interruttori nel *Profilo*. Ogni modifica è storicizzata in `ConsentEvent` |
| Opposizione e limitazione | Tramite il DPO (non self-service) |

Scelte nell'esportazione:
- **Dati di colleghi:** compaiono solo quelli già noti all'utente nell'app, cioè il conducente dei viaggi fatti, i preferiti e le persone che ha segnalato.
- **Segnalazioni ricevute:** non indicano il segnalante né la nota dell'admin (art. 15.4).
- **Dati tecnici:** nessun token, hash o chiave.

## 6. Area amministrativa e minimizzazione
**Ruoli:**
- **admin di sede:** dashboard, elenco viaggi e segnalazioni della propria sede;
- **admin globale:** tutte le sedi, più parametri, ruoli, sedi, testi legali e audit log.

Il primo admin globale è indicato dalla variabile `INITIAL_GLOBAL_ADMIN`. Deve sempre restarne almeno uno.

**Minimizzazione:**
- **Elenco viaggi:** data, orari, sede, visibilità, stato, posti, presenti e numero di comuni. **Non mostra nomi né comuni.**
- **Dashboard:** solo totali (utenti registrati e attivi, viaggi, riempimento, risparmi).
- **Segnalazioni:**
  - nell'elenco compaiono nomi di segnalato e segnalante, ma non la motivazione;
  - la motivazione si legge aprendo la singola segnalazione, e l'apertura è registrata;
  - è indicato il numero di segnalazioni ricevute dalla stessa persona nel periodo di conservazione;
  - nessuna conseguenza automatica.
- **Ricerca utenti per assegnare ruoli:** è registrata, ma senza il testo cercato.

**Registrazione degli accessi.** Ogni accesso e ogni modifica finiscono nell'audit log: `ADMIN_*` per le azioni admin, `USER_*` per l'interessato, `EMPLOYEE_CHECK_RUN` per il job notturno. Il registro **non contiene dati in chiaro**: niente nomi, testi o filtri con nomi.

## 7. Credenziali Active Directory
- **Unico punto di contatto con la password:** username e password arrivano solo a `POST /api/auth/login` (HTTPS) e sono inoltrati **solo** all'API aziendale di autenticazione. L'adapter rifiuta indirizzi `http:`.
- **La password non:**
  - viene salvata;
  - finisce in cache, code o sessione;
  - compare nei log (il corpo della richiesta di login non viene mai registrato; redazione dei campi `password`);
  - compare nei messaggi d'errore o nelle tracce.

  I test automatici lo verificano, anche con l'API aziendale in errore o in timeout.
- **Anti brute-force:**
  - limiti per username (3 errori) e per IP (20 errori);
  - blocco temporaneo di 15 minuti, che si toglie da solo;
  - il controllo avviene **prima** di contattare AD, così nessuno può far bloccare l'account AD di un collega;
  - risposte d'errore generiche e tempo di risposta uniforme.
- **Dopo il login:**
  - sessione dell'app con cookie `__Host-sid` (httpOnly, Secure, SameSite=Lax), token casuale di cui si salva solo l'hash;
  - protezione CSRF con double-submit;
  - durata massima 14 giorni, inattività massima 7 giorni.
- **Dipendenti usciti:**
  - modalità `session-expiry`: nuovo login obbligatorio alla scadenza della sessione;
  - modalità `nightly`: verifica notturna senza password tramite l'API aziendale;
  - modalità `both`: entrambe.
- **Protezioni della verifica notturna:**
  - un errore su un utente non lo disattiva mai;
  - se più del 10% degli utenti (e almeno 6) risulta non attivo nella stessa notte, nessuno viene disattivato e l'anomalia viene registrata.

## 8. Misure di sicurezza (art. 32)
- **Trasporto:**
  - HTTPS obbligatorio in produzione;
  - HSTS e header di sicurezza al reverse proxy;
  - nell'app, CSP restrittiva (`default-src 'self'`) e niente risorse esterne: font e icone sono ospitati in locale.
- **Dati a riposo:**
  - AES-256-GCM applicativo per telefono, email, chat e segnalazioni;
  - chiavi versionate (`DATA_ENCRYPTION_KEYS`) per la rotazione;
  - raccomandata in aggiunta la cifratura del disco della VM.
- **Pseudonimizzazione:**
  - negli identificativi dei log: HMAC con chiave separata;
  - log senza corpi delle richieste, cookie, query string, nomi, email né testi.
- **Integrità dell'audit log:**
  - trigger PostgreSQL che vietano UPDATE, DELETE e TRUNCATE;
  - catena di hash SHA-256 verificabile dall'area admin ("Verifica integrità").

  **In produzione** l'utente DB dell'applicazione deve avere sulla tabella solo inserimento e lettura:
  ```sql
  REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM <utente_app>;
  GRANT INSERT, SELECT ON "AuditLog" TO <utente_app>;
  ```
  Le migrazioni vanno eseguite con un utente diverso, proprietario dello schema.
- **Controllo degli accessi:**
  - regole sui viaggi centralizzate in un unico componente, `TripAccessPolicy`;
  - viaggi privati invisibili agli estranei (404);
  - ruoli admin riletti dal DB a ogni richiesta, quindi la revoca ha effetto immediato.
- **Validazione:**
  - tutti gli input sono validati con schemi condivisi;
  - query parametrizzate (Prisma);
  - rate limiting sul login.
- **Notifiche:**
  - payload push cifrati end-to-end (RFC 8291) con testo generico;
  - email con testo generico;
  - la chat non viene mai inviata via email.
- **Terze parti:**
  - nessuna telemetria, analytics o tracker;
  - nessuna integrazione Microsoft;
  - servizi esterni elencati in `PRIVACY.md`.
- **Segreti:** solo in variabili d'ambiente. L'app non si avvia se mancano o non sono validi.

## 9. Distanze e statistiche
**Distanze.** Sono calcolate **solo tra un punto del territorio comunale e la sede**, cioè tra dati pubblici, e sono salvate in `DistanceCache`.
- Il punto del comune è un punto interno al territorio (*point on surface*), ricavato dai confini comunali **ISTAT** (licenza CC BY 4.0).
- Attribuzione "Fonte: ISTAT": nella pagina "Privacy e termini", nei termini d'uso (par. 10), nelle note di statistiche e dashboard e nel file dei dati.
- Modalità adottata: stima in linea d'aria × coefficiente stradale (1,3, configurabile). **Nessun servizio esterno**.
- Un eventuale OSRM self-hosted riceverebbe solo le stesse coordinate pubbliche.

**Consumi, emissioni e prezzi.** I valori sono **indicativi** e configurabili dagli admin globali. Fonti di riferimento indicate per l'aggiornamento:
- **ISPRA** per i fattori di emissione di CO2 dei carburanti e dell'energia elettrica e per i consumi medi del parco auto;
- **prezzi medi dei carburanti pubblicati dal Ministero delle Imprese e del Made in Italy**.

Regole di calcolo, fonti e procedura di aggiornamento dei dati ISTAT sono in [docs/distanze.md](../distanze.md).

## 10. Job automatici
| Ora (Europe/Rome) | Job |
|---|---|
| 02:30 | Verifica dipendenti (solo `EMPLOYEE_CHECK_MODE=nightly` o `both`) |
| 03:15 | Cancellazione dei messaggi chat scaduti |
| 03:20 | Cancellazione delle verifiche email non completate |
| 03:30 | Cancellazione delle segnalazioni scadute |
| 04:00 | Cancellazione definitiva degli ex dipendenti oltre il periodo di attesa |

## 11. Elementi per la DPIA
Una DPIA è **consigliata**. Motivi:
- gli interessati sono dipendenti, cioè soggetti in posizione di squilibrio (linee guida WP248: criterio "interessati vulnerabili");
- i dati sugli spostamenti casa-lavoro sono trattati in modo sistematico, anche se senza geolocalizzazione;
- le segnalazioni riguardano il comportamento delle persone.

**Misure che riducono il rischio:**
- uso volontario;
- nessuna posizione GPS né indirizzo;
- dashboard solo aggregata;
- segnalazioni senza conseguenze automatiche e con conservazione limitata;
- cifratura dei dati sensibili;
- audit log immutabile;
- cancellazione self-service.

## 12. Elenco unico: scelte da validare e punti aperti
Questo è l'**unico elenco** delle questioni per il DPO: l'informativa rimanda qui.

### A. Scelte già implementate, in attesa di validazione
L'app funziona oggi così. Se il DPO decide diversamente, la modifica è puntuale.

| # | Scelta | Motivazione / alternativa | Dove |
|---|---|---|---|
| A1 | **Email obbligatoria** per le notifiche essenziali (viaggio annullato, cambio di orario, richiesta accettata/rifiutata, partecipazione annullata dal conducente, invito, disattivazione), **senza consenso**, base art. 6.1.b | Le push dipendono dal dispositivo; il consenso in ambito lavorativo è di dubbia libertà (EDPB 05/2020). Alternativa: art. 6.1.f con bilanciamento documentato | Informativa par. 5-bis; `NOTIFICATION_CATEGORY` |
| A2 | Consenso usato **solo** per funzioni realmente facoltative: telefono visibile, trovabilità, notifiche facoltative | Linee guida EDPB 05/2020 sul consenso dei dipendenti | Informativa par. 5 |
| A3 | **Indirizzo email personale ammesso**, a scelta dell'utente | Non tutti hanno la posta aziendale sul telefono. Il messaggio passa per il fornitore di posta scelto dall'utente, eventualmente extra UE: valutare se segnalarlo nei termini o limitarlo | Informativa par. 4 e 6 |
| A4 | **Avviso di disattivazione all'ex dipendente**: un solo invio, generico, prima della cancellazione di email e push | Base 6.1.b (ultima comunicazione del servizio) oppure 6.1.f | Informativa par. 5-bis |
| A5 | Consenso ridefinito ("notifiche via email" → "notifiche facoltative"): **consensi precedenti azzerati** | Finalità diversa, art. 7 | Migrazione `optional_notifications_consent` |
| A6 | **Statistiche aggregate PSCL**: base art. 6.1.c (D.L. 34/2020 art. 229 c. 4, D.I. 179/2021) e/o 6.1.f | Da verificare rispetto agli obblighi PSCL effettivi dell'azienda | Informativa par. 5, finalità d) |
| A7 | **Esportazione**: le segnalazioni ricevute compaiono con data, motivazione e stato, ma **senza il segnalante e senza la nota interna dell'admin** | Art. 15 par. 4 (diritti e libertà altrui) | Par. 5 |
| A8 | **Esportazione**: dei colleghi compaiono solo i nomi già noti all'utente (conducente dei viaggi fatti, preferiti, persone segnalate) | Minimizzazione; i dati sono già noti all'interessato | Par. 5 |
| A9 | **Segnalazioni**: la persona segnalata **non riceve un avviso individuale**; l'informativa indica che i dati possono essere inseriti da altri partecipanti | Art. 14. Alternativa: avviso generico ("hai ricevuto una segnalazione, esaminata da un admin") | Informativa par. 4 |
| A10 | **Segnalazioni**: all'admin che ne esamina una è mostrato **quante segnalazioni ha ricevuto la stessa persona** nel periodo di conservazione (12 mesi) | Contesto per una decisione umana; nessun automatismo. Alternativa: non mostrarlo | Par. 6 |
| A11 | **Ex dipendenti**: **30 giorni** tra disattivazione e cancellazione definitiva (parametro) | Permette di correggere errori del sistema aziendale o riassunzioni; nel frattempo email, sessioni e push sono già cancellate | Par. 4 |
| A12 | **Audit log**: conserva l'**UUID** dell'account anche dopo la cancellazione, senza altri dati che consentano di risalire alla persona | Integrità del registro (catena di hash) e accountability | Par. 4 e 8 |
| A13 | **Ricerca utenti degli admin** (assegnazione ruoli): registrata senza il testo cercato | Evita nomi nell'audit log | Par. 6 |
| A14 | **"Si è liberato un posto"** (lista d'attesa) classificata come notifica **essenziale**: push ed email senza consenso | L'utente si è messo in lista d'attesa proprio per ricevere questo avviso: è il servizio richiesto (art. 6.1.b). Alternativa: notifica facoltativa, che però chi non ha dato il consenso non riceverebbe | Informativa par. 5-bis; `NOTIFICATION_CATEGORY` |

### B. Punti aperti da decidere o compilare
| # | Punto |
|---|---|
| B1 | **Servizi push dei browser** (Google, Apple, Mozilla): contenuto cifrato e generico, ma l'endpoint del dispositivo è un identificativo, con possibile trasferimento extra UE (informativa par. 6, "[DA VERIFICARE]") |
| B2 | **Conservazione**: audit log (24 mesi), viaggi conclusi (12 mesi), inviti (30 giorni) sono i valori predefiniti, già applicati dal job notturno e modificabili dagli admin. Da confermare. Log tecnici: **6 mesi** (decisione del titolare), da configurare sul server ([docs/produzione.md](../produzione.md)) |
| B3 | **Soglia minima** per i report esportati (CSV/Excel, una riga per sede e mese): sotto 5 viaggi completati (parametro `exportMinTrips`) passeggeri, km, emissioni, carburante e spesa non si pubblicano; restano i conteggi dei viaggi. Niente righe di totale, che permetterebbero di ricavare i valori nascosti. Valore **confermato dal titolare**, da validare |
| B4 | **Dati del Titolare e del DPO**; nomina dei responsabili del trattamento (gestore della VM, servizio SMTP) |
| B5 | **DPIA**: consigliata (par. 11) |
| B6 | Termini d'uso: assicurazione, rimborso spese tra colleghi, misure di moderazione (parti "[DA COMPILARE]") |

### C. Decisioni già prese, per traccia
| # | Decisione | Data |
|---|---|---|
| C1 | Coordinate dei comuni da **confini ISTAT** (CC BY 4.0), punto interno al territorio, con attribuzione "Fonte: ISTAT" | 17/11/2026 |
| C2 | Distanze **stimate** in linea d'aria × 1,3 (configurabile), senza servizi di routing | 17/11/2026 |
| C3 | Valori di consumi, emissioni e prezzi **indicativi**, con fonti di riferimento ISPRA e Ministero delle Imprese e del Made in Italy | 17/11/2026 |
| C4 | Classificazione delle notifiche (essenziali / operative / facoltative) approvata dal committente | 13/11/2026 |
| C5 | Comune soppresso per **fusione o incorporazione**: il comune del profilo (e quello di sedi e viaggi) viene aggiornato d'ufficio al comune risultante, per esattezza dei dati (art. 5.1.d). L'utente vede un avviso al successivo accesso e può scegliere un altro comune. Per le sole ricodifiche (cambia il codice, non il nome) nessun avviso | 17/11/2026 |
