param(
    [string]$SourceDir = $PSScriptRoot,
    [string]$OutputDir = (Join-Path $PSScriptRoot "..\dist"),
    [string]$VersionTag,
    [string]$ChromePath,
    [string]$PemKeyPath
)

$ErrorActionPreference = "Stop"

function Resolve-ExistingPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Resolve-Path -LiteralPath $Path).Path
}

function Find-PackerExecutable {
    param([string]$ExplicitPath)

    if ($ExplicitPath) {
        if (Test-Path -LiteralPath $ExplicitPath) {
            return (Resolve-Path -LiteralPath $ExplicitPath).Path
        }

        throw "ChromePath wurde gesetzt, aber nicht gefunden: $ExplicitPath"
    }

    $candidates = @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LocalAppData "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LocalAppData "Local\Chromium\Application\chrome.exe"),
        (Join-Path $env:ProgramFiles "Chromium\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Chromium\Application\chrome.exe")
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    return $null
}

function Get-RelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $normalizedBase = $BasePath.TrimEnd('\\')
    if ($Path.StartsWith($normalizedBase, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $Path.Substring($normalizedBase.Length).TrimStart('\\')
    }

    $baseUri = New-Object System.Uri(($normalizedBase + '\\'))
    $pathUri = New-Object System.Uri($Path)
    $relativeUri = $baseUri.MakeRelativeUri($pathUri)
    return ([System.Uri]::UnescapeDataString($relativeUri.ToString()) -replace '/', '\\')
}

function New-ZipPackage {
    param(
        [Parameter(Mandatory = $true)][string]$InputDir,
        [Parameter(Mandatory = $true)][string]$OutputFile
    )

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    if (Test-Path -LiteralPath $OutputFile) {
        Remove-Item -LiteralPath $OutputFile -Force
    }

    $zip = [System.IO.Compression.ZipFile]::Open($OutputFile, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $base = (Resolve-Path -LiteralPath $InputDir).Path.TrimEnd('\\')
        $files = Get-ChildItem -LiteralPath $base -File -Recurse

        foreach ($file in $files) {
            $relative = $file.FullName.Substring($base.Length).TrimStart('\\')
            $entryPath = $relative -replace '\\', '/'
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip,
                $file.FullName,
                $entryPath,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    }
    finally {
        $zip.Dispose()
    }
}

$tempRoot = Join-Path $env:TEMP ("adminplus-build-" + [Guid]::NewGuid().ToString("N"))
$tempExtensionDir = Join-Path $tempRoot "AdminPlus"

try {
    $resolvedSourceDir = Resolve-ExistingPath -Path $SourceDir
    $manifestPath = Join-Path $resolvedSourceDir "manifest.json"

    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "manifest.json wurde im SourceDir nicht gefunden: $resolvedSourceDir"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

    if (-not $VersionTag) {
        $VersionTag = [string]$manifest.version
    }

    if (-not $VersionTag) {
        throw "VersionTag konnte nicht bestimmt werden. Bitte -VersionTag setzen."
    }

    $safeVersionTag = ($VersionTag -replace "[^a-zA-Z0-9._-]", "_")
    if ([System.IO.Path]::IsPathRooted($OutputDir)) {
        $resolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
    }
    else {
        $resolvedOutputDir = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $OutputDir))
    }

    New-Item -ItemType Directory -Path $tempExtensionDir -Force | Out-Null
    New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null

    # 1:1-Kopie ohne Build-Artefakte oder typische Arbeitsordner.
    $excludeDirs = @(".git", "dist", "node_modules", "__pycache__")
    $excludeFiles = @("*.crx", "*.xpi", "*.zip")

    $excludeFilePatterns = @()
    foreach ($pattern in $excludeFiles) {
        $excludeFilePatterns += [System.Management.Automation.WildcardPattern]::Get($pattern, "IgnoreCase")
    }

    $items = Get-ChildItem -LiteralPath $resolvedSourceDir -Recurse -Force
    foreach ($item in $items) {
        $relativePath = Get-RelativePath -BasePath $resolvedSourceDir -Path $item.FullName
        $segments = $relativePath -split '[\\/]'

        $skip = $false
        foreach ($segment in $segments) {
            if ($excludeDirs -contains $segment) {
                $skip = $true
                break
            }
        }

        if (-not $skip -and -not $item.PSIsContainer) {
            $fileName = [System.IO.Path]::GetFileName($item.FullName)
            foreach ($pattern in $excludeFilePatterns) {
                if ($pattern.IsMatch($fileName)) {
                    $skip = $true
                    break
                }
            }
        }

        if ($skip) {
            continue
        }

        $targetPath = Join-Path $tempExtensionDir $relativePath
        if ($item.PSIsContainer) {
            New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
            continue
        }

        $targetParent = Split-Path -Path $targetPath -Parent
        if (-not (Test-Path -LiteralPath $targetParent)) {
            New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
        }

        Copy-Item -LiteralPath $item.FullName -Destination $targetPath -Force
    }

    $baseName = "adminplus-$safeVersionTag"
    $zipPath = Join-Path $resolvedOutputDir "$baseName.zip"
    $xpiPath = Join-Path $resolvedOutputDir "$baseName.xpi"
    $crxPath = Join-Path $resolvedOutputDir "$baseName.crx"

    Remove-Item -LiteralPath $zipPath -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $xpiPath -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $crxPath -ErrorAction SilentlyContinue

    New-ZipPackage -InputDir $tempExtensionDir -OutputFile $zipPath
    Copy-Item -LiteralPath $zipPath -Destination $xpiPath

    $packerExe = Find-PackerExecutable -ExplicitPath $ChromePath
    if ($packerExe) {
        $packArgs = @("--pack-extension=$tempExtensionDir")

        if ($PemKeyPath) {
            $resolvedPem = Resolve-ExistingPath -Path $PemKeyPath
            $packArgs += "--pack-extension-key=$resolvedPem"
        }

        & $packerExe @packArgs

        $generatedCrx = Join-Path $tempRoot "AdminPlus.crx"
        if (Test-Path -LiteralPath $generatedCrx) {
            Move-Item -LiteralPath $generatedCrx -Destination $crxPath -Force

            $generatedPem = Join-Path $tempRoot "AdminPlus.pem"
            if ((-not $PemKeyPath) -and (Test-Path -LiteralPath $generatedPem)) {
                $pemOutputPath = Join-Path $resolvedOutputDir "$baseName.pem"
                Move-Item -LiteralPath $generatedPem -Destination $pemOutputPath -Force
                Write-Host "PEM gespeichert: $pemOutputPath"
            }

            Write-Host "CRX erstellt:     $crxPath"
        }
        else {
            Write-Warning "CRX wurde nicht erzeugt. Bitte -ChromePath auf eine Chrome/Chromium-Installation setzen."
        }
    }
    else {
        Write-Warning "Kein Chrome/Chromium gefunden. CRX wurde uebersprungen."
    }

    Write-Host "ZIP (Source):     $zipPath"
    Write-Host "XPI (Firefox):    $xpiPath"
    Write-Host "Fertig."
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}