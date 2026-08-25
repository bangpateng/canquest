# Tarik dump backup CanQuest dari Google Drive ke PC Windows (salinan lokal ketiga).
# Prasyarat (sekali saja):
#   1. rclone terinstall:  winget install Rclone.Rclone   (atau download rclone.org)
#   2. Remote "gdrive" terkonfigurasi di PC ini:  rclone config
#      (di PC ada browser — flow-nya otomatis, tinggal login Google)
#
# Jalankan manual untuk test:
#   powershell -ExecutionPolicy Bypass -File scripts\pull-backups-gdrive.ps1
#
# Otomatis harian via Task Scheduler (PowerShell, jalankan sekali):
#   schtasks /Create /TN "CanQuest Backup Sync" /SC DAILY /ST 09:00 /TR ^
#     "powershell.exe -ExecutionPolicy Bypass -File \"C:\Users\Bang Pateng\Documents\can\scripts\pull-backups-gdrive.ps1\""
$ErrorActionPreference = "Stop"

# Tujuan lokal — ubah kalau mau ke drive lain, mis. "D:\Backups\canquest"
$dest = "$env:USERPROFILE\Backups\canquest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# Salin dump dari Drive (yang sudah ada di lokal di-skip, jadi cepat)
rclone copy "gdrive:canquest-backups/postgres" $dest --include "*.dump"

# Rotasi lokal: simpan 14 file terbaru saja
Get-ChildItem $dest -Filter *.dump |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 14 |
  Remove-Item -Force

Write-Host "Sinkron selesai. File lokal ($dest):"
Get-ChildItem $dest -Filter *.dump | Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 Name, @{N = "MB"; E = { [math]::Round($_.Length / 1MB, 2) } }
