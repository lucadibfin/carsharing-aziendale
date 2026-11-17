# Distanze e statistiche

Le statistiche usano solo distanze **tra un punto del territorio di un comune e una sede aziendale**. Non si usano mai indirizzi o posizioni degli utenti. Ogni distanza è calcolata una volta e salvata nella tabella `DistanceCache`.

## Calcolo
| Voce | Regola |
|---|---|
| Km del passeggero (evitati) | distanza comune di salita → sede, × 2 se il viaggio prevede il ritorno |
| Km del conducente | distanza comune di partenza → sede (× 2 con il ritorno); contano come "condivisi" solo se c'era almeno un passeggero presente |
| Carburante risparmiato | km evitati × consumo / 100 |
| CO2 risparmiata | carburante × fattore di emissione dell'alimentazione |
| Euro risparmiati | carburante × prezzo |

**Auto di riferimento.** Si usano alimentazione e consumo indicati dal conducente nel profilo. Se mancano, valgono l'alimentazione di default e i valori medi dei parametri (area admin → Parametri).

**Chiusura del viaggio.** I calcoli avvengono quando il conducente chiude il viaggio e conferma i presenti. Producono due tipi di dato:
- **dato anonimo** (`TripStatFact`): una riga per viaggio, usata dalla dashboard aggregata. Non contiene identificativi di utenti e resta anche dopo la cancellazione degli account.
- **statistiche personali** (`UserStatEntry`): una riga per persona presente, visibile solo all'interessato. Si cancellano con l'account.

## Consumi, emissioni e prezzi
I valori iniziali sono in `packages/shared/src/settings.ts` e si modificano dall'area admin (Parametri). Sono **indicativi**: prima di usare i report nel PSCL vanno sostituiti con valori aggiornati, scelti dal Mobility Manager.

| Parametro | Fonte di riferimento | Cosa prendere |
|---|---|---|
| CO2 per unità di carburante (kg/L, kg/kg) | **ISPRA**: tabella dei parametri standard nazionali usata nell'inventario delle emissioni di gas serra (coefficienti di emissione e potere calorifico per combustibile) | kg di CO2 per litro di benzina, gasolio e GPL e per kg di metano |
| CO2 per kWh (auto elettriche) | **ISPRA**: rapporto sui fattori di emissione per la produzione e il consumo di energia elettrica in Italia | Fattore dei consumi elettrici dell'ultimo anno disponibile |
| Consumo medio per alimentazione | **ISPRA**: banca dati dei fattori di emissione medi del trasporto stradale (parco circolante italiano) | Consumi medi delle autovetture per alimentazione, ciclo urbano/extraurbano a scelta |
| Prezzo dei carburanti (€/L, €/kg) | **Ministero delle Imprese e del Made in Italy**: prezzi medi dei carburanti pubblicati periodicamente (rilevazioni dei prezzi praticati) | Media del periodo del report (es. media annuale dei prezzi settimanali) per benzina, gasolio, GPL e metano |
| Prezzo dell'energia elettrica (€/kWh) | Nessuna fonte ministeriale equivalente: da concordare con il Mobility Manager (es. tariffe di ricarica pubblica o dati ARERA) | — |

Per i report destinati all'esterno conviene annotare la fonte e l'anno di ogni valore usato.

## Fonte delle distanze
`ROUTING_PROVIDER` nel `.env` dell'API:

- **`estimate`** (default, scelta attuale): distanza in linea d'aria tra il punto del comune e la sede × coefficiente stradale.
  - Il coefficiente vale 1,3 di default e si modifica dall'area admin (Parametri). Cambiandolo, le distanze stimate vengono ricalcolate.
  - Non serve nessun servizio. Le distanze sono marcate come "stimate".
- **`osrm`** (eventuale evoluzione): distanza stradale reale calcolata da [OSRM](https://project-osrm.org/) (licenza BSD-2), installato sull'infrastruttura aziendale.
  - Indirizzo del servizio: `OSRM_URL`, es. `http://127.0.0.1:5000`.
  - Riceve solo le coordinate del comune e della sede.
  - Se non risponde entro `ROUTING_TIMEOUT_MS`, si usa la stima. La stima viene ricalcolata con OSRM al massimo una volta al giorno.

### Installare OSRM (server Linux, se in futuro servirà)
1. Scaricare l'estratto OpenStreetMap dell'Italia (circa 2 GB), es. da Geofabrik: `italy-latest.osm.pbf`.
   - Licenza dei dati: ODbL. Va aggiunta l'attribuzione "© OpenStreetMap contributors" accanto a "Fonte: ISTAT".
2. Preparare i dati con il profilo auto. Servono circa 8 GB di RAM solo durante questa fase, che si può eseguire anche su un'altra macchina copiando poi i file `.osrm*`:
   ```bash
   osrm-extract -p /usr/share/osrm/profiles/car.lua italy-latest.osm.pbf
   osrm-partition italy-latest.osrm
   osrm-customize italy-latest.osrm
   ```
3. Avviare il servizio solo sulla rete interna:
   ```bash
   osrm-routed --algorithm mld --ip 127.0.0.1 --port 5000 italy-latest.osrm
   ```
   In esercizio servono circa 1–2 GB di RAM.
4. Nel `.env` dell'API: `ROUTING_PROVIDER=osrm` e `OSRM_URL=http://127.0.0.1:5000`.

## Coordinate dei comuni (Fonte: ISTAT)
L'elenco ISTAT dei comuni non contiene coordinate. Si ricavano dai **confini comunali ISTAT** (licenza CC BY 4.0):
- per ogni comune si calcola un **punto interno al territorio** (*point on surface*, come `ST_PointOnSurface` di PostGIS);
- non si usa il baricentro, che per comuni a forma irregolare, con exclavi o con enclavi di altri comuni può cadere fuori dal territorio.

Il risultato è `apps/api/prisma/data/comuni-coordinate.csv`:
- è versionato nel repository e caricato dal seed;
- le prime righe riportano fonte, data dei confini e licenza.

### Prima generazione
1. Scaricare da ISTAT i **"Confini delle unità amministrative a fini statistici"** al 1° gennaio dell'anno, versione **generalizzata**, sistema **WGS84 UTM 32N**.
   - Dallo zip servono i file del livello comuni, es. `Com01012025_g_WGS84.shp` con `.dbf`, `.prj` e `.shx` nella stessa cartella.
   - Non servono altri software: lo script legge direttamente lo shapefile. In alternativa accetta un GeoJSON.
2. Dalla radice del repository:
   ```powershell
   npm run coords:istat -w api -- percorso\Com01012025_g_WGS84.shp
   ```
   Lo script:
   - riconosce il sistema di riferimento dal file `.prj`: accetta UTM nord WGS84/ETRS89/RDN2008 oppure gradi, e rifiuta ED50 e Monte Mario;
   - unisce le parti di uno stesso comune, calcola il punto e verifica che sia dentro il territorio;
   - lo converte in latitudine e longitudine e scrive il CSV;
   - confronta il risultato con l'elenco dei comuni dell'app e segnala i comuni senza confini e i codici sconosciuti.
3. Caricare nel database: `npm run db:seed -w api`.
   - Si aggiornano solo i comuni il cui punto è cambiato.
   - Per quei comuni si cancellano le distanze già calcolate.
4. Committare `comuni-coordinate.csv`. Gli altri ambienti lo ricevono con il deploy e il seed.

### Elenco e confini: date diverse
L'elenco dei comuni e i confini **possono avere date diverse**, e di norma è così:
- l'**elenco** si prende **aggiornato a oggi** da SITUAS (situas.istat.it), così l'app propone i comuni che esistono davvero;
- i **confini** sono pubblicati solo **al 1° gennaio** di ogni anno.

I comuni cambiati nel frattempo sono gestiti così:

| Caso | Esempio | Come viene gestito |
|---|---|---|
| **Ricodifica** (stesso comune, codice nuovo) | Comuni sardi dopo la riorganizzazione delle province | Riconosciuta da `comuni:istat` (stesso codice catastale o stessa denominazione nella stessa regione) e registrata in `comuni-ricodifiche.csv`. Il seed sposta profili, sedi, tappe e comuni di salita sul nuovo codice ed elimina il vecchio |
| **Fusione** dopo la data dei confini | Castegnero + Nanto → Castegnero Nanto (2026) | Registrata in `comuni-variazioni.csv` (tipo `FUSIONE`) con i codici d'origine. `comuni:istat` la riconosce da solo quando il nome nuovo è composto dai nomi dei comuni spariti della stessa provincia; altrimenti la segnala con i possibili comuni d'origine. `coords:istat` calcola il **punto interno all'unione dei territori d'origine** presenti nei confini |
| **Distacco** di territorio (comune nuovo ricavato da uno esistente) | — | `coords:istat` lo segnala come "senza coordinate" con una proposta. Si aggiunge a mano una riga `APPROSSIMATO` con il comune d'origine: le coordinate sono quelle del comune d'origine, una stima da sostituire quando i confini dell'anno dopo includeranno il comune nuovo |
| **Incorporazione** in un comune esistente | Lirio (PV), sparito nel 2026 | Il comune che incorpora mantiene il suo codice e il suo punto, che resta dentro il territorio allargato. Il comune incorporato resta nel database come **non selezionabile**, con le sue coordinate, per i viaggi e i profili esistenti |
| **Cambio di nome** | Vallecrosia → Vallecrosia al mare | Il seed aggiorna il nome |

I comuni d'origine di fusioni e incorporazioni restano nel database come non selezionabili, con le loro coordinate. Profili e viaggi che li usano restano validi; l'utente può scegliere il nuovo comune dal profilo.

Formato di `comuni-variazioni.csv` (le righe si possono correggere a mano: gli script non le riscrivono):
```
codice;nome;tipo;origini;rilevato_al;nota
024129;Castegnero Nanto;FUSIONE;024027+024071;17/11/2026;fusione di Castegnero e Nanto
```

### Aggiornamento dell'elenco (procedura)
Una volta l'anno quando escono i nuovi confini, oppure quando una variazione riguarda i comuni delle sedi:

1. **Elenco**: da SITUAS, estrazione in CSV dell'elenco dei comuni **vigenti alla data di oggi** (file tipo `situas.csv`).
   - Il file non contiene la data: è quella dell'estrazione, da indicare con `--al`.
   - È accettato anche l'"Elenco comuni italiani" del sito ISTAT. Lo script riconosce le colonne di entrambi i formati.
2. **Confini**: gli ultimi pubblicati, al 1° gennaio, versione generalizzata WGS84 UTM 32N.
3. Prova a secco, che mostra cosa cambierebbe senza scrivere nulla:
   ```bash
   npm run comuni:istat -w api -- percorso/situas.csv --al GG/MM/AAAA --dry-run
   ```
4. Aggiornamento dell'elenco (stesso comando senza `--dry-run`). Riscrive `comuni.csv` e aggiunge ricodifiche e fusioni riconosciute ai due registri.
5. Coordinate: `npm run coords:istat -w api -- percorso/ComGGMMAAAA_g_WGS84.shp`.
   - Deve chiudersi con **"Comuni dell'elenco senza coordinate: 0"**.
   - Se resta qualche comune, lo script lo elenca con una proposta. Si completa `comuni-variazioni.csv` e si ripete.
6. `npm run db:seed`, che applica ricodifiche, nuovi comuni, nomi e coordinate.
7. Committare insieme `comuni.csv`, `comuni-ricodifiche.csv`, `comuni-variazioni.csv` e `comuni-coordinate.csv`.

Quando escono i confini dell'anno successivo, i comuni nati da fusione o distacco vi compaiono con il proprio poligono. `coords:istat` usa allora direttamente quello e le righe di `comuni-variazioni.csv` non servono più per quei comuni. Possono restare come storico.

**Altri file.** Per coordinate da altre fonti resta `npm run db:import-coords -w api -- file.csv` (formato `istat;lat;lon`), che però non aggiorna il CSV versionato.

**Comuni senza coordinate.** Non bloccano nulla: il viaggio conta comunque nelle statistiche, ma senza km né risparmi, e nella dashboard risulta "incompleto". Finché `comuni-coordinate.csv` non esiste, il seed di sviluppo imposta coordinate approssimative solo per Milano, Monza, Sesto San Giovanni, Bergamo, Roma e Torino.

**Attribuzione.** "Fonte: ISTAT" e la licenza compaiono:
- nella pagina "Privacy e termini" (sezione "Fonti dei dati");
- nelle note delle statistiche personali e della dashboard admin;
- nelle prime righe del CSV;
- in `apps/api/prisma/data/LEGGIMI.md`.

Andrà riportata anche negli export CSV/Excel dei report (Fase 3).

## Sedi
Una sede senza coordinate usa quelle del proprio comune. Per distanze più precise l'admin globale indica latitudine e longitudine della sede (area admin → Sedi). Quando le coordinate cambiano, le distanze verso quella sede vengono ricalcolate.
