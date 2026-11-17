# Dati di riferimento

| File | Contenuto | Fonte e licenza | Come si aggiorna |
|---|---|---|---|
| `comuni.csv` | Elenco dei comuni: codice ISTAT, nome, sigla della provincia, regione | **Fonte: ISTAT**, "Elenco comuni italiani". Licenza CC BY 4.0 | `npm run comuni:istat -w api -- <Elenco-comuni-italiani.csv>` |
| `comuni-coordinate.csv` | Un punto interno al territorio di ogni comune (WGS84) | **Fonte: ISTAT**, "Confini delle unità amministrative a fini statistici", elaborati: calcolo del *point on surface*. Licenza CC BY 4.0 | `npm run coords:istat -w api -- <confini.shp>` |

Entrambi i file sono caricati da `npm run db:seed -w api`. La procedura completa, da ripetere quando ISTAT pubblica variazioni dei comuni, è in [docs/distanze.md](../../../../docs/distanze.md#coordinate-dei-comuni-fonte-istat).

La licenza CC BY 4.0 richiede di citare la fonte e di indicare che i dati sono stati elaborati. L'app lo fa:
- nella pagina "Privacy e termini" (sezione "Fonti dei dati");
- nelle note delle statistiche e della dashboard admin;
- nelle prime righe del CSV delle coordinate.
