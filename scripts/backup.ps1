<#
.SYNOPSIS
  Backup de la base de meta31 con pg_dump (RNF-12). Lo corre el Programador de tareas de Windows.

.DESCRIPTION
  - Lee DATABASE_URL de un archivo fuera del repo (por defecto %USERPROFILE%\.meta31\backup.env).
  - Vuelca los esquemas public (datos) y drizzle (historial de migraciones) en formato custom (-Fc, comprimido).
    Los esquemas que administra Supabase (auth, storage, etc.) no se incluyen.
  - Guarda en una carpeta sincronizada con OneDrive y conserva los últimos $Keep archivos.
  - Deja un log en la misma carpeta.
  Restaurar: pg_restore --clean --if-exists --no-owner --no-privileges -d "<DATABASE_URL>" <archivo>.dump

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup.ps1
#>
param(
  [string]$EnvFile = (Join-Path $env:USERPROFILE '.meta31\backup.env'),
  [string]$Destination = (Join-Path $env:OneDrive 'Backups\meta31'),
  [string]$PgDump = 'pg_dump',
  [int]$Keep = 12
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Destination)) { New-Item -ItemType Directory -Force $Destination | Out-Null }
$log = Join-Path $Destination 'backup.log'

function Write-Log([string]$message) {
  $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $message
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Output $line
}

try {
  if (-not (Test-Path $EnvFile)) { throw "No existe $EnvFile (ver docs/setup.md)" }
  $databaseUrl = (Get-Content $EnvFile -Encoding utf8 |
    Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
    Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*', ''
  if (-not $databaseUrl) { throw "Falta DATABASE_URL en $EnvFile" }

  $file = Join-Path $Destination ('meta31-{0:yyyy-MM-dd_HHmm}.dump' -f (Get-Date))
  & $PgDump --format=custom --no-owner --no-privileges --schema=public --schema=drizzle `
    --file=$file $databaseUrl
  if ($LASTEXITCODE -ne 0) { throw "pg_dump terminó con código $LASTEXITCODE" }

  $size = [math]::Round((Get-Item $file).Length / 1KB, 1)
  Write-Log "OK $file ($size KB)"

  Get-ChildItem $Destination -Filter 'meta31-*.dump' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep |
    ForEach-Object { Remove-Item $_.FullName; Write-Log "Borrado por antigüedad: $($_.Name)" }
}
catch {
  Write-Log "ERROR $($_.Exception.Message)"
  exit 1
}
