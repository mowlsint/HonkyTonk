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
| Node.js version | `24` |

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
- Der bisherige Magic-Paws-Netzabruf ist entfernt. Lokale Dateien bleiben importierbar; es gibt keinen MagicPaws-Token mehr in der Oberfläche.
- Der optionale Hintergrundbetrieb verwendet einen separaten Cloudflare-Worker mit Workflows, Browser Run und einem privaten GitHub-Markdown-Archiv. Einrichtung und serverseitige Secrets sind in [CLOUDFLARE_AUTOMATION.md](CLOUDFLARE_AUTOMATION.md) beschrieben. Pages liefert weiterhin nur die Oberfläche; OpenAI-/GitHub-/Mailkeys gehören nicht in HTML oder den Pages-Build.

