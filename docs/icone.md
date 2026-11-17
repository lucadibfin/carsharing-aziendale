# Icone definitive della PWA: cosa serve

Le icone attuali (`apps/web/public/icons/`) sono i segnaposto generati da Angular e vanno sostituite prima dei test con gli utenti.

## Sorgente da fornire
- **Logo vettoriale** (SVG, o PDF/AI vettoriale), più un **PNG 1024×1024** esportato dallo stesso file.
- **Colore di sfondo** ufficiale (esadecimale). Oggi l'app usa il verde `#1b5e20` come `theme_color`: se il marchio usa un altro colore, va aggiornato anche quello.
- Una versione **monocromatica** del simbolo (una sola tinta su sfondo trasparente), per badge e icone a tema di Android.
- Profilo colore sRGB, nessun testo piccolo: sotto i 48 px diventa illeggibile. Meglio il solo simbolo, senza il nome.

## File da produrre
Tutti PNG, quadrati.

| File | Dimensione | Uso | Requisiti |
|---|---|---|---|
| `icon-192.png` | 192×192 | Android/Chrome, schermata Home e notifiche (`purpose: any`) | Sfondo trasparente ammesso; il logo può arrivare ai bordi |
| `icon-512.png` | 512×512 | Android/Chrome, installazione e splash screen (`any`) | Come sopra |
| `maskable-192.png` | 192×192 | Android, icona adattiva (`purpose: maskable`) | **Sfondo pieno fino ai bordi**, nessuna trasparenza. Logo dentro la **zona sicura**: un cerchio centrale con diametro pari all'80% del lato (154 px su 192) |
| `maskable-512.png` | 512×512 | Come sopra | Zona sicura: cerchio di 410 px di diametro al centro |
| `monochrome-512.png` | 512×512 | Android 13+, icone a tema (`purpose: monochrome`), facoltativa | Una sola tinta (bianco o nero) su trasparente |
| `badge-96.png` | 96×96 | Piccola icona delle notifiche nella barra di stato di Android | **Bianco su trasparente**, sagoma semplice: Android usa solo il canale alfa |
| `apple-touch-icon.png` | 180×180 | iPhone, schermata Home | **Opaco**: iOS riempie di nero le parti trasparenti. **Angoli NON arrotondati**: li arrotonda iOS. Margine interno di circa il 10% |
| `apple-touch-icon-167.png` | 167×167 | iPad Pro (facoltativa) | Come sopra |
| `favicon.ico` | 16, 32 e 48 px nello stesso file | Scheda del browser | Versione semplificata, ben leggibile a 16 px |
| `favicon.svg` | vettoriale | Browser recenti (facoltativa) | Senza testi né font esterni |

**Perché icone `any` e `maskable` separate.** Oggi il manifest dichiara `"purpose": "maskable any"` sulle stesse immagini. È sconsigliato:
- un'icona disegnata per la maschera appare troppo piccola e con il bordo pieno dove l'icona è usata "così com'è";
- un'icona normale viene tagliata dove viene mascherata (cerchio, goccia, quadrato arrotondato secondo il produttore).

Con le icone definitive il manifest avrà voci distinte.

**Controllo delle maskable.** In Chrome: DevTools → Application → Manifest, che mostra l'anteprima delle icone e la zona sicura. Si evita così di caricare il logo aziendale su siti esterni.

## Facoltativo: schermata di avvio su iPhone
Senza immagini dedicate, iPhone mostra una schermata bianca per un istante all'apertura dell'app installata. Per evitarlo servono le `apple-touch-startup-image`: una per ogni risoluzione di iPhone e iPad (circa 10–20 PNG). Il costo di manutenzione è alto per un beneficio piccolo, quindi il consiglio è di **non farle** per ora. Android genera la sua schermata di avvio da `icon-512.png`, `background_color` e nome dell'app.

## Cosa cambierò nel codice quando arrivano i file
1. Copia in `apps/web/public/icons/` e rimozione dei segnaposto `icon-72x72.png` … `icon-512x512.png`.
2. `manifest.webmanifest`: voci separate `any`, `maskable` e `monochrome`; `theme_color` e `background_color` dal marchio.
3. `index.html`: `apple-touch-icon` a 180 px (oggi punta alla 192), `favicon.svg` e `favicon.ico`.
4. Notifiche push (`apps/api/src/notifications/push.service.ts`): `icon` → `icon-192.png`, `badge` → `badge-96.png`. Oggi il badge è l'icona colorata, che Android mostra come un quadrato pieno.
5. Verifica dell'installazione su Android e iPhone con la checklist di [test-dispositivi.md](test-dispositivi.md).
