#!/usr/bin/env bash
# Upload dump backup lokal VPS 2 → Google Drive (remote rclone "gdrive").
# Dijalankan cron terpisah SETELAH backup-postgres-r2.cjs selesai (03:00),
# mis. jam 03:15 — lihat docs/BACKUP_RESTORE.md.
#
# Prasyarat (sekali saja):
#   1. rclone terinstall di VPS:  curl https://rclone.org/install.sh | sudo bash
#   2. Remote "gdrive" terkonfigurasi:  rclone config
#      (headless: jawab "n" di auto config, jalankan `rclone authorize "drive"`
#       di komputer yang ada browser, paste token-nya ke sini)
#   3. Test:  rclone ls gdrive:canquest-backups
#
# Cron (crontab -e):
#   15 3 * * * /var/www/canquest/scripts/backup-to-gdrive.sh >> /var/log/canquest-backup-gdrive.log 2>&1
set -euo pipefail

LOCAL_DIR="/var/backups/canquest"           # dir output backup-postgres-r2.cjs
REMOTE="gdrive:canquest-backups/postgres"
KEEP_REMOTE_DAYS=30

# 1. Copy semua dump lokal ke Drive (rclone skip file yang sudah ada — idempotent)
rclone copy "$LOCAL_DIR" "$REMOTE" --include "*.dump"

# 2. Rotasi Drive: hapus yang lebih tua dari KEEP_REMOTE_DAYS
rclone delete "$REMOTE" --min-age "${KEEP_REMOTE_DAYS}d"

echo "$(date '+%F %T') gdrive sync OK → $REMOTE"
