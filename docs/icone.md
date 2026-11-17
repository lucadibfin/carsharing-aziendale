# Icone della PWA

Le icone **non sono più file da copiare a mano**. Lo script `apps/web/scripts/brand-icons.mjs`
le genera a ogni build (`npm run build -w web`, `npm run dev:web`) dal simbolo SVG del marchio
scelto con `BRAND`. Vedi [nuovo-marchio.md](nuovo-marchio.md). I file finiscono in
`apps/web/src/generated/public/`, che è ignorata da git.

## Sorgenti nella cartella del marchio (`brands/<id>/`)
- **`logoMark`** (facoltativo, altrimenti `logo`): simbolo **quadrato** in SVG, senza testi piccoli
  perché sotto i 48 px diventano illeggibili. Da qui nascono tutte le icone a colori.
- **`logoMono`** (facoltativo): SVG di cui conta solo la **sagoma**, che diventa bianca. Serve per
  il badge delle notifiche e l'icona monocromatica. Se manca, si usa la sagoma di `logoMark`.
  Va fornito quando il simbolo è un disco pieno, che come sagoma diventerebbe un cerchio
  bianco senza dettagli: è il caso del marchio `default`.
- **`icons.background`**: sfondo delle icone opache (maskable, apple-touch-icon).
- **`icons.padding`**: margine attorno al simbolo nelle icone `any`.

## File generati

| File | Dimensione | Uso | Come viene costruito |
|---|---|---|---|
| `icons/icon-192.png`, `icon-512.png` | 192, 512 | Android/Chrome (`purpose: any`); icona delle notifiche push | Simbolo su trasparente, con `icons.padding` |
| `icons/maskable-192.png`, `maskable-512.png` | 192, 512 | Android, icona adattiva (`maskable`) | Sfondo pieno; simbolo al 62% del lato, dentro la zona sicura (cerchio dell'80%) |
| `icons/monochrome-512.png` | 512 | Android 13+, icone a tema (`monochrome`) | Sagoma bianca su trasparente |
| `icons/badge-96.png` | 96 | Badge delle notifiche nella barra di stato di Android | Sagoma bianca su trasparente |
| `icons/apple-touch-icon-180.png` | 180 | iPhone, schermata Home | Opaco (iOS riempie di nero la trasparenza), simbolo all'80%; gli angoli li arrotonda iOS |
| `icons/apple-touch-icon-167.png` | 167 | iPad Pro | Come sopra |
| `favicon.ico` | 16, 32, 48 | Scheda del browser | Simbolo a tutto lato |
| `favicon.svg` | vettoriale | Browser recenti | Copia del simbolo |

Il manifest (`manifest.webmanifest`, anch'esso generato) dichiara voci **separate** per `any`,
`maskable` e `monochrome`. Un'icona disegnata per la maschera, usata "così com'è", appare troppo
piccola e con il bordo pieno. Un'icona normale, invece, viene tagliata dove il sistema la maschera.
Le notifiche push usano `icon-192.png` e `badge-96.png` (`apps/api/src/notifications/push.service.ts`).

**Controllo.** La guida di stile `/dev/stile` (solo in sviluppo) mostra in fondo le icone del
marchio attivo. In Chrome, DevTools → Application → Manifest mostra l'anteprima delle maskable
con la zona sicura, senza caricare il logo su siti esterni. La verifica dell'installazione su
Android e iPhone segue la checklist di [test-dispositivi.md](test-dispositivi.md).

## Da chiedere all'azienda per il marchio definitivo
- Logo vettoriale ufficiale (SVG) e una versione **monocromatica** del simbolo.
- Colore di sfondo delle icone, se diverso dal bianco.
- Per Fincons, l'**approvazione all'uso** di logo e marchio: vedi [brand-fincons.md](brand-fincons.md).

## Facoltativo: schermata di avvio su iPhone
Senza immagini dedicate, iPhone mostra per un istante una schermata bianca all'apertura dell'app
installata. Per evitarlo servono le `apple-touch-startup-image`, una per ogni risoluzione (circa
10–20 PNG). Il costo di manutenzione è alto per un beneficio piccolo: per ora non si fanno.
Android genera la sua schermata di avvio da `icon-512.png`, `background_color` e nome dell'app.
