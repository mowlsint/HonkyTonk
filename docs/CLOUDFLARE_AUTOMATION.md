# HonkyTonk-Automatisierung auf Cloudflare

HonkyTonk bleibt auf dem bestehenden **Cloudflare-Pages-Projekt**. Ein zusätzliches **Worker-Projekt** übernimmt API und Zeitplan; **Cloudflare Workflows** führt Recherche, Erstellung, Entwurfsänderungen und Versand unabhängig vom geöffneten Browser aus. **Browser Run** druckt die vorhandene HonkyTonk-PDF-Vorlage. Ein eigener Server ist dafür nicht erforderlich.

Der Standard bleibt **Manuell**, alle neuen Ausgabeprofile sind deaktiviert. Courier-CSS und `buildCleanPrintHTML()` bleiben unverändert. Der Worker kopiert die vorhandene App für seinen internen Renderer; es gibt keine zweite Berichtsvorlage. DE/EN werden mit denselben HTML-/PDF-/MD-/TXT-Funktionen erstellt wie im manuellen Ablauf. Browser Run unterstützt Courier und Courier New; der lokale Browsertest bestätigt die gemeinsame Vorlage, kein bereits erfolgtes Live-Cloudflare-Rendering.

## 1. Privates Archiv und Zugänge vorbereiten

In GitHub ein separates **privates** Repository `mowlsint/HonkyTonk-Data` erstellen. „Add a README file“ auswählen, damit `main` existiert. Dort liegen später Quellen, Berichte, Verteiler und Status ausschließlich als `.md`. Das öffentliche HonkyTonk-Code-Repo ist nicht das Datenarchiv. Es werden weder MagicPaws-Daten noch dessen API oder Repository abgerufen.

Ein **fine-grained GitHub Personal Access Token**:

- Resource owner: `mowlsint`.
- Repository access: **Only select repositories → HonkyTonk-Data**.
- Repository permissions: **Contents: Read and write**, **Metadata: Read**. Weitere Rechte sind nicht erforderlich.

Einen eigenen OpenAI-Projekt-API-Key mit Zugriff auf die Responses API vorbereiten. Der Key wird später als Worker-Secret gespeichert. Modelle und die jeweils passenden Prompts werden pro HonkyTonk-Profil gewählt. Recherche und Zusammenfassung laufen über eigene OpenAI-Anfragen; optionales White-Lightning-Material wird aus dem eigenen Archiv gelesen.

Für Mailversand verwendet diese Version **Resend**: API-Key und verifizierte Absenderadresse vorbereiten, sobald Versand gewünscht ist. Recherche und Entwurfserstellung funktionieren ohne Mail-Key. Empfänger werden später je Ausgabeprofil in HonkyTonk eingetragen und im privaten Archiv gespeichert.

## 2. Worker-Projekt mit GitHub verbinden

Nach dem Zusammenführen der Cloudflare-Anpassung in `main` in Cloudflare **Workers & Pages** ein neues **Worker-Projekt** erstellen und das Code-Repository `mowlsint/HonkyTonk` verbinden. Das vorhandene Pages-Projekt behält seine bisherigen Einstellungen.

| Worker-Einstellung | Wert |
| --- | --- |
| Worker name | `honkytonk-controller` |
| Repository | `mowlsint/HonkyTonk` |
| Production branch | `main` |
| Root directory | Repository-Wurzel `/` |
| Build command | `npm ci --ignore-scripts` |
| Deploy command | `npm run deploy:cloudflare-worker` |
| Node version | `24` |

Wenn Cloudflare Node bereits automatisch installiert, wird mit dem Build-Befehl trotzdem reproduzierbar aus `package-lock.json` installiert. Bei Bedarf `NODE_VERSION=24` als **Build variable** setzen. Produktions-Deployments nur von `main` aktivieren; Preview-Deployments für andere Branches zunächst deaktivieren. So verwenden Teständerungen nicht dieselben Produktions-Workflows und -Secrets.

Die Deploy-Datei heißt bewusst **`wrangler.worker.jsonc`**. Die npm-Befehle wählen sie explizit mit `--config` aus, damit sie nicht als Pages-Konfiguration erkannt wird. Der Deploy-Befehl baut die internen Renderer-Assets und richtet die deklarierten Bindings ein:

| Binding / Ressource | Zweck |
| --- | --- |
| `HONKYTONK_JOBS` / Workflow `honkytonk-jobs` | Dauerhafte Hintergrundaufträge |
| `BROWSER` | Browser Run für PDF und portable HTML-Ausgaben |
| `ASSETS` | Vorhandene App, Logos und Renderer-Skript |
| Cron `*/10 * * * *` | Alle zehn Minuten fällige Ausgabeprofile prüfen |

Keine D1-, SQL-, KV- oder R2-Datenbank anlegen. Cloudflare hält den Ausführungsstatus seiner Workflows; die vollständigen Berichte, Quellen und Checkpoint-Werte bleiben im eigenen GitHub-Markdown-Archiv. Öffentliche Worker-Pfade liefern keine internen Renderer-Assets aus.

Für diesen Betrieb **Workers Paid** einplanen: derzeit mindestens 5 USD monatlich zuzüglich eventueller Mehrnutzung; OpenAI und Mailprovider werden separat abgerechnet. Browser Run ist auf Paid mit einem Nutzungskontingent enthalten. Die Prüfung alle zehn Minuten startet im manuellen Modus keine KI-Suche, Browser-PDF-Erstellung oder Mail. Sie liest nach Einrichtung nur den gespeicherten Modus. Preise vor Aktivierung im eigenen Cloudflare-Konto prüfen.

## 3. Variablen und Secrets im Worker eintragen

Im angelegten **Worker → Settings → Variables and Secrets** die folgenden Werte setzen. Dies sind **Runtime-Einstellungen des Workers**, keine Pages- oder Build-Secrets.

| Name | Typ | Wert / Herkunft |
| --- | --- | --- |
| `HONKYTONK_DATA_REPOSITORY` | Variable | `mowlsint/HonkyTonk-Data` |
| `HONKYTONK_DATA_BRANCH` | Variable | `main` |
| `HONKYTONK_ALLOWED_ORIGINS` | Variable | Die genaue Origin der bestehenden HonkyTonk-Seite, etwa `https://dein-honkytonk.pages.dev`; ohne abschließenden `/`, mehrere Origins mit Komma trennen |
| `HONKYTONK_MAIL_FROM` | Variable | Bei Resend verifizierter Absender, z. B. `HonkyTonk <berichte@deine-domain.de>`; erst für Versand nötig |
| `HONKYTONK_GITHUB_TOKEN` | **Secret** | Fine-grained Token für das private Datenrepo |
| `OPENAI_API_KEY` | **Secret** | Eigener OpenAI-Projekt-API-Key |
| `HONKYTONK_ADMIN_TOKEN` | **Secret** | Eigener zufälliger Controller-Zugang mit mindestens 24 Zeichen |
| `RESEND_API_KEY` | **Secret** | Eigener Resend-Key; erst für Versand nötig |

`HONKYTONK_ADMIN_TOKEN` kann im eigenen Terminal mit `openssl rand -hex 32` erzeugt werden. Er wird bei der Verbindung in HonkyTonk eingegeben und bleibt dort nur im Arbeitsspeicher der aktuellen Browser-Sitzung. OpenAI-/GitHub-/Mailkeys bleiben serverseitig. Diese Schlüssel nicht in Chat, Code, `.md`-Archiv oder HTML eintragen.

`keep_vars: true` und das Fehlen fest verdrahteter Runtime-Variablen in der Wrangler-Datei sorgen dafür, dass spätere Code-Deployments die im Dashboard gesetzten Variablen erhalten. Secrets bleiben ebenfalls beim Worker. Workers Builds übernimmt die Cloudflare-Deployment-Authentifizierung; für den laufenden HonkyTonk-Worker ist kein zusätzlicher Cloudflare-API-Key nötig.

## 4. HonkyTonk verbinden und zuerst Entwürfe prüfen

Nach erfolgreichem Deployment die HTTPS-Adresse des Workers kopieren, beispielsweise `https://honkytonk-controller.DEIN-SUBDOMAIN.workers.dev`. Noch keine automatische Veröffentlichung oder Mail aktivieren.

1. Auf der bestehenden HonkyTonk-Seite **„01a · HonkyTonk Automatisierung“** aufklappen.
2. Unter **Controller-Adresse** die Worker-Origin ohne Pfad eintragen; unter Controller-Zugang den eigenen `HONKYTONK_ADMIN_TOKEN` eingeben und verbinden.
3. **Manuell** beibehalten. Ein Profil mit Sprache, Modell, Region, Themen und Zeitplan ausfüllen. Falls anschließend ein Testversand geplant ist, schon jetzt ausschließlich die eigene Testadresse eintragen und das Profil aktivieren; Manuell pausiert weiterhin alle geplanten Aufgaben. Danach **„Modus und Profile speichern“** anklicken. Die erste Speicherung legt `config/automation.md` im privaten Archiv an.
4. **„Rechercheplan prüfen“** zeigt Zeitgrenzen, fehlende Suchintervalle und wiederverwendete Quellen ohne KI-Aufruf. Danach **„Entwurf jetzt recherchieren“** erzeugt einen archivierten Entwurf auch im manuellen Modus. Dieser Schritt verwendet die kostenpflichtige OpenAI-API und Browser Run.
5. Nach Abschluss im Archiv **„Bericht prüfen“** wählen; DE/EN, Quellen, Karte und PDF-/Textausgaben prüfen. JSON-Änderungen werden als weiterer Hintergrundauftrag neu gerendert. Danach den Bericht erneut laden, bevor er freigegeben wird.
6. Für die erste Versandprüfung den Mail-Key und Absender konfigurieren. Den Modus auf **Review** ändern und speichern. Das bereits vor der Entwurfserstellung aktivierte Profil mit der eigenen Testadresse beibehalten. Nach Kontrolle freigeben.
7. Erst anschließend die tatsächlichen Verteiler je Profil eintragen und **Review** oder **Automatisch** speichern. Nach Änderungen an Empfängern oder sonstigen Profileinstellungen wird ein älterer Entwurf mit abweichendem Profil nicht versandt. Die nächste geplante Ausgabe verwendet die neue Konfiguration. Für einen sofortigen neuen Test eine „Weitere Ausgabe“ mit eigener Profil-ID anlegen; derselbe Termin desselben Profils wird nicht doppelt erstellt.

Die Oberfläche zeigt Hintergrundaufträge und aktualisiert den Laufstatus. Browser schließen oder Verbindung trennen stoppt keinen gespeicherten Zeitplan. **Manuell speichern** pausiert neue automatische Recherche und Versand. Workflow-Status ist zusätzlich im Cloudflare-Dashboard unter Workflows sichtbar.

## Zeitfenster und Wiederverwendung

| Wording | Tatsächliche Recherche | Rhythmus |
| --- | --- | --- |
| letzte 24 Stunden / Last 24 hours | 30 Stunden | täglich |
| letzte 48 Stunden / Last 48 hours | 55 Stunden | echte 48-Stunden-Folge |
| letzte 7 Tage / Last 7 days | 8 Tage | wöchentlich |

Die zehnminütige Prüfung kann einen Auftrag mit bis zu zehn Minuten Verzögerung beginnen lassen. Daten-Cutoff und nächste Ausgabe bleiben am geplanten Termin verankert. Recherche-/Erstellungszeit kommt bis zum Versand hinzu. Daily/Weekly folgen der lokalen Uhrzeit und Zeitzone, standardmäßig Berlin; 48 Stunden bleiben auch beim Sommerzeitwechsel exakt 48 Stunden. Nach Ausfall wird pro Profil nur der letzte fällige Termin nachgeholt.

48-Stunden- und Wochenausgaben lesen eigene ältere Berichte, Originalquellen und erfolgreich dokumentierte Suchabdeckung. Nur fehlende Intervalle/Themen werden neu recherchiert. Ein fehlgeschlagener Suchaufruf zählt nicht als erfolgreich durchsuchtes Fenster. Die vollständige fachliche Logik und die Markdown-Quellenformate stehen in [AUTOMATION.md](AUTOMATION.md).

## Unterbrechungen und dauerhafte Versandansprüche

Zusätzlich zu den Dateien in `AUTOMATION.md` legt der Cloudflare-Betrieb an:

```text
state/checkpoints/<workflow-hash>-<step-hash>.md  Abgeschlossene Erstellungsschritte und ihre Werte
state/requests/<uuid>.md                        Vollständige angeforderte Entwurfsänderung
```

Große Berichtswerte werden nicht als Workflow-Step-Ergebnis weitergegeben; dort bleibt nur der Pfad zum privaten Markdown-Checkpoint. Bei Wiederaufnahme abgeschlossene Schritte wiederverwenden, statt die bereits gespeicherten Recherche-/Syntheseschritte erneut auszuführen. Checkpoints gehören zu einer konkreten Workflow-ID; eine ausdrückliche Wiederholung eines fehlgeschlagenen Laufs erhält eine neue ID und nutzt dennoch die schon erfolgreich gespeicherte Suchabdeckung.

Kostenpflichtige und versendende Schritte haben **keine automatischen Fehler-Retries**. Ein noch nicht vollständig abgeschlossener Schritt kann bei einem Abbruch unklar bleiben. Bei `failed` Ursache prüfen und den ausdrücklichen Wiederholungsbutton nutzen. `generating`/`editing` nach einem endgültig gestoppten Workflow erst nach bestätigtem Abbruch kontrolliert als `failed` markieren; dabei keine Versandansprüche löschen. Ein angehaltener Entwurfsänderungsauftrag kann als verwaiste Request-Datei erhalten bleiben; er versendet nichts.

`dispatching`, `delivery_held` oder `uncertain` bedeutet: Providerstatus prüfen, **keinen blinden Neustart des Versands**. Empfängerbezogene Outbox-Ansprüche und Provider-Idempotenz bleiben bestehen. Bereits akzeptierte Mails werden bei erneutem Aufruf nicht noch einmal gesendet. Abgeschlossene Versandsteps enthalten nur Lauf-ID und Status; Empfänger und Artefakte bleiben im privaten Archiv. Details zur kontrollierten Klärung stehen in `AUTOMATION.md`.

## Verifikation und verbleibende Live-Einrichtung

```bash
npm ci --ignore-scripts
npm test
npm run build:cloudflare-pages
npm run check:cloudflare-worker
npm run test:cloudflare-runtime
npx playwright install --with-deps chromium --only-shell
npm run test:browser
```

Der Worker-Dry-Run baut und prüft das Bundle samt Browser-/Workflow-/Asset-Bindings ohne Deployment. Der zusätzliche workerd-Test startet das gebaute Bundle in der lokalen Cloudflare-Laufzeit und prüft Authentifizierung, Origin-Regeln, interne Asset-Sperre und fehlende Archivkonfiguration ohne externe Zugänge. Die Unit-/Integrationstests prüfen dauerhafte Checkpoints, Wiederaufnahme, Authentifizierung, Queue-API, Bearbeitung, Pause und Versandansprüche mit synthetischen Daten. Der reale Chromium-Test führt den Cloudflare-Renderer mit lokalem Assets-Binding aus und erzeugt DE/EN-PDFs; er prüft asynchrone UI-Erstellung, Bearbeitung und Freigabe. Die Karte und externen Provider sind dabei lokale Testadapter.

Ein Live-Cloudflare-Deployment, Zugriff mit dem eigenen GitHub-Token, OpenAI-Modellzugang, tatsächlicher Kartendienst sowie verifizierter Absender und realer Versand müssen nach Einrichtung im eigenen Konto geprüft werden. Es wurde noch kein Worker in deinem Cloudflare-Konto bereitgestellt und keine reale API-Recherche oder Mail ausgelöst.

Offizielle Referenzen: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Workflows](https://developers.cloudflare.com/workflows/build/workers-api/), [Browser Run mit Playwright](https://developers.cloudflare.com/browser-run/how-to/playwright/), [unterstützte Schriftarten](https://developers.cloudflare.com/browser-run/reference/supported-fonts/), [Workers-Preise](https://developers.cloudflare.com/workers/platform/pricing/), [Browser-Run-Preise](https://developers.cloudflare.com/browser-run/platform/pricing/).
