# Arbeitszeit-Erfassungsseite

## Übersicht

Die neue **Arbeitszeit-Erfassungsseite** erweitert AdminPlus um eine umfangreiche Verwaltung von Arbeitszeiten, Urlaub und Überstunden. Die Seite bietet eine intuitive Kalenderansicht, schnelle Erfassungsmöglichkeiten und automatische Vorschläge für vergessene Arbeitszeiten.

## Funktionen

### 1. **Kalender-Ansicht**
- Übersichtliche monatliche Kalenderansicht
- Farbliche Kennzeichnung verschiedener Zustände:
  - 🟢 **Grün**: Arbeitszeit erfasst
  - 🟠 **Orange**: Unvollständig erfasste Arbeitszeit
  - 🔵 **Blau**: Urlaub/Feiertag
  - ⚫ **Grau**: Wochenende
  - 🔴 **Rot**: Krankheitstag

- **Navigation**: Vor/Zurück-Pfeile oder Heute-Button
- **Klickable Tage**: Details für jeden Tag anzeigen

### 2. **Statistik-Dashboard**
Oben auf der Seite werden wichtige Kennzahlen angezeigt:
- ⏰ **Überstunden**: Differenz zwischen geleisteten und Sollstunden
- 🏖️ **Resturlaub**: Verbleibende Urlaubstage
- 🤒 **Krankheit**: Erfasste Krankheitstage
- 📊 **Diesen Monat**: Gesamtstunden des aktuellen Monats

### 3. **Vorschläge (Top der Seite)**
- Automatische Erkennung von Zeiträumen ohne erfasste Arbeitszeiten
- Zeigt Zeiträume von mindestens 1 Arbeitstag ohne Einträge
- **Ein-Klick-Bestätigung**: 
  - Klick auf "Hinzufügen" öffnet Batch-Add-Modal mit vorausgefüllten Daten
  - Schnelles Bestätigen oder Anpassen möglich

### 4. **Schnelle Erfassung (Schnell hinzufügen)**
- **Modal-Dialog** mit Eingabefeldern:
  - Datum (default: heute)
  - Von-Zeit (default: 09:00)
  - Bis-Zeit (default: 17:00)
  - Optionale Notiz
- **Validierung**:
  - Alle Felder sind erforderlich
  - Von-Zeit muss vor Bis-Zeit liegen
  - Stundenberechnung mit Unterstützung für Viertelstunden (0.25h, 0.5h, 0.75h)
- Speichert sofort nach Bestätigung

### 5. **Mehrere Tage hinzufügen (Batch-Erfassung)**
- **Ideal für**: Wochenurlaub einbuchen, Projekt-Zeiträume, rückwirkende Erfassungen
- **Eingabefelder**:
  - Von-Datum
  - Bis-Datum
  - Tägliche Von-Zeit (z.B. 09:00)
  - Tägliche Bis-Zeit (z.B. 17:00)
  - Optionale Notiz
  - Checkbox: "Nur Arbeitstage" (Montag-Freitag, ohne Feiertage)
- **Echtzeit-Vorschau**: Zeigt Liste aller betroffenen Tage
- **Fortschrittsbalken**: Bei vielen Tagen wird Fortschritt angezeigt
  - Läuft auch wenn AdminPlus minimiert wird
  - Kann durch "Abbrechen" unterbrochen werden
  - Zeigt aktuelle Position und Prozentanteil

### 6. **Urlaubs-/Krankheitsmeldung**
- **Typ-Auswahl**:
  - 🏖️ Urlaub
  - 🤒 Krankheit
  - 🎉 Feiertag
  - 📌 Besonderheit
- **Eingabefelder**:
  - Von-Datum
  - Bis-Datum
  - Begründung/Grund (optional)
  - Checkbox: "Bedarf einer Genehmigung"
- **Echtzeit-Vorschau**: Zeigt Zeitraum und Anzahl der Tage
- **Speicherung**: Wird als Request an Backend gesendet

## Technische Details

### Dateien
- `arbeitszeit.js` - Hauptlogik der Arbeitszeit-Erfassung
- `sidebar.html` - HTML-Struktur (neue Arbeitszeit-Seite)
- `style.css` - Styling für Kalender, Modals und Komponenten

### API-Integrationspunkte
Die folgenden API-Endpunkte werden angesprochen:
- `POST /api/worktime/add` - Arbeitszeit hinzufügen
- `POST /api/leave/request` - Urlaubs-/Krankheitsmeldung einreichen
- `GET /api/worktime/data` - Arbeitszeitdaten laden (bei Bedarf)

### State-Management
- `workingData`: Objekt mit Datumssträngen als Schlüssel, Arbeitszeitdaten als Werte
- `suggestionsData`: Array mit Zeiträumen ohne Arbeitszeiten
- `currentDate`: Aktuell angezeigter Monat
- `cancelOperationRequested`: Flag für Abbruch von Batch-Operationen

### Feiertage
Aktuell sind deutsche Feiertage 2026 hardcodiert:
- 1. Januar - Neujahr
- 10. April - Karfreitag
- 13. April - Ostermontag
- 1. Mai - Tag der Arbeit
- 14. Mai - Christi Himmelfahrt
- 25. Mai - Pfingstmontag
- 3. Oktober - Deutscher Einheitstag
- 25./26. Dezember - Weihnachtstage

(Diese können später dynamisch vom Backend geladen werden)

## Benutzeroberfläche

### Responsive Design
- Funktioniert auf Desktop, Tablet und Mobile
- Kalender passt sich an verfügbare Breite an
- Modals sind touch-freundlich

### Performance
- Batch-Operationen zeigen Fortschrittsbalken
- Verzögerung zwischen API-Aufrufen (100ms) zur Vermeidung von Überlastung
- Operationen können abgebrochen werden
- Läuft im Hintergrund weiter, auch wenn AdminPlus minimiert wird

## Sicherheit & Authentifizierung
- Seite ist nur für angemeldete Benutzer sichtbar
- API-Aufrufe erhalten Session-Context vom Parent-Frame
- Validierung aller Eingaben vor API-Aufruf

## Zukunfts-Möglichkeiten
- Wochenansicht zusätzlich zur Monatsansicht
- Urlaubs-Antrag-System mit Genehmigung
- Zeiterfassungs-Import
- Projekt-basierte Zeitverfolgung
- Überstunden-Ausgleich verwalten
- Urlaub-Planung mit Konflikterkennung
- Personalisierbare Arbeitszeit-Profile (z.B. 35h/Woche, 40h/Woche)
- Statistiken und Reports (Diagramme, Exporte)

## Debugging
Der Debug-Modus kann in `arbeitszeit.js` durch Ändern von `const DEBUG = true;` kontrolliert werden.
Alle Operationen werden dann in der Browser-Konsole mit Tag `[Arbeitszeit]` geloggt.
