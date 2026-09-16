# Daily Honky Tonk – separate Magic-Paws-Version

`index.html` bleibt unverändert. `index2.html` basiert auf derselben Oberfläche und ergänzt den Block **02a · Magic Paws → Honky Tonk**. Bestehende White-Lightning-, Prompt-, Editor-, Archiv- und Druckfunktionen bleiben enthalten. Es gibt keinen neuen API-Schlüssel, keine KI-Aufrufe und keine zusätzlichen geplanten Jobs.

## Sofort nutzbarer Ablauf nach Veröffentlichung von index2

1. In GitHub einen Fine-grained Personal Access Token für `mowlsint/MagicPaws` mit **Contents: read** verwenden.
2. In `index2.html` unter **02a** den Token einfügen und **Aktuelle Magic-Paws-JSON laden** klicken. Der Token wird nicht im Repo gespeichert; nur das optionale Häkchen merkt ihn lokal in diesem Browser.
3. UTC-Endzeit und Zeitfenster prüfen. Der neueste gelieferte Export setzt die Endzeit. Ein größeres Fenster holt keine fehlenden Tage nach.
4. Meldungen auswählen und an den Report anhängen. Kein KI-Zwischenschritt nötig. Danach redaktionell bearbeiten und die vorhandenen Exporte verwenden.
5. Fallback bleibt möglich: Im privaten Magic-Paws-Repo `reports/rawdata` den aktuellen HTML-Bericht oder `latest_honkytonk_feed.json` herunterladen und lokal auswählen.

Der ergänzte Magic-Paws-Renderer erzeugt außerdem **privat** `reports/rawdata/latest_honkytonk_feed.json`. Sobald diese Änderung übernommen und der bestehende Morgenlauf regulär ausgeführt wurde, lässt sich diese kleinere JSON-Datei gleichwertig importieren. Es wurde kein Workflow gestartet oder neu geplant. Bei Ausfall des optionalen Sidecars wird die bestehende PDF-/Mail-Erstellung nicht absichtlich abgebrochen.

## Was automatisiert ist – und was nicht

- HTML/JSON lesen, Datumsfilter, URL-Dubletten, konservative Kategorie-Vorschläge, vorhandene Koordinaten, bestehendes Reportlayout.
- Halbautomatisch ist jetzt der private Klick-Abruf der aktuellen JSON per lokal eingegebenem GitHub-Token. Manuell bleibt die redaktionelle Kontrolle und das Anhängen der ausgewählten Meldungen.
- Der Token gehört weiterhin nicht in diese HTML-Datei und wird nicht in Entwurfs-JSON exportiert. Optionales Merken nutzt nur den lokalen Browser-Speicher des jeweiligen Geräts.
- Ein späterer unbeaufsichtigter Abruf ohne Benutzereingriff benötigt weiterhin einen geschützten Backend-/Feed-Zugang oder eine freigegebene öffentliche Datenmenge.
- Keine globale Websuche, keine Übersetzung, keine neue Analyse. Rohtexte bleiben in ihrer Originalsprache. DE/EN schaltet die Oberfläche/Reportbeschriftung um, nicht automatisch die Sprache der Meldungen.
- Der vorhandene Kartenhintergrund wird wie bisher von ArcGIS geladen; Offline-Karten sind noch kein Bestandteil dieser Änderung. Die Weltansicht umfasst jetzt auch Asien/Pazifik.

## Datenqualität und Sicherheit

- Nur `.rawList article.event` wird aus HTML gelesen; der eingebettete KI-Lagebericht nicht. Importierte HTML-Skripte und Ressourcen werden nicht in die aktive Seite übernommen.
- Original-URL und valider Zeitstempel sind Pflicht. Fehlende Zeitstempel werden nicht auf heute gesetzt. Die Zeitbasis kann in Magic Paws Veröffentlichung oder technische Erfassung sein; sie wird nicht als verifiziertes Ereignisdatum ausgegeben.
- Exakte Quellen-URLs werden nach Entfernen von Trackingparametern dedupliziert, nicht beliebige ähnliche Titel. Gleiche Quelle in mehreren Eingabedateien: neuester Export zuerst. Bereits vorhandene Reportmeldungen werden nicht überschrieben; Updates derselben Quelle müssen redaktionell geprüft werden.
- Keine automatische Einstufung als A/B/C-Evidenz; `CONF` bleibt ein ungeprüftes Quellfeld. Fehlende Schwere bleibt `unbekannt`.
- Keine neuen Orte aus Volltext-Nennungen beim Magic-Paws-Import. Bekannte regionale Mittelpunkte werden als `regional/corridor` gezeigt. Unbekannte Geo-Methoden und ungültige Koordinaten werden nicht als Hauptmarker dargestellt. Im Editor können belegte Geoangaben manuell ergänzt werden.
- Alle Meldungen sind Entwürfe. Routinetanker oder Container allein begründen keinen Kriminalitäts-/Schattenflottenhinweis. Kategorie und Gewichtung sind Vorschläge, keine abschließende Bewertung.
- Die vollständige Entwurfs-JSON bewahrt Rohtext, Herkunft und Geo-Prüfmerkmale. MD/TXT/HTML sind Leseprodukte, keine verlustfreien Rohdatenarchive.
- Optionale Browsersicherung unter eigenem Schlüssel `mowlsint.honkytonk.index2.draft.v1`; kein automatisches Laden, kein Überschreiben von Speicher der alten Oberfläche. Browserdaten und Entwürfe können private Meldungen enthalten.

## Validierung

Node.js 24: `node --test tests/magicpaws-import.test.mjs`

Optionaler echter Browsertest: `npm install --no-save playwright`, `npx playwright install chromium`, dann `node tests/magicpaws-browser.mjs`.
Ein privater lokaler Rohdatenbericht kann optional mit `HONKYTONK_SAMPLE=/pfad/report.html` geprüft werden. Niemals private Beispieldaten ins öffentliche Honky-Tonk-Repo committen.

Der initiale Testlauf deckt Syntax und regelbasierte Adapterlogik ab. Der echte Browsertest konnte in der Erstellungsumgebung wegen fehlendem Chromium und gescheitertem Browserdownload nicht ausgeführt werden. Vor Freigabe bitte den beigefügten Browsertest und einen PDF-Druck mit echten Daten durchführen.
