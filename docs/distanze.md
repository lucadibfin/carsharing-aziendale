# Distanze e statistiche

Le statistiche usano solo distanze **tra il centro di un comune e una sede aziendale**. Non si usano mai indirizzi o posizioni degli utenti. Ogni distanza è calcolata una volta e salvata nella tabella `DistanceCache`.

## Calcolo
| Voce | Regola |
|---|---|
| Km del passeggero (evitati) | distanza comune di salita → sede, × 2 se il viaggio prevede il ritorno |
| Km del conducente | distanza comune di partenza → sede (× 2 con il ritorno); contano come "condivisi" solo se c'era almeno un passeggero presente |
| Carburante risparmiato | km evitati × consumo / 100 |
| CO2 risparmiata | carburante × fattore di emissione dell'alimentazione |
| Euro risparmiati | carburante × prezzo |

**Auto di riferimento.** Si usano alimentazione e consumo indicati dal conducente nel profilo. Se mancano, valgono l'alimentazione di default e i valori medi dei parametri (area admin → Parametri).

**Valori di default.** I fattori di emissione, i consumi e i prezzi iniziali sono in `packages/shared/src/settings.ts` e sono **indicativi**: vanno verificati con il Mobility Manager prima di usarli nel PSCL.

**Chiusura del viaggio.** I calcoli avvengono quando il conducente chiude il viaggio e conferma i presenti. Producono due tipi di dato:
- **dato anonimo** (`TripStatFact`): una riga per viaggio, usata dalla dashboard aggregata. Non contiene identificativi di utenti e resta anche dopo la cancellazione degli account.
- **statistiche personali** (`UserStatEntry`): una riga per persona presente, visibile solo all'interessato. Si cancellano con l'account.

## Fonte delle distanze
`ROUTING_PROVIDER` nel `.env` dell'API:

- **`estimate`** (default): distanza in linea d'aria × coefficiente stradale (default 1,3, modificabile dai parametri). Non serve nessun servizio. Le distanze sono marcate come "stimate".
- **`osrm`**: distanza stradale reale calcolata da [OSRM](https://project-osrm.org/) (licenza BSD-2), installato sull'infrastruttura aziendale.
  - Indirizzo del servizio: `OSRM_URL`, es. `http://127.0.0.1:5000`.
  - Riceve solo le coordinate del comune e della sede.
  - Se non risponde entro `ROUTING_TIMEOUT_MS`, si usa la stima. La stima viene ricalcolata con OSRM al massimo una volta al giorno.

### Installare OSRM (server Linux)
1. Scaricare l'estratto OpenStreetMap dell'Italia (circa 2 GB), es. da Geofabrik: `italy-latest.osm.pbf`.
   - Licenza dei dati: ODbL. Va citata l'attribuzione "© OpenStreetMap contributors", ad esempio nella pagina "Privacy e termini".
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

I binari di OSRM si compilano dai sorgenti oppure si usano i pacchetti della distribuzione. Esiste anche l'immagine ufficiale `ghcr.io/project-osrm/osrm-backend`, se in futuro si adotteranno i container.

Aggiornare l'estratto 1–2 volte l'anno basta: la rete stradale cambia poco. Dopo l'aggiornamento svuotare la cache con `DELETE FROM "DistanceCache";`.

## Coordinate dei comuni
L'elenco ISTAT dei comuni non contiene coordinate. Vanno importate a parte da un file CSV `istat;lat;lon`:
```powershell
npm run db:import-coords -w api -- percorso/coordinate-comuni.csv
```
- Lo script aggiorna i comuni, svuota la cache delle distanze e indica quanti comuni attivi restano senza coordinate.
- Un comune senza coordinate non blocca nulla: il viaggio conta comunque nelle statistiche, ma senza km né risparmi, e nella dashboard risulta "incompleto".
- In sviluppo il seed imposta coordinate approssimative solo per Milano, Monza, Sesto San Giovanni, Bergamo, Roma e Torino.

Possibili fonti (da scegliere con l'ufficio legale per la licenza):
- **ISTAT**, "Basi territoriali / confini amministrativi": licenza CC BY 4.0. Si calcola il centroide di ogni comune con un software GIS (es. QGIS).
- **OpenStreetMap**: nodo `admin_centre` dei comuni (tag `ref:ISTAT`), estraibile dallo stesso file usato per OSRM. Licenza ODbL, che richiede attribuzione.

## Sedi
Una sede senza coordinate usa quelle del proprio comune. Per distanze più precise l'admin globale indica latitudine e longitudine della sede (area admin → Sedi). Quando le coordinate cambiano, le distanze verso quella sede vengono ricalcolate.
