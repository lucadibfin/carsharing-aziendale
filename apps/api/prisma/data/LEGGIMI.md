# Dati di riferimento

| File | Contenuto | Fonte e licenza | Come si aggiorna |
|---|---|---|---|
| `comuni.csv` | Elenco dei comuni: codice ISTAT, nome, sigla della provincia, regione, codice catastale; data di riferimento nella prima riga | **Fonte: ISTAT**, SITUAS (elenco vigente) o "Elenco comuni italiani". Licenza CC BY 4.0 | `npm run comuni:istat -w api -- <situas.csv> --al GG/MM/AAAA` |
| `comuni-variazioni.csv` | Comuni nati dopo la data dei confini (fusioni, distacchi) e come se ne calcolano le coordinate | Ricavato dal confronto tra elenchi ISTAT; correggibile a mano | Aggiunto da `comuni:istat` per le fusioni riconosciute dal nome; a mano per gli altri casi |
| `comuni-ricodifiche.csv` | Registro storico dei cambi di codice di uno stesso comune (vecchio;nuovo;nome;dal) | Ricavato dal confronto tra elenchi ISTAT | Aggiunto automaticamente da `comuni:istat`; non si riscrive mai da zero |
| `comuni-coordinate.csv` | Un punto interno al territorio di ogni comune (WGS84) | **Fonte: ISTAT**, "Confini delle unità amministrative a fini statistici", elaborati: calcolo del *point on surface*. Licenza CC BY 4.0 | `npm run coords:istat -w api -- <confini.shp>` |

Tutti i file sono letti da `npm run db:seed`. La procedura completa, compresa la gestione di elenco e confini con date diverse, è in [docs/distanze.md](../../../../docs/distanze.md#elenco-e-confini-date-diverse).

La licenza CC BY 4.0 richiede di citare la fonte e di indicare che i dati sono stati elaborati. L'app lo fa:
- nella pagina "Privacy e termini" (sezione "Fonti dei dati");
- nelle note delle statistiche e della dashboard admin;
- nelle prime righe del CSV delle coordinate.
