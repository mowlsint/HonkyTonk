# HonkyTonk: optionaler Hintergrundbetrieb

Der bestehende manuelle Ablauf ist weiterhin Standard. Die eingeklappte Einstellung „01a · HonkyTonk Automatisierung“ verbindet sich mit einem eigenständigen Controller. Für das bestehende Cloudflare-Pages-Projekt läuft dieser auf **Cloudflare Workers + Workflows + Browser Run**; die genaue Dashboard-Einrichtung steht in [CLOUDFLARE_AUTOMATION.md](CLOUDFLARE_AUTOMATION.md). Der Node-Dienst bleibt als lokale Entwicklung und alternative Bereitstellung erhalten. Beide Varianten arbeiten unabhängig vom Browser und lesen ihren Betriebsmodus vor jedem Lauf und Versand erneut aus dem privaten Markdown-Archiv.

## Betriebsmodi und Ausgabeprofile

| Modus | Verhalten |
| --- | --- |
| `manual` (Standard) | Keine geplante KI-Recherche und kein Versand. Explizit angeforderte Entwürfe sind möglich. |
| `review` | Aktive Profile recherchieren und erzeugen archivierte Entwürfe; Versand erst nach manueller Freigabe. |
| `automatic` | Aktive Profile recherchieren, validieren, rendern und versenden selbstständig. |

Jedes Profil hat eine eigene ID, Bezeichnung, Region, Themenauswahl, Adressatenmodus, DE/EN/beide, Modell, Kartenscope, Verteiler und Zeitplan. Weitere Profile können über „Weitere Ausgabe“ ergänzt werden. Alle Profile sind zunächst deaktiviert und haben leere Verteiler. Änderungen werden erst mit „Modus und Profile speichern“ wirksam. „Manuell“ speichern pausiert den Dienst; Browser schließen oder Verbindung trennen lässt den gespeicherten Servermodus bestehen. Ein bereits beim Mailprovider eingegangener Versand kann durch den Moduswechsel nicht zurückgerufen werden.

| Sichtbares Berichtsfenster DE / EN | Tatsächliche Recherche | Standardrhythmus |
| --- | --- | --- |
| letzte 24 Stunden / Last 24 hours | 30 Stunden | täglich |
| letzte 48 Stunden / Last 48 hours | 55 Stunden | exakt alle 48 Stunden |
| letzte 7 Tage / Last 7 days | 192 Stunden = 8 Tage | wöchentlich |

Berichtsfenster und Versandrhythmus sind getrennt konfigurierbar. Der bisherige manuelle Standard „letzte 36 Stunden“ bleibt erhalten. Auch der manuelle Prompt und die lokalen Importfilter verwenden für die nominalen 24/48/7-Fenster die erweiterten Grenzen.

Täglich und wöchentlich richten sich nach der eingestellten lokalen Uhrzeit, standardmäßig `Europe/Berlin`. Die 48-Stunden-Folge beginnt am ersten Termin und verwendet echte 48-Stunden-Schritte, auch über Monatswechsel und Sommerzeit hinweg. Deshalb kann ihre lokale Uhrzeit beim Sommerzeitwechsel um eine Stunde wechseln. Ein verspäteter Lauf benutzt das geplante Ende als Daten-Cutoff und verschiebt den nächsten Termin nicht. Nach Ausfall wird nur der letzte fällige Termin pro Profil ausgeführt, keine Serie nachträglicher Mails.

## Eigenständiges Markdown-Archiv

Für den Betrieb ein eigenes **privates** GitHub-Repository, z. B. `HonkyTonk-Data`, mit initialisiertem `main`-Branch anlegen. Der Dienst verweigert öffentliche Datenarchive, das öffentliche HonkyTonk-Code-Repository und MagicPaws als Datenziel. Der bisherige direkte Magic-Paws-Netzabruf wurde entfernt. Lokale kompatible HTML-/JSON-Dateien bleiben importierbar; es gibt keine MagicPaws-Laufzeitabhängigkeit und keinen Zugriff auf dessen Repository, API oder Feeds.

Alle persistierten Datensätze sind `.md`:

```text
config/automation.md           Betriebsmodus, Profile, Verteiler, Zeitpläne
sources/imports/<id>.md        White-Lightning-/eigene Rohtextquellen
sources/web/<id>.md            Verifizierte Webauszüge mit Original-URL
reports/<run-id>-report.md     Lesbarer Bericht + vollständiger JSON-Datenblock
reports/<run-id>-de-artifact.md Exakte DE-Exporte, PDF als Base64 im Datenblock
reports/<run-id>-en-artifact.md Exakte EN-Exporte, PDF als Base64 im Datenblock
state/coverage/<id>.md         Durchsuchte Intervalle, Themen, Quellen, Negativbefunde
state/runs/<run-id>.md         Laufstatus, Modell-/Promptversion, geplante Grenzen
state/outbox/<run-id>-<id>.md   Empfängerbezogene Versandansprüche/Provider-IDs
```

Front Matter enthält maschinenlesbare Werte; JSON-Werte sind gültige YAML-Skalare/-Listen. Bericht und State bewahren ihre vollständigen Daten in einem mit `<!-- honkytonk:data -->` markierten JSON-Codeblock. So gehen Übersetzungen, Geo-Qualität und Herkunft beim Wiederlesen nicht verloren. PDF und portable HTML bleiben im selben Markdown-Archiv dauerhaft erhalten; ein freigegebener Entwurf wird nicht kurz vor Versand neu generiert.

Eine eigene, verifizierte Quellendatei kann so aussehen. Den Beispielinhalt durch den tatsächlichen Originalauszug ersetzen; ohne belegbare Zeit oder Originalquelle `status: "pending"` verwenden.

```markdown
---
id: "import-harbour-001"
kind: "import"
source_url: "https://example.org/original-report"
title: "Originaltitel"
published_at: "2026-10-04T04:00:00Z"
event_at: "2026-10-04T04:00:00Z"
imported_at: "2026-10-04T06:00:00Z"
language: "en"
region: "North Sea"
topics: ["safety"]
status: "verified"
---

Der tatsächliche Originalauszug, kein vorheriger KI-Lagetext.
```

`event_at` bezeichnet die berichtsfähige Entwicklung. Bei späteren Updates zu älteren Ereignissen die belegte Zeit **des neuen Updates** verwenden. Erfassungszeit wird niemals als Ereigniszeit eingesetzt. Importdateien aus der Oberfläche werden zunächst `pending`: Sie dienen als Recherchehinweise, bis die Webrecherche Originalinhalt und Zeit verifiziert. „White-Lightning-Importe archivieren“ übernimmt die aktuell in White Lightning geladenen Blöcke. Ohne Importe funktioniert die Recherche ebenfalls.

## Vorberichte und Websuche

Ein 48-Stunden-/Wochenlauf liest eigene Berichte, deren Originalmaterial und die dokumentierte Suchabdeckung. Pro Region und Thema werden bereits erfolgreich durchsuchte Intervalle von seinem tatsächlichen Fenster abgezogen. Nur Lücken werden erneut recherchiert; neue Zeit am rechten Rand wird weiterhin durchsucht. Fehlgeschlagene oder unvollständige Suche zählt niemals als Abdeckung. Ein erfolgreicher leerer Suchlauf wird als echter Negativbefund gespeichert.

Die Synthese erhält Originalauszüge und Original-URLs. Vorbericht-IDs liefern Kontinuität, werden aber nicht als Primärquellen behandelt. Der Modellauftrag führt Updates zu demselben Fall zusammen. Die technische Validierung verlangt eindeutige Ereignisschlüssel, belegte Quellendatensätze und Zeitstempel innerhalb des tatsächlichen Fensters. Gleiche URLs mit geändertem Originaltext bleiben als neue Quellenversion erhalten.

Die Recherche liest den vollständigen Archivbaum. Unveränderte Quellen, Suchabdeckung und Vorberichte werden anhand frischer Git-Blob-SHAs aus einem begrenzten Zwischenspeicher wiederverwendet. Statusabfragen lesen nur die jüngsten 60 Laufdatensätze; Konfiguration und Versandansprüche werden stets frisch gelesen. Bei sehr großen Archiven sollte eine spätere, ebenfalls in Markdown gespeicherte Indexierung ergänzt werden; API-Fehler oder zu große Quellensätze führen zu einem gehaltenen Lauf, nicht zu unvollständigen Mails. Der aktuelle Kontextschutz begrenzt Synthesen auf 750 Quellenauszüge bzw. 1,5 MB Quelldaten.

## Modellprofile und Ausgabeprüfung

`automation/core.mjs` enthält überprüfte Modellprofile mit eigenen Promptanweisungen und Reasoning-Einstellung:

| Modell | Reasoning | Promptversion |
| --- | --- | --- |
| `gpt-6.1-sol` | `medium` | `sol-1` |
| `gpt-6-astra` | `high` | `astra-1` |

Neue Modelle benötigen einen explizit geprüften Eintrag; es gibt keinen stillen Modellwechsel. Beide verwenden die Responses API, verpflichtendes `web_search` bei offenen Intervallen und ein gemeinsames striktes JSON-Schema. Angehängte Quellen/Seiten sind Evidenz, keine Anweisungen. Recherchierte Quellen müssen in den tatsächlich zurückgegebenen Webquellen auftauchen. Schema, Bilingualität, Quellenbezüge, präzise Datumsgrenzen und Geo-Koordinaten werden vor Ausgabe geprüft. Strukturvalidierung ersetzt keine fachliche Quellenbewertung; für den Einstieg ist `review` vorgesehen.

Die PDF-/HTML-/MD-/TXT-Ausgabe ruft den bestehenden `index2.html`-Renderer auf. **Keine zweite Reportvorlage.** Courier-CSS und `buildCleanPrintHTML()` sind unverändert; automatisierte Karten verwenden ausschließlich die gelieferten Geo-Datensätze. Logo und geladene Karte werden in portable Exporte eingebettet. Fehlende Bilder oder eine fehlgeschlagene PDF-Erzeugung halten den Versand an. Für gleiche Schriftmetriken im Serverbetrieb dieselben Courier-/Courier-New-Schriften wie im bisherigen Browser installieren, bei eigenen Fontdateien deren Lizenz beachten. Der Renderer behält die vorhandene Courier-Familie; ohne installierte Schrift greift die bestehende Browser-Fallbackfolge.

## Dienst starten

Node 24+, Playwright Chromium und die bisherigen HonkyTonk-Dateien werden benötigt. Lokal funktioniert ein Markdown-Verzeichnis für Entwicklung; mit `NODE_ENV=production` verlangt der Dienst das eigene private GitHub-Datenrepo. Es wird keine SQL-Datenbank eingerichtet.

```bash
npm ci --ignore-scripts
npx playwright install --with-deps chromium --only-shell
node --env-file=.env scripts/honkytonk-automation.mjs init
node --env-file=.env scripts/honkytonk-automation.mjs serve
```

`.env` anhand von `deploy/automation.env.example` privat erstellen. `HONKYTONK_ADMIN_TOKEN` mit mindestens 24 zufälligen Zeichen generieren. Die übrigen Werte:

| Variable | Verwendung |
| --- | --- |
| `HONKYTONK_DATA_REPOSITORY` | Eigenes privates `owner/repo` |
| `HONKYTONK_DATA_BRANCH` | Standard `main` |
| `HONKYTONK_GITHUB_TOKEN` | Fine-grained Token nur für das Datenrepo, Contents read/write |
| `OPENAI_API_KEY` | Serverseitiger API-Key für Recherche und Synthese |
| `RESEND_API_KEY` | Serverseitiger Key für den implementierten Mailadapter |
| `HONKYTONK_MAIL_FROM` | Beim Mailprovider verifizierte Absenderadresse |
| `HONKYTONK_ADMIN_TOKEN` | Authentifizierung aller Controller-API-Endpunkte |
| `HONKYTONK_ALLOWED_ORIGINS` | Exakte zugelassene UI-Origins, Komma getrennt |
| `HOST` / `PORT` | Lokal standardmäßig `127.0.0.1:8787` |
| `HONKYTONK_LOCAL_ARCHIVE` | Lokaler Testpfad, falls kein Datenrepo gesetzt ist |

Die erste Mailimplementierung verwendet **Resend** hinter einer austauschbaren `mailer`-Schnittstelle. Es wird kein vorhandener Mailzugang vorausgesetzt. Verteiler stehen nur im privaten Archiv, nie im öffentlichen Code. OpenAI-/GitHub-/Mailkeys gelangen nicht in die Oberfläche. Der separate Controller-Zugang bleibt nur in der aktuellen Browser-Sitzung; bei entfernter Nutzung HTTPS verwenden und nur die eigene UI-Origin freigeben.

Ein Container ist vorbereitet:

```bash
docker build -f deploy/Dockerfile -t honkytonk-controller .
docker run --restart unless-stopped --env-file .env -p 127.0.0.1:8787:8787 honkytonk-controller
```

Für Containerbetrieb `HOST=0.0.0.0` in der privaten `.env` setzen; der Host-Port bleibt lokal gebunden und wird über einen eigenen HTTPS-Reverse-Proxy bereitgestellt. Auf der bestehenden statischen Oberfläche dessen Origin unter Controller-Adresse eintragen. Derselbe Dienst kann auch die bisherige Oberfläche unter `/` liefern. Cloudflare Pages bleibt eine statische UI; kein API-Key gehört in deren Buildvariablen oder HTML.

Reine Planung verursacht keinen KI-Aufruf und keinen Versand:

```bash
node --env-file=.env scripts/honkytonk-automation.mjs plan --profile daily
```

Ein bewusst gestarteter Rechercheentwurf bleibt auch im Modus `automatic` freigabepflichtig:

```bash
node --env-file=.env scripts/honkytonk-automation.mjs draft --profile daily
```

Ein externer Timer kann alternativ `tick` ausführen. Den dauerhaften Dienst und einen zweiten Timer nicht gleichzeitig aktivieren; GitHub-CAS schützt zusätzlich Laufansprüche und Versand, aber ein einzelner Scheduler ist leichter zu betreiben. Im Repository ist ausschließlich ein Testworkflow aktiv, **kein Recherche-/Versand-Cron und keine Bereitstellung**.

## Freigabe, Änderung und Versandstörungen

1. Controller verbinden, Profil speichern, „Entwurf jetzt recherchieren“ wählen.
2. Unter „Bericht prüfen“ DE und EN im bestehenden Renderer prüfen. Der angezeigte Verteiler ist der im Entwurf gespeicherte Verteiler.
3. Änderungen am Automatikentwurf im vollständigen JSON-Feld speichern; danach den neu gerenderten Bericht erneut laden. Eine geänderte Revision sperrt alte Freigaben. Bearbeitungen im bestehenden manuellen Reporteditor verändern den archivierten Automatikentwurf nicht.
4. Für Versand Modus `review` oder `automatic` und dasselbe aktive Profil speichern; „Geprüfte Ausgabe … freigeben“ versendet genau diese Revision.

Läufe und Mails besitzen stabile, geplante IDs. Vor jedem Empfänger wird ein dauerhafter Markdown-Outboxanspruch angelegt. Gesendete Empfänger werden bei weiteren Aufrufen übersprungen. Zusätzlich verwendet der Mailprovider einen Idempotenzschlüssel. Bei Timeout oder unklarem Zustellstatus bleibt die Mail `pending`/`uncertain`, der Lauf `delivery_held`; sie wird niemals automatisch erneut gesendet, auch nicht nach Ablauf der Idempotenzfrist.

Bei einem solchen Fall **zuerst Manuell speichern**, dann den Status beim Mailprovider anhand des Versands/Idempotenzschlüssels prüfen. Die betreffende Outbox-Datei und der Lauf dürfen erst nach gesicherter Klärung kontrolliert fortgesetzt werden. Kein pauschales Löschen der Outbox: Das würde den dauerhaften Schutz gegen doppelte Mails aufheben. Ein nach bestätigtem Nichtversand bewusst gewünschter neuer Versand sollte eine neue Ausgabe-ID erhalten. Für bestätigte bereits angenommene Mails die Provider-ID im privaten Statusdatensatz festhalten. Der Code behandelt `sent` als vom Provider angenommen, nicht als garantierte Zustellung im Postfach.

`generating`/`editing`/`dispatching` nach einem Prozessabbruch werden bewusst nicht blind erneut ausgeführt. Gespeicherte Originalquellen und Suchabdeckung bleiben erhalten; ein nachweislich abgebrochener Recherche-/Renderlauf kann als `failed` markiert und über den ausdrücklichen Wiederholungsbutton neu aufgebaut werden. Versandansprüche bleiben dabei unangetastet.

## Verifikation

```bash
npm test
npm run build:cloudflare-pages
npm run test:browser
```

Unit-/Integrationsprüfungen benutzen synthetische Daten und Test-Mailadapter: Zeitfenster, DST/Monatswechsel, Wiederverwendung, Markdown-Roundtrip, Web-/Schemafehler, Bild/PDF-Fehler, parallele Ansprüche, manueller Modus, Freigabe und unsicherer Versand. Hashprüfungen sichern das unveränderte Courier-CSS und die bisherige PDF-Vorlage. Der echte Browsertest schließt den auslösenden Tab während der Erstellung und prüft archivierte DE/EN-PDF-/HTML-/MD-/TXT-Ausgaben. Die Karte wird dort durch ein lokales Bild ersetzt; daraus folgt keine Bestätigung der externen Kartendienst-Verfügbarkeit. Live-OpenAI, echtes GitHub-Datenrepo, Absenderkonfiguration und realer Versand benötigen die eigenen Produktionszugänge und sind nicht Teil dieser Tests.

Offizielle API-Referenzen: [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [Resend](https://resend.com/docs/api-reference/emails/send-email), [Idempotenz](https://resend.com/docs/dashboard/emails/idempotency-keys).
