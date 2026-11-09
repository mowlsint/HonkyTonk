# HonkyTonk-Karte und Rechercheprompt – Stand 9. November 2026

## Was die Karte tatsächlich ist

Die Reportkarte in `index.html` und `index2.html` ist ein **statisches Kartenausdrucksbild mit darübergelegten HTML-Markern**; keine Leaflet-/OpenLayers-Livekarte. Sie dient der Lageübersicht und den HTML-/PDF-Exporten. Es werden weder Schiffe live verfolgt noch Positionen durch einen Geocoder abgefragt. Die Druckansicht ist bei verfügbarer ArcGIS-Basiskarte für A4 ausgelegt.

* **Auto**: Ein enger Punkt-/Hafen-/Binnenland-Schwerpunkt wird lokal eingerahmt; benannte große Seegebiete bleiben auf überregionaler Ansicht. Weit auseinanderliegende Positionen fallen auf Europa bzw. Welt zurück.
* **Europa**: Fester Kartenraum. Ereignispositionen außerhalb der sichtbaren Ausdehnung werden **nicht** irreführend an den Kartenrand geklemmt; sie fehlen nur als Marker in der Karte, nicht im Report.
* **Welt**: Voller Längengrad-/Breitengradbereich mit 2:1 Seitenverhältnis und `1200x600` Bild.
* **Lokal**: Automatisch berechneter Koordinatenbereich, mindestens ca. 1,5 Breitengrade hoch, Seitenverhältnis 1200:520. Die Karte nutzt World Topographic Map; Europa/Welt nutzen World Ocean Base.

Die Darstellung verwendet ArcGIS REST `/MapServer/export` mit WGS84 (`bboxSR=4326`, `imageSR=4326`). **Die Marker und der Bildausschnitt verwenden dieselbe endgültige Bounding-Box.** Durch den Seitenverhältnisausgleich weicht die tatsächliche Bildausdehnung nicht mehr unkontrolliert von der Markerausdehnung ab. Die Topografie ist eine externe Abhängigkeit. Ohne Internet, bei Dienststörung oder fehlender Freigabe ist der Hintergrund nicht verfügbar; Marker werden dann ausgeblendet, die Ortsliste bleibt sichtbar.

### Verifikation

1. In beiden HTML-Versionen den Kartenmodus `Auto` wählen und einen manuell belegten Ort (z. B. Wiesbaden) mit belastbarer Koordinate eintragen. Karte neu rendern.
2. Prüfen, dass der Punkt im lokalen Kartenausschnitt liegt, nicht am Rand klebt. `mapMode = Europe` und `World` zusätzlich testen.
3. Network-Konsole: `/World_Topo_Map/MapServer/export` (lokal) bzw. `/Ocean/World_Ocean_Base/MapServer/export` (Europa/Welt). HTTP-Fehler, Netzsperren und CORS prüfen.
4. In den automatisierten Exporten müssen diese **beiden** explizit freigegebenen ArcGIS-URLs zugelassen sein. Canvas-Einbettung für standalone HTML/PDF benötigt CORS-Unterstützung der Bildquelle.
5. `npm test`, `npm run test:browser` und GitHub Actions prüfen. In Browser-Integrationstests werden die Kartenbilder **synthetisch** ersetzt, damit keine externen Geodienste kontaktiert werden. Ein grüner CI-Test beweist nicht die aktuelle Erreichbarkeit der echten ArcGIS-Endpunkte.

### Geo-Vertrauen

* `exact / event_location` nur mit belegten Ereigniskoordinaten (WGS84 Dezimalgrad). Der Hafen- oder Ortsschwerpunkt ist keine bestätigte Schiffs- oder Vorfallsposition.
* `regional / corridor` für benannte Seegebiete, Flussabschnitte und nachvollziehbare Ortsmittelpunkte, ausdrücklich **nicht** als Ereignisposition interpretieren.
* `unknown / context` nicht plotten. Fehlende Koordinaten werden nicht aus Namen als exakte Ereignisse ergänzt; ungültige oder vertauschte Koordinaten werden nicht automatisch repariert.
* Referenzorte wie Wiesbaden, Mainz, Frankfurt am Main, Rüdesheim, Bingen, Gernsheim werden nur als regionale Kartierungshilfe geführt. Über die lokale Gazetteer-Liste werden keine konkreten Ereignispositionen bestätigt.
* Ein `places[]`-Array mit ausdrücklicher Geo-Einschätzung wird respektiert. Der Report erzeugt dann keine zusätzlichen, möglicherweise falsch-positiven Punkte aus beiläufigen Erwähnungen im Nachrichtentext.

## Rechercheprompt

Das eigenständige KI-Harmonisierungsverfahren bleibt optional und produziert weiterhin die bestehenden `meta`, `items` und `discarded` JSON-Felder. Der Prompt führt **ein einziges absolutes UTC-Recherchefenster**:

* 24/36/48 Stunden: exakt rückwärts vom Endzeitpunkt; keine heimlichen 30/55-Stunden-Puffer.
* 7 Tage: exakt 168 Stunden.
* 8 Kalendertage: ab 00:00 lokaler Zeit vor sieben Tagen bis zum maßgeblichen Endzeitpunkt; die UTC-Grenzen werden explizit ausgegeben.
* Tagesaktuelle Ausgabe: Endzeitpunkt ist der Zeitpunkt der Prompt-Erstellung, **kein zukünftiger Tagesabschluss 23:59 Uhr**.

Bei lokalen Binnenwasserstraßen-Themen (z. B. Hessen/Wiesbaden, Rhein, Main) gilt **regional vor global**. Besonders zu prüfen sind WSV, GDWS, zuständiges WSA, ELWIS, hessische Behörden, Wasserschutzpolizei, Häfen, Pegel, Schleusen und Binnenlogistik. Allgemeine Weltmeldungen ohne nachgewiesenen lokalen Bezug sollen den Regionalbericht nicht auffüllen.

### Wichtige Grenzen

Ein lokaler Kartentest oder die GitHub CI kann **keine** Live-Erreichbarkeit des Esri-Dienstes beweisen. Der Druckmodus bindet weiterhin externe Kartenbilder ein. Bei sicherheitskritischem Bericht Einsatzpositionen stets gegen Primärquellen verifizieren und keine regionalen Referenzkoordinaten als präzise Ereignisorte verwenden.
