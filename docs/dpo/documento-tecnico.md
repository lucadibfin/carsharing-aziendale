# Documento tecnico per il DPO — App Car Sharing tra colleghi

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
| Sede, comune di residenza (no indirizzo) | `User` | — | Interessato; il comune **non** è mostrato ad altri (si vede solo il comune di salita scelto per un viaggio) |
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
| Viaggi conclusi, link scaduti, sessioni scadute, log | **Fase 3** (retention automatica completa) | — |
| Audit log | [DA DEFINIRE, proposta 24 mesi]: la cancellazione per scadenza sarà eseguita da un ruolo DB dedicato (Fase 3) | — |

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
Le distanze sono calcolate **solo tra centro del comune e sede**:
- sono dati pubblici, salvati in `DistanceCache`;
- con OSRM self-hosted, OSRM riceve solo quelle coordinate;
- senza OSRM la distanza è stimata in linea d'aria × 1,3.

Regole di calcolo e fattori di emissione sono in [docs/distanze.md](../distanze.md). I fattori iniziali sono indicativi e vanno verificati dal Mobility Manager.

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

## 12. Punti aperti per il DPO
1. Basi giuridiche proposte, soprattutto per le notifiche essenziali via email e per le statistiche PSCL (informativa, par. 5 e note).
2. Email personale degli utenti: fornitore di posta scelto dall'utente, eventualmente extra UE.
3. Servizi push dei browser (Google, Apple, Mozilla): il contenuto è cifrato e generico, ma l'endpoint del dispositivo è un identificativo, con possibile trasferimento extra UE.
4. Segnalazioni:
   - nessun avviso individuale al segnalato (art. 14);
   - nell'esportazione non compare il segnalante;
   - all'admin è mostrato il numero di segnalazioni ricevute dalla stessa persona.
5. Periodo di 30 giorni prima della cancellazione definitiva degli ex dipendenti.
6. Conservazione dell'audit log, che contiene l'UUID anche dopo la cancellazione dell'account, e dei log tecnici.
7. Soglia minima (k-anonimato) per i report aggregati esportati verso l'esterno: export CSV/Excel in Fase 3.
8. Fonte e licenza delle coordinate dei comuni: ISTAT (CC BY 4.0) oppure OpenStreetMap (ODbL, con attribuzione).
9. Dati del Titolare e del DPO, e responsabili del trattamento (gestore della VM, SMTP).
