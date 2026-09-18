# HonkyTonk auf Cloudflare Pages – private Bereitstellung

## 1. Repository privat stellen

In GitHub: **Settings → General → Danger Zone → Change repository visibility → Make private**. Die vorhandene GitHub-Pages-URL darf danach nicht mehr als Einsatzsystem verwendet werden.

## 2. Pages-Projekt anlegen

In Cloudflare: **Workers & Pages → Create application → Pages → Connect to Git** und `mowlsint/HonkyTonk` auswählen.

| Einstellung | Wert |
| --- | --- |
| Produktions-Branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build:cloudflare-pages` |
| Build output directory | `.cloudflare-pages` |
| Node.js version | `20` |

Die Veröffentlichung nimmt bewusst `index2.html` als App-Einstieg und erstellt daraus im Build `index.html`. Das bestehende `index.html` im Repository bleibt unverändert.

## 3. Zugriff vollständig schützen

In Cloudflare Zero Trust: **Access → Applications → Add an application → Self-hosted**.

- Application domain: die erzeugte HonkyTonk-`pages.dev`-Adresse oder besser eine eigene Subdomain.
- Policy: **Allow** → nur die eigenen zugelassenen E-Mail-Adressen.
- Identity provider: One-time PIN per E-Mail genügt für den Anfang.
- Session duration: kurz wählen, z. B. 24 Stunden.

Die Access-Anwendung muss die gesamte Domain schützen, nicht nur einzelne Pfade. So sind auch die HTML-Datei, Logos und eventuelle Preview-URLs nicht frei aufrufbar.

## Sicherheitshinweise

- Die Seitenregeln (`noindex`, `robots.txt`, `no-store`, Sicherheitsheader) sind nur zusätzliche Schutzschichten. Der wirksame Login-Schutz ist Cloudflare Access.
- Der GitHub-Token für den Magic-Paws-Abruf bleibt ausschließlich im Browser der jeweiligen Bedienperson und wird nicht in Cloudflare oder GitHub-Secrets kopiert.
- Für eine spätere serverseitige KI-/GitHub-Anbindung kommen Tokens nur als Cloudflare-Secret in eine Pages Function oder einen Worker, nie in die HTML-Datei.
