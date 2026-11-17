# Aggiungere il marchio di un nuovo cliente

L'app è "white label": nome, logo, colori, carattere, testi delle email e dati legali arrivano
da una cartella in `brands/`. Il marchio si sceglie con la variabile d'ambiente `BRAND`, sia
nella build della web app sia all'avvio dell'API, **senza modificare il codice**.

Marchi presenti:
- `default`: grafica neutra (verde, Roboto). È il marchio usato se `BRAND` non è impostata.
- `fincons`: ispirato al sito Fincons, **uso da approvare**. Vedi [brand-fincons.md](brand-fincons.md).

## 1. Crea la cartella

Parti da una copia del marchio neutro:

```powershell
Copy-Item -Recurse brands/default brands/acme
```

Il nome della cartella è l'identificativo del marchio: solo minuscole, cifre e trattini. Deve
coincidere con il campo `id` di `brand.json`.

```
brands/acme/
  brand.json          configurazione (sotto)
  logo.svg            logo orizzontale, pagina di accesso
  logo-mark.svg       simbolo quadrato per le icone (facoltativo)
  logo-mono.svg       sagoma per badge e icona monocromatica (facoltativo)
  fonts/*.woff2       file del carattere
  fonts/LICENSE.txt   licenza del carattere (obbligatoria)
```

## 2. Compila `brand.json`

Lo schema completo, con i commenti, è in `packages/brand/src/schema.ts`. La build segnala
subito con un messaggio chiaro i campi mancanti o sbagliati e i file che non esistono.

| Campo | Contenuto |
|---|---|
| `id` | Uguale al nome della cartella |
| `appName` | Nome completo: titolo della pagina, manifest, email, testi legali (`{{nomeApp}}`) |
| `shortName` | Nome breve, **max 12 caratteri**: nome sotto l'icona sulla schermata Home e prefisso dell'oggetto delle email |
| `description`, `tagline` | Descrizione per il manifest; frase sotto il nome nella pagina di accesso |
| `logo`, `logoMark`, `logoMono` | Percorsi dei file SVG nella cartella (vedi [icone.md](icone.md)) |
| `colors.light.primary` | Colore principale: pulsanti, link, elementi attivi |
| `colors.light.secondary` | Secondario: chip, avvisi, pulsanti tonali |
| `colors.light.accent` | Accento: etichette (es. "Privato") |
| `colors.light.neutral`, `neutralChroma` | Tinta e saturazione delle superfici: `neutralChroma: 0–2` dà un grigio quasi puro |
| `colors.light.error` | Facoltativo: il default `#b84500` (arancio bruciato) è distinguibile da rossi e cremisi |
| `colors.dark` | Riservato al futuro tema scuro: oggi non viene usato |
| `icons.background`, `icons.padding` | Sfondo delle icone opache e margine delle icone trasparenti |
| `font.family`, `fallback`, `weights`, `files`, `license` | Carattere: nome, famiglie di riserva, pesi usati per testo, titoli e grassetto, file `woff2`, licenza |
| `shape` | Raggi degli angoli in px, oppure `"pill"`, per `button`, `card`, `field`, `chip`, `dialog` |
| `card` | `"outlined"` (bordo sottile) o `"shadow"` (ombra, senza bordo) |
| `elevation` | `"soft"` (ombre Material) o `"pronounced"` (ombra spostata, più evidente) |
| `text` | Maiuscolo e spaziatura di titoli di sezione e pulsanti |
| `email.senderName`, `email.signature` | Nome del mittente e firma in fondo a ogni email |
| `legal.*` | Ragione sociale, indirizzo, P.IVA, contatti privacy e DPO, sito: riempiono i segnaposto di informativa e termini. Se vuoti, compaiono come `[DA COMPILARE: …]` |
| `usageApproval` | `approved: false` finché il cliente non autorizza l'uso di logo e marchio: la build stampa un avviso e la guida di stile lo segnala |

## 3. Logo e carattere

- **Logo**: SVG senza riferimenti a file o font esterni, con i testi convertiti in tracciati.
  Per le icone serve un simbolo quadrato e leggibile anche a 48 px.
- **Carattere**: solo con licenza che ne permetta l'uso nel web e la distribuzione dei file
  (es. SIL Open Font License, Apache 2.0). Copia nella cartella i `woff2` dei pesi
  necessari (in genere 400 e 700, sottoinsieme latin) e il file di licenza. I font vengono
  serviti dall'app, **mai da Google Fonts o altri servizi esterni** (GDPR). Se il carattere
  aziendale ha una licenza solo desktop o non è scaricabile, scegline uno open source simile e
  annotalo nella documentazione del marchio.

## 4. Verifica l'accessibilità

```powershell
npm test -w @fcs/brand
```

Il test controlla, per ogni marchio in `brands/`, 28 coppie di colori effettivamente usate
dall'interfaccia, con le soglie WCAG 2.1 AA: 4.5:1 per il testo, 3:1 per bordi e indicatori.
Controlla anche che il colore di errore sia distinguibile dal principale (almeno 20° di tinta).

Se un colore non basta, la derivazione dei token lo **scurisce o schiarisce automaticamente**
quanto serve, mantenendone tinta e saturazione. Le correzioni compaiono nella guida di stile
(sezione "Contrasto") e il colore originale resta disponibile come `--app-color-brand` per usi
decorativi. Se il risultato non piace al cliente, conviene scegliere direttamente un colore
più scuro in `brand.json`.

## 5. Guarda il risultato

```powershell
$env:BRAND = 'acme'; npm run dev:web
```

Apri <http://localhost:4200/dev/stile>: la guida di stile, solo in sviluppo, affianca tutti i
marchi. Mostra colori, tipografia, pulsanti, campi, card, chat, notifiche, contrasti e le icone
PWA del marchio attivo.

## 6. Build e avvio

La web app e l'API devono usare **lo stesso** `BRAND`.

```powershell
$env:BRAND = 'acme'
npm run build            # web: tema, manifest, index.html, icone e font del marchio
```

- **Web**: `scripts/brand-build.mjs` genera tutto in `apps/web/src/generated/`, prima di
  `ng build`, `ng serve` e `ng test`.
- **API**: legge `BRAND` all'avvio (`apps/api/.env`) per il mittente e la firma delle email,
  il prefisso dell'oggetto e i dati legali. `MAIL_FROM` contiene solo l'indirizzo.

## 7. Testi legali

Informativa e termini (`docs/legal/*.md`, caricati nel database da `npm run db:seed`) usano i
segnaposto `{{nomeApp}}`, `{{nomeBreve}}`, `{{ragioneSociale}}`, `{{indirizzo}}`,
`{{partitaIva}}`, `{{contattoPrivacy}}`, `{{contattoDpo}}`, `{{sitoWeb}}`. L'API li sostituisce
con i dati del marchio **quando gli utenti leggono il testo**. Gli amministratori, in
`/admin/testi`, vedono e modificano i segnaposto, così lo stesso testo vale per ogni marchio.

## Regole per chi sviluppa

- **Nei componenti** si usano solo token:
  - colori: `var(--mat-sys-*)`
  - spazi: `var(--app-space-1…8)` (4, 8, 12, 16, 24, 32, 48, 64 px)
  - raggi: `var(--app-radius-*)`
  - ombre: `var(--app-shadow-1…3)`
  - caratteri: `var(--app-font-*)` o i token tipografici Material

  Mai colori esadecimali, `rgb()` o `font-family`.
- **Nomi di aziende o del prodotto** non si scrivono nel codice:
  - web: la costante `BRAND` (`src/generated/brand.ts`)
  - API: il provider `BRAND` (`config.module.ts`)
  - testi legali: i segnaposto
- **Errori e avvisi** hanno sempre icona e testo, mai solo il colore:
  - `.error-text` per i messaggi in linea
  - `ToastService.error` per le notifiche (icona automatica)
  - `.chip.warn` e `mat-error` hanno l'icona da `styles.scss`
- **Tema scuro**: i token sono già divisi per schema. `deriveTokens` restituisce
  `schemes.light`, con `dark` predisposto, e `brand.tokens($scheme)` accetta `light` e
  riserva `dark`. Per attivarlo:
  1. generare `schemes.dark` con `isDark: true`;
  2. emettere il mixin per `dark`;
  3. includerlo sotto `@media (prefers-color-scheme: dark)`;
  4. aggiungere le coppie di contrasto dello schema scuro al test.
