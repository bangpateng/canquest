#!/usr/bin/env bash
# ============================================================================
# Test mode maintenance — verifikasi cepat via curl.
# Aman: hanya MEMBACA status + tes efek 503, TIDAK mengubah apa pun.
#
# Pemakaian:
#   ./scripts/test-maintenance.sh                 # pakai production
#   API=https://staging-api.example.com WEB=https://staging.example.com ./scripts/test-maintenance.sh
#
# Default:
#   API = https://api.canquest.cc
#   WEB = https://canquest.cc
# ============================================================================
set -euo pipefail

API="${API:-https://api.canquest.cc}"
WEB="${WEB:-https://canquest.cc}"

green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
line()   { printf "\n\033[1;36m══ %s ══\033[0m\n" "$*"; }

echo "API: $API"
echo "WEB: $WEB"

# ── 1. Cek status publik (harus selalu bisa diakses, walau maintenance ON) ──
line "1. STATUS MAINTENANCE (publik, GET /api/public/maintenance)"
status_json=$(curl -s "$API/api/public/maintenance" || echo '{}')
echo "$status_json"
enabled=$(echo "$status_json" | grep -o '"enabled":[a-z]*' | head -1 | cut -d: -f2)
case "$enabled" in
  true)  yellow "→ Status: MAINTENANCE AKTIF";;
  false) green "→ Status: OFF (normal)";;
  *)     red "→ Tidak bisa parsing status (cek koneksi/API)";;
esac

# ── 2. Cek bahwa endpoint publik maintenance tidak ikut diblokir ─────────────
# (self-test: GET /api/public/maintenance harus tetap 200 walau maintenance ON)
pub_code=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/public/maintenance")
if [ "$pub_code" = "200" ]; then
  green "2. GET /public/maintenance → 200 ✓ (endpoint publik tidak terblokir)"
else
  red "2. GET /public/maintenance → $pub_code ✗ (harusnya 200)"
fi

# ── 3. Cek bahwa health probe tetap hidup (penting untuk nginx/pm2) ─────────
health_code=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/health")
if [ "$health_code" = "200" ]; then
  green "3. GET /api/health → 200 ✓ (health probe tetap hidup saat ON)"
else
  red "3. GET /api/health → $health_code ✗ (harusnya 200)"
fi

# ── 4. Jika maintenance AKTIF → verifikasi efek 503 & rewrite web ───────────
if [ "$enabled" = "true" ]; then
  line "MAINTENANCE AKTIF — verifikasi efek sebenarnya"

  # a. Endpoint non-exempt (mis. leaderboard publik) harus 503
  lb_code=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/public/leaderboard")
  if [ "$lb_code" = "503" ]; then
    green "4a. GET /api/public/leaderboard → 503 ✓ (API diblokir saat ON)"
  else
    yellow "4a. GET /api/public/leaderboard → $lb_code (harusnya 503 saat ON — mungkin masih cache 5s, coba lagi)"
  fi

  # b. Body 503 harus memuat flag maintenance:true
  lb_body=$(curl -s "$API/api/public/leaderboard")
  if echo "$lb_body" | grep -q '"maintenance":true'; then
    green "4b. Body 503 memuat maintenance:true ✓ (overlay FE akan tampil instan)"
  else
    yellow "4b. Body: $lb_body"
  fi

  # c. Web (canquest.cc) harus ter-rewrite ke halaman maintenance
  web_home=$(curl -s -L "$WEB/")
  if echo "$web_home" | grep -qi "maintenance\|pemeliharaan"; then
    green "4c. Web root menampilkan layar maintenance ✓"
  else
    yellow "4c. Web root belum menampilkan layar maintenance (cache edge 5s, coba refresh)"
  fi

  # d. Web /admin HARUS tetap bisa diakses (recovery path)
  admin_code=$(curl -s -o /dev/null -w "%{http_code}" -L "$WEB/admin")
  if [ "$admin_code" = "200" ] || [ "$admin_code" = "307" ] || [ "$admin_code" = "302" ]; then
    green "4d. Web /admin → $admin_code ✓ (admin panel tetap hidup)"
  else
    red "4d. Web /admin → $admin_code ✗ (admin panel TIDAK boleh terblokir!)"
  fi
else
  line "MAINTENANCE OFF — tidak ada efek untuk dites"
  echo "Untuk mengetes efek 503 & rewrite:"
  echo "  1. Buka Admin → Settings → nyalakan toggle maintenance"
  echo "  2. Jalankan script ini lagi"
fi

line "SELESAI"
echo "Untuk ON/OFF manual: Admin → Settings → Maintenance di $WEB/admin"
