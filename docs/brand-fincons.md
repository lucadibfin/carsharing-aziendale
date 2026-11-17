# Marchio "fincons": analisi del sito e proposta di tema

> **⚠ Uso del marchio da approvare.** Il logo e il marchio Fincons sono usati **solo** nella
> configurazione `brands/fincons/` e il loro impiego nell'app **deve ancora essere approvato
> dall'azienda** (Comunicazione / Marketing). Fino all'approvazione il marchio va usato solo in
> sviluppo e nei test interni. Lo stato è registrato anche in `brands/fincons/brand.json`
> (`usageApproval.approved: false`): la build stampa un avviso e la guida di stile mostra
> l'etichetta "Uso del marchio da approvare".

Fonte: sito istituzionale <https://ita.finconsgroup.com/>, analizzato il 17/11/2026 leggendo il foglio
di stile del sito (`/Style_….css`), il CSS di base e il logo SVG (`/imgpub/2044508/0/0/logo_fincons.svg`).

## Cosa si ricava dal sito

### Colori

| Ruolo | Valore sul sito | Dove compare | Nel tema |
|---|---|---|---|
| Principale | `#B10135` (logo: `#b10035`) | cookie bar, pulsanti, CTA, titoli in evidenza, sottolineature | `primary` = `#b10135` |
| Secondario | `#5D5D5F` (logo: `#5b5b5d`) | scritta "GROUP" del logo, box alternati dei case study | `secondary` = `#5d5d5f` |
| Accento | `#2865C6` | titoli "blu" delle pagine interne | `accent` (tertiary) = `#2865c6` |
| Testo | `#333` | testo del corpo | `on-surface` ≈ `#1b1b1d` (Material) |
| Sfondi | `#fff`, `#f2f2f2`, `#fafafa` | pagine e box | superfici grigio neutro (`neutralChroma: 2`) |

Il crimson è usato quasi sempre su sfondo bianco o come sfondo di testo bianco. Le superfici
del tema sono quindi grigie quasi pure (tinta ricavata dal grigio del logo con saturazione 2),
per evitare il rosato che Material 3 darebbe derivandole dal rosso.

### Carattere

Il sito usa **Lato** (`body{font-family:'Lato',Source Sans Pro,sans-serif}`), caricato da Google Fonts.

- **Licenza:** SIL Open Font License 1.1: uso libero anche in app web e in prodotti
  commerciali, con l'obbligo di distribuire la licenza insieme ai file. **Non serve
  un'alternativa.**
- **Inclusione nell'app:** i file `woff2` (pesi 400, 700 e 900, sottoinsieme latin,
  sufficiente per l'italiano) sono copiati in `brands/fincons/fonts/` da `@fontsource/lato`
  5.3.0, insieme a `OFL.txt`. L'app li serve da `/brand/fonts/` e non li carica mai da Google
  Fonts o da altri servizi esterni (GDPR).

### Pulsanti

- I pulsanti sono a "pillola" (`border-radius: 20px`), pieni crimson con testo bianco, oppure
  bianchi con testo crimson.
- Il testo è in grassetto (`font-weight: bold`) e in `.7rem`. Il maiuscolo è usato solo in
  alcune CTA.
- Nel tema: raggio `pill` (equivalente per pulsanti alti 40px), testo **non** maiuscolo. In
  un'app mobile i pulsanti in maiuscolo risultano pesanti e meno leggibili.

### Card e box

- Angoli tra 3 e 5px (`border-radius: 4px` e `5px` sono i valori più frequenti).
- Ombra marcata e spostata in basso a destra: `box-shadow: 4px 7px 10px 0 #adadad`.
- Nel tema: card con raggio **6px**, **senza bordo** e con ombra spostata
  (`elevation: pronounced`: `2px 3px 6px` a riposo, `4px 7px 10px` per gli elementi in
  rilievo).

### Tono generale

Aziendale e sobrio, molto bianco, immagini grandi. Titoli di sezione spesso in **maiuscolo**
(50 regole `text-transform: uppercase` nel CSS). Nel tema solo i titoli di sezione sono in
maiuscolo con spaziatura `0.03em`. I titoli di pagina e il testo restano in minuscolo per
leggibilità.

### Logo

- `brands/fincons/logo.svg`: copia esatta del logo del sito (sfera + "FINCONS GROUP"), usata
  nella pagina di accesso.
- `brands/fincons/logo-mark.svg`: lo stesso file con il `viewBox` ristretto alla sola sfera
  (senza scritta "GROUP"). Da qui lo script genera le icone PWA.

Prima del rilascio sarebbe meglio ricevere dall'azienda il logo ufficiale in versione
vettoriale e monocromatica (vedi `docs/icone.md`). Oggi la versione monocromatica (badge
delle notifiche) è ricavata automaticamente dalla sagoma del simbolo.

## Token del tema

Configurazione completa in `brands/fincons/brand.json`.

| Token | Valore |
|---|---|
| `--mat-sys-primary` / `on-primary` | `#b10135` / `#ffffff` |
| `--mat-sys-primary-container` / `on-…` | `#ffdadb` / `#92002a` |
| `--mat-sys-secondary` / `secondary-container` | `#5d5d5f` / `#e4e2e4` |
| `--mat-sys-tertiary` / `tertiary-container` | `#2865c6` / `#d8e2ff` |
| `--mat-sys-surface` / `surface-container` | `#fbf9fa` / `#f0edee` |
| `--mat-sys-on-surface` / `on-surface-variant` | `#1b1b1d` / `#45474a` |
| `--mat-sys-outline` | `#76777a` |
| `--app-font-body` | `Lato, 'Source Sans Pro', 'Helvetica Neue', Arial, sans-serif` |
| pesi regular / medium / bold | 400 / 700 / 900 (Lato non ha il 500) |
| `--app-radius-button` / `card` / `field` / `chip` | pill / 6px / 4px / pill |
| `--app-shadow-1` | `2px 3px 6px 0 rgb(0 0 0 / .18)` |
| `--app-heading-transform` | `uppercase` (solo titoli di sezione) |

## Accessibilità (WCAG 2.1 AA)

I tre colori aziendali sono **già conformi** sullo sfondo dell'app e con testo bianco, quindi
**non è servita nessuna variante**: il pacchetto `@fcs/brand` non ha dovuto correggere alcun
colore.

| Coppia | Rapporto | Soglia |
|---|---|---|
| crimson `#b10135` su sfondo `#fbf9fa` (link, pulsanti di testo) | 6.84:1 | 4.5 |
| bianco su crimson (pulsante principale) | 7.17:1 | 4.5 |
| `#92002a` su `#ffdadb` (messaggi chat inviati) | 7.22:1 | 4.5 |
| grigio `#5d5d5f` su sfondo | 6.26:1 | 4.5 |
| blu `#2865c6` su sfondo | 5.31:1 | 4.5 |
| bianco su blu | 5.57:1 | 4.5 |
| bordo dei campi `#76777a` su sfondo | 4.27:1 | 3 |
| crimson su `surface-container-highest` (focus, toggle) | 5.56:1 | 3 |

L'elenco completo (28 coppie) è nella guida di stile e viene verificato dal test automatico
`packages/brand/src/contrast.spec.ts`, che fallisce se una coppia scende sotto la soglia.

**Come funzionano le varianti accessibili.** Se un marchio futuro avesse colori poco
contrastati (per esempio un giallo o un azzurro chiaro), `deriveColorScheme` scurirebbe (o
schiarirebbe) il colore nello spazio HCT. Tinta e saturazione restano le stesse e il tono
cambia solo quanto basta per raggiungere la soglia. Le correzioni compaiono nella guida di
stile e nella build. Il colore originale resta disponibile come `--app-color-brand` per usi
decorativi (logo, fasce), dove il contrasto non è richiesto.

**Da notare.** Il colore di errore di Material (`#b3261e`) è un rosso vicino al crimson
aziendale. I messaggi di errore restano riconoscibili perché sono sempre accompagnati da
testo e icona. Se l'azienda preferisce distinguerli di più, basta impostare
`colors.light.error` in `brand.json`.

## Come vedere la proposta

```powershell
npm run dev:web          # genera il marchio attivo + l'anteprima di tutti i marchi
# poi apri http://localhost:4200/dev/stile
```

La pagina `/dev/stile` esiste solo in sviluppo: nella build di produzione `dev-routes.ts` viene
sostituito da un file vuoto. Mostra in due colonne il marchio neutro (`default`) e `fincons`:
colori, tipografia, pulsanti, campi, card dei viaggi, chat, notifiche, contrasti. In fondo
mostra le icone PWA del marchio attivo.

Per provare l'app intera con il marchio Fincons:

```powershell
$env:BRAND = 'fincons'; npm run dev:web
```
