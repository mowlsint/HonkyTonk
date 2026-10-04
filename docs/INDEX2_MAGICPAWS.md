# Daily Honky Tonk – separate Magic-Paws-Version

`index.html` bleibt unverändert. `index2.html` enthält weiterhin den kompatiblen lokalen HTML-/JSON-Rohimport unter **02a** sowie White Lightning, Prompt, Editor, Archiv und Druckfunktionen. Der bisherige direkte Magic-Paws-Abruf und seine Tokenfelder wurden entfernt; HonkyTonk greift nicht auf MagicPaws zu. Veraltete lokale Abruf-Tokens werden beim Start gelöscht.

Die eigenständige optionale Automatik ist in [AUTOMATION.md](AUTOMATION.md) beschrieben. Diese Datei dokumentiert ausschließlich den lokalen Kompatibilitätsimport.

## Lokaler Import

1. Bereits lokal vorliegende kompatible HTML-Berichte oder events[]-JSON unter **02a** auswählen oder einfügen.
2. UTC-Endzeit und Zeitfenster prüfen. Der neueste gelieferte Export setzt die Endzeit; mehrere lokale Tagesdateien können gemeinsam geladen werden.
3. Meldungen auswählen und an den Report anhängen, danach redaktionell prüfen und die bestehenden Exporte verwenden.

Der lokale Import macht keine Web-/KI-Aufrufe und keine automatische Übersetzung oder Analyse. Rohtexte bleiben in ihrer Originalsprache. Die nominalen Fenster 24/48 Stunden/7 Tage filtern tatsächlich 30/55/192 Stunden. Das erweitert die Auswahl gelieferter Daten; fehlende Quellen werden erst durch die separate Automatik recherchiert. Der bestehende Kartenhintergrund wird wie bisher von ArcGIS geladen.

## Datenqualität und Sicherheit

- Nur `.rawList article.event` wird aus HTML gelesen; der eingebettete KI-Lagebericht nicht. Importierte HTML-Skripte und Ressourcen werden nicht in die aktive Seite übernommen.
- Original-URL und valider Zeitstempel sind Pflicht. Fehlende Zeitstempel werden nicht auf heute gesetzt. Die Zeitbasis kann in Magic Paws Veröffentlichung oder technische Erfassung sein; sie wird nicht als verifiziertes Ereignisdatum ausgegeben.
- Exakte Quellen-URLs werden nach Entfernen von Trackingparametern dedupliziert, nicht beliebige ähnliche Titel. Gleiche Quelle in mehreren Eingabedateien: neuester Export zuerst. Bereits vorhandene Reportmeldungen werden nicht überschrieben; Updates derselben Quelle müssen redaktionell geprüft werden.
- Keine automatische Einstufung als A/B/C-Evidenz; `CONF` bleibt ein ungeprüftes Quellfeld. Fehlende Schwere bleibt `unbekannt`.
- Keine neuen Orte aus Volltext-Nennungen beim Magic-Paws-Import. Bekannte regionale Mittelpunkte werden als `regional/corridor` gezeigt. Unbekannte Geo-Methoden und ungültige Koordinaten werden nicht als Hauptmarker dargestellt. Im Editor können belegte Geoangaben manuell ergänzt werden.
- Alle Meldungen sind Entwürfe. Routinetanker oder Container allein begründen keinen Kriminalitäts-/Schattenflottenhinweis. Kategorie und Gewichtung sind Vorschläge, keine abschließende Bewertung.
- Die vollständige Entwurfs-JSON bewahrt Rohtext, Herkunft und Geo-Prüfmerkmale. MD/TXT/HTML sind Leseprodukte, keine verlustfreien Rohdatenarchive.
- Die englischen PDF-, HTML-, MD- und TXT-Ausgaben übersetzen auch die Werte der Zeitraum- und Modusauswahl, bekannte Regionsnamen, Kartenbeschriftungen und feste Prüf-/Evidenzhinweise. Beispiel: „letzte 48 Stunden“ erscheint als „Last 48 hours“. Die deutsche Formularauswahl und gespeicherten Quelldaten bleiben erhalten; Meldungstexte verwenden vorhandene englische Felder oder die Originalsprache. Englisch exportierte MD-Einstellungen lassen sich wieder in die deutschen Auswahlfelder einlesen.
- Optionale Browsersicherung unter eigenem Schlüssel `mowlsint.honkytonk.index2.draft.v1`; kein automatisches Laden, kein Überschreiben von Speicher der alten Oberfläche. Browserdaten und Entwürfe können private Meldungen enthalten.

## Validierung

`npm test` prüft Adapter, Sprach-/Exportverhalten und Automatik. Der echte Browsertest läuft mit `npm ci --ignore-scripts`, `npx playwright install chromium --only-shell`, dann `npm run test:browser`. Die synthetischen Browserprüfungen decken lokalen Import, Originalsprache, Geo, Draft-Roundtrip, Archiv und vorhandene Exporte ab; die Automatikprüfung erzeugt zusätzlich echte DE/EN-Test-PDFs.

Ein eigener lokaler Rohdatenbericht kann optional mit `HONKYTONK_SAMPLE=/pfad/report.html` geprüft werden. Private Beispieldaten gehören nicht in das öffentliche Code-Repository.
