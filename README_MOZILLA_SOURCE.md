# Mozilla Quelltext-Einreichung (AdminPlus)

Dieses Dokument dient als Build- und Reproduktionsanleitung fuer die Add-on-Pruefung bei Mozilla (AMO).

## Enthaltene Build-Dateien

- `build.ps1`: Build-Skript fuer reproduzierbare Pakete aus dem Quellordner.
- `manifest.json` und alle Dateien unter `AdminPluss/`: Erweiterungs-Quelltext.

## Build-Umgebung

- Betriebssystem: Windows 10 oder Windows 11
- Shell: Windows PowerShell 5.1+ oder PowerShell 7+
- Optional fuer `*.crx`: Google Chrome oder Chromium
- Keine Node-/npm-Abhaengigkeit (kein Webpack/Bundling/Transpiling im Build)

## Schritt-fuer-Schritt Build

Aus dem Workspace-Root (Ordner, der `AdminPluss` enthaelt):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\AdminPluss\build.ps1 -SourceDir ".\AdminPluss" -OutputDir ".\dist"
```

Optional mit fixem Key fuer stabile CRX-ID:

```powershell
.\AdminPluss\build.ps1 -SourceDir ".\AdminPluss" -OutputDir ".\dist" -PemKeyPath ".\v1.0.0-Beta.pem"
```

Optional mit explizitem Versionslabel:

```powershell
.\AdminPluss\build.ps1 -SourceDir ".\AdminPluss" -OutputDir ".\dist" -VersionTag "v1.0.4-Beta"
```

## Build-Ergebnis

Das Skript erzeugt unter `dist/`:

- `adminplus-<version>.zip` (Source-/Pruefpaket)
- `adminplus-<version>.xpi` (Firefox-kompatibles Paket)
- `adminplus-<version>.crx` (wenn Chrome/Chromium gefunden wird)
- `adminplus-<version>.pem` (nur wenn kein vorhandener `-PemKeyPath` genutzt wurde)

## Reproduzierbarkeit

- Das Skript kopiert den Quellordner unveraendert in ein temporaires Build-Verzeichnis.
- Es findet kein Minifying, kein Bundling und keine Queruebersetzung statt.
- Ausgeschlossen werden nur Build-Artefakte (`*.crx`, `*.xpi`, `*.zip`) und typische Arbeitsordner (`.git`, `dist`, `node_modules`).

## Hinweise zu Drittanbieter-Bibliotheken

Folgende externe Open-Source-Bibliotheken sind als Vendor-Dateien enthalten:

- `vendor/peerjs.min.js`
- `vendor/qrcode.min.js`

Diese Dateien sind Drittanbieter-Artefakte und nicht lokal generiert.

## Empfehlung fuer AMO-Upload

- Falls Quelltext-Einreichung gefordert ist, `adminplus-<version>.zip` als Source-Code hochladen.
- Dieses README und `build.ps1` muessen im eingereichten Quelltext enthalten sein.