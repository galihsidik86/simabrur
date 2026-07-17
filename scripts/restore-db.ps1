# Restore backup pg_dump custom: npm run db:restore -- -File backups/safar-xxxx.dump
param(
  [Parameter(Mandatory = $true)][string]$File,
  [string]$Container = "safar-db",
  [string]$DbUser = "safar",
  [string]$DbName = "safar"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $File)) { throw "File backup tidak ditemukan: $File" }

Write-Host "PERINGATAN: restore akan MENIMPA database '$DbName' di kontainer '$Container'."
$confirm = Read-Host "Ketik 'ya' untuk melanjutkan"
if ($confirm -ne "ya") { Write-Host "Dibatalkan."; exit 1 }

docker cp $File "${Container}:/tmp/safar-restore.dump"
docker exec $Container pg_restore -U $DbUser -d $DbName --clean --if-exists /tmp/safar-restore.dump
docker exec $Container rm -f /tmp/safar-restore.dump
Write-Host "Restore selesai dari: $File"
