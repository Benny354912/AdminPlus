# AdminPlus

AdminPlus ist eine Browser-Erweiterung fuer Firefox, die Verwaltungsportale auf Basis der Inwendo Vereinssoftware um praktische Zusatzfunktionen erweitert. Der aktuelle Fokus liegt auf drei Bereichen: Easy Login per QR-Code, Adressverwaltung mit Druckansicht und einer erweiterten Arbeitszeit-Erfassung.

Die Erweiterung ist als "Ewige Beta" auf Mozilla Add-ons veroeffentlicht und kann dort direkt heruntergeladen werden:

- Add-on-Seite: https://addons.mozilla.org/de/firefox/addon/adminplus-ewige-beta/
- Direkter XPI-Download ist ebenfalls ueber die Add-on-Seite moeglich.

## Funktionen

### Easy Login

- QR-Code-basierter Login fuer die begleitende PWA
- PeerJS-basierte Verbindung zwischen Desktop und mobilem Geraet
- Unterstuetzung fuer 2FA-Eingaben
- Automatische Aktualisierung des QR-Codes bei abgelaufenen Sessions

### Adressverwaltung

- Laden und Durchsuchen von Mitgliedern und Adressen
- Filter fuer aktive Mitglieder, Geburtstage und Jubilaeen
- Sortierung nach Vorname, Nachname, Geburtstag, Mitgliedsnummer und Erstellungsdatum
- Mehrfachauswahl mit anschliessender Druckansicht
- Briefumschlag-/Adressfenster-Druck fuer bis zu drei Empfaenger pro A4-Seite
- Druckeinstellungen fuer Schnittlinien und Absenderadresse

### Arbeitszeit-Erfassung

- Monatskalender mit Statusfarben fuer Arbeitszeit, Urlaub, Feiertage und Krankheit
- Statistikbereich fuer Ueberstunden, Resturlaub, Krankheitstage und Monatsstunden
- Schnellerfassung fuer einzelne Tage
- Batch-Erfassung fuer mehrere Tage, optional nur fuer Arbeitstage
- Unterschiedliche Arbeitszeiten pro Wochentag
- Vorschlaege fuer moeglicherweise fehlende Zeiteintraege
- Dialoge fuer Urlaub, Krankheit, Feiertage und sonstige Abwesenheiten

## Unterstuetzte Portale

Die Erweiterung wird aktuell auf folgenden Portalen eingebunden:

- `https://iw-admin.de/*`
- `https://verwaltung.turn-klubb.de/*`
- `https://*.iw-erp.de/*`

## Installation

### Firefox

Der einfachste Weg ist die Installation ueber Mozilla Add-ons:

1. Add-on-Seite oeffnen: https://addons.mozilla.org/de/firefox/addon/adminplus-ewige-beta/
2. Die Erweiterung zu Firefox hinzufuegen oder die XPI-Datei von dort herunterladen.
3. Anschliessend eines der unterstuetzten Verwaltungsportale aufrufen.

### Manuelle Installation aus dem Quellcode

1. Dieses Repository lokal bereitstellen.
2. In Firefox `about:debugging` oeffnen.
3. `Dieser Firefox` waehlen.
4. `Temporeres Add-on laden` auswaehlen.
5. Die Datei `manifest.json` aus diesem Projekt angeben.

## Entwicklung und Build

Fuer Mozilla-Pruefung und reproduzierbare Builds ist ein PowerShell-Buildskript vorhanden.

Beispiel:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\build.ps1 -SourceDir "." -OutputDir ".\dist"
```

Das Skript erzeugt je nach Umgebung Build-Artefakte wie:

- `adminplus-<version>.zip`
- `adminplus-<version>.xpi`
- `adminplus-<version>.crx`

Weitere Details stehen in `README_MOZILLA_SOURCE.md`.

## Projektstruktur

- `manifest.json` definiert die Browser-Erweiterung und Berechtigungen.
- `content.js` injiziert den Floating Action Button in unterstuetzte Portale.
- `sidebar.html` und `sidebar.js` enthalten die UI und Hauptlogik.
- `arbeitszeit.js` implementiert die Arbeitszeit-Funktionen.
- `background.js` enthaelt Hintergrundlogik der Erweiterung.
- `style.css` enthaelt das Styling der Sidebar.
- `vendor/peerjs.min.js` und `vendor/qrcode.min.js` sind eingebundene Drittanbieter-Bibliotheken.

## Berechtigungen

AdminPlus verwendet unter anderem folgende Berechtigungen:

- Zugriff auf aktive Tabs
- Zugriff auf Browser-Tabs
- Zugriff auf Daten in den unterstuetzten Verwaltungsportalen

Die genauen Berechtigungen sind in `manifest.json` und auf der Mozilla-Add-on-Seite einsehbar.

## Hinweise

- AdminPlus ist ein privat entwickeltes Projekt und wird nicht offiziell von den Anbietern der Portale unterstuetzt.
- Die Nutzung erfolgt auf eigenes Risiko und ohne Gewaehr.
- Verbreitung oder Modifikation ist nur mit Zustimmung des Entwicklers erlaubt.
- Lizenzstatus auf Mozilla Add-ons: Alle Rechte vorbehalten.