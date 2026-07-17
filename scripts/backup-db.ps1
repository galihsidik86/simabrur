# Backup PostgreSQL Safar (format custom pg_dump) -> backups/safar-<timestamp>.dump
param(
  [string]$Container = "safar-db",
  [string]$DbUser = "safar",
  [string]$DbName = "safar"
)
$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$outDir = Join-Path $PSScriptRoot "..\backups"
New-Item -ItemType Directory -Force $outDir | Out-Null
$outFile = Join-Path $outDir "safar-$stamp.dump"

docker exec $Container pg_dump -U $DbUser -d $DbName -Fc -f /tmp/safar-backup.dump
docker cp "${Container}:/tmp/safar-backup.dump" $outFile
docker exec $Container rm -f /tmp/safar-backup.dump
Write-Host "Backup tersimpan: $outFile ($([math]::Round((Get-Item $outFile).Length/1KB)) KB)"
