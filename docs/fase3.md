# Fase 3: come funziona

## Viaggi ricorrenti e gruppo fisso
- **Creazione.** In "Proponi un viaggio" si attiva "Si ripete ogni settimana", si scelgono i giorni e, se serve, una data di fine. Senza data di fine la serie continua finché il conducente non la termina (massimo un anno se la fine è indicata).
- **Date.** Si generano fino a 28 giorni in avanti (parametro `recurringHorizonDays`). Ogni notte alle 00:10 il job `series-extend` aggiunge le successive. Ogni data è un viaggio a sé, con posti, chiusura e statistiche propri. In home compare solo la prossima data; le altre sono nel dettaglio, sezione "Prossime date".
- **Gruppo fisso.** Si entra con un invito "Gruppo fisso (tutte le date)", personale o con link (scelta predefinita per i viaggi ricorrenti). Il membro:
  - è confermato in tutte le date future, nell'ordine di ingresso nel gruppo, finché ci sono posti; nelle altre date è in lista d'attesa;
  - vede tutte le date della serie, anche se privata, e la chat della serie.
- **"Non ci sono".** Il membro lo indica per una singola data (anche il pulsante "Annulla" fa lo stesso), e il posto si libera:
  - il primo membro in lista d'attesa entra subito;
  - il conducente riceve un avviso e può **rendere pubblica solo quella data**, così un collega qualsiasi può chiedere il posto;
  - le altre date restano private;
  - oltre la scadenza per annullare, il "non ci sono" è segnalabile come cancellazione tardiva, come un normale annullamento.

  Con "Ci sono" il membro torna disponibile: confermato se il posto è ancora libero, altrimenti in lista d'attesa.
- **Uscita.** Il membro può uscire dal gruppo, oppure il conducente può toglierlo. Le sue partecipazioni future si annullano.
- **Fine della serie.** Il conducente può annullare una sola data o terminare il viaggio ricorrente: tutte le date future vengono annullate, con un solo avviso a ciascun partecipante.

## Lista d'attesa
- Se un viaggio pubblico è al completo, il collega può mettersi in lista d'attesa invece di chiedere il posto.
- Quando un posto si libera (annullamento, rimozione, "non ci sono", uscita dal gruppo, disattivazione di un account):
  1. i membri fissi in attesa entrano subito;
  2. se restano posti, gli altri in lista d'attesa ricevono l'avviso "Si è liberato un posto" (notifica essenziale: push ed email) e possono chiederlo con un tocco.
- Il conducente vede la lista d'attesa in ordine di arrivo e può anche accettare direttamente.
- Se il viaggio (o la data) diventa privato, la lista d'attesa esterna viene rifiutata; quella dei membri fissi resta.

## Promemoria (facoltativi)
Arrivano solo a chi ha dato il consenso alle notifiche facoltative, e vanno al conducente e ai partecipanti confermati. Il job `trip-reminders` gira ogni 5 minuti e invia ogni promemoria una sola volta.
- **Sera prima:** dalle 20:00 (parametro `reminderEveningHour`).
- **Prima della salita:** 60 minuti prima (parametro `reminderBeforeDepartureMinutes`):
  - per il conducente, prima dell'orario di partenza;
  - per ogni passeggero, prima dell'orario stimato di passaggio dal suo comune di salita.
- Un viaggio creato, o una partecipazione accettata, dopo il momento del promemoria non lo riceve.

## Orario di partenza e orari di passaggio
- **Partenza proposta:** nel modulo di proposta l'app calcola la partenza come arrivo in ufficio − tempo di guida dal comune di partenza alla sede, arrotondata per difetto ai 5 minuti. Il conducente può cambiarla, purché resti prima dell'arrivo.
- **Tempo di guida:** distanza stradale (o stimata in linea d'aria) divisa per 45 km/h, arrotondata ai 5 minuti; senza coordinate si ipotizzano 45 minuti. Esempio: Bergamo → Milano circa 55 km = 75 minuti, quindi con arrivo alle 08:30 la partenza proposta è alle 07:15.
- **Comuni di passaggio:** hanno un orario stimato ("circa 7:35"), ricavato dalla loro distanza dalla sede e adattato al tempo che il conducente si è dato tra partenza e arrivo. Gli orari si calcolano alla proposta e valgono per tutte le date di una serie.
- **Dove compaiono:** nel modulo, nel dettaglio del viaggio, nella scelta del comune di salita e accanto ai partecipanti.
- **Viaggi creati prima di questa funzione:** non hanno orari di passaggio; i promemoria usano la partenza stimata.

## Report per il PSCL (CSV ed Excel)
Si scaricano dalla dashboard dell'area amministrativa ("Excel", "CSV"), con gli stessi filtri di sede e periodo. Gli admin di sede possono scaricare solo la propria sede, e ogni esportazione è registrata nell'audit log.
- **Righe:** una per sede e mese. Contengono:
  - viaggi proposti (pubblici e privati), completati e annullati;
  - posti offerti, passeggeri e tasso di riempimento;
  - km evitati, CO2, carburante per unità (L, kg, kWh) e spesa evitata;
  - quanti viaggi hanno distanze stimate o non hanno metriche.
- **Soglia minima:** nelle righe con meno di 5 viaggi completati (parametro `exportMinTrips`) i valori su persone, km ed emissioni restano vuoti, con una nota. Non ci sono righe di totale, che permetterebbero di ricavarli per differenza.
- **Note:** periodo, data di generazione, metodo di calcolo, fonti dei parametri e "Fonte: ISTAT, licenza CC BY 4.0". Nel CSV stanno in fondo al file; nell'Excel sono nel foglio "Note".
- **Formato CSV:** separatore `;`, virgola decimale e BOM UTF-8, quindi si apre direttamente in Excel in italiano. I testi che iniziano con `=`, `+`, `-` o `@` sono neutralizzati contro l'esecuzione di formule.
- **Formato Excel:** il file `.xlsx` è generato dall'app senza librerie esterne (`apps/api/src/common/xlsx.ts`).

## Conservazione automatica
Il job `retention` gira ogni notte alle 03:45. Le regole e le basi sono nel [documento per il DPO](dpo/documento-tecnico.md), par. 4.

| Dato | Default | Parametro |
|---|---|---|
| Viaggi conclusi (con partecipazioni, inviti; serie terminate senza più date, con chat e gruppo) | 12 mesi dalla data | `tripRetentionMonths` |
| Inviti scaduti, revocati, rifiutati o usati | 30 giorni | `inviteRetentionDays` |
| Sessioni scadute, contatori anti brute-force inattivi | alla scadenza / 48 ore | — |
| Audit log | 24 mesi (minimo 6) | `auditRetentionMonths` |

Altri dati hanno già un job dedicato dalla Fase 2:
- chat: 30 giorni, alle 03:15;
- segnalazioni: 12 mesi, alle 03:30;
- verifiche email non completate: 24 ore, alle 03:20;
- ex dipendenti: dopo 30 giorni, alle 04:00.

I log tecnici escono su stdout senza dati personali in chiaro e si conservano 6 mesi, impostati sul server ([produzione.md](produzione.md)).

**Audit log in produzione.** L'utente DB dell'applicazione deve avere, sulla tabella `AuditLog`, solo `INSERT` e `SELECT`, più `EXECUTE` sulla funzione `audit_log_purge`. La funzione è di proprietà dell'utente che esegue le migrazioni.
