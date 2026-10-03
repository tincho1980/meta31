<#
.SYNOPSIS
  meta31 database backup with pg_dump (RNF-12). Run by the Windows Task Scheduler.

.DESCRIPTION
  - Reads DATABASE_URL from a file outside the repo (default: %USERPROFILE%\.meta31\backup.env).
  - Dumps the public (data) and drizzle (migration history) schemas in custom format (-Fc, compressed).
    Schemas managed by Supabase (auth, storage, etc.) are not included.
  - Saves to a folder synced with OneDrive and keeps the latest $Keep files.
  - Writes a log in the same folder.
  Restore: pg_restore --clean --if-exists --no-owner --no-privileges -d "<DATABASE_URL>" <file>.dump

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
  if (-not (Test-Path $EnvFile)) { throw "$EnvFile does not exist (see docs/setup.md)" }
  $databaseUrl = (Get-Content $EnvFile -Encoding utf8 |
    Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
    Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*', ''
  if (-not $databaseUrl) { throw "DATABASE_URL missing in $EnvFile" }

  $file = Join-Path $Destination ('meta31-{0:yyyy-MM-dd_HHmm}.dump' -f (Get-Date))
  & $PgDump --format=custom --no-owner --no-privileges --schema=public --schema=drizzle `
    --file=$file $databaseUrl
  if ($LASTEXITCODE -ne 0) { throw "pg_dump exited with code $LASTEXITCODE" }

  $size = [math]::Round((Get-Item $file).Length / 1KB, 1)
  Write-Log "OK $file ($size KB)"

  Get-ChildItem $Destination -Filter 'meta31-*.dump' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep |
    ForEach-Object { Remove-Item $_.FullName; Write-Log "Deleted (retention): $($_.Name)" }
}
catch {
  Write-Log "ERROR $($_.Exception.Message)"
  exit 1
}
