#!/usr/bin/env node
/**
 * Generate TOTP secret untuk login admin panel (2FA).
 *
 * Cara pakai:
 *   node scripts/gen-admin-totp.cjs admin@canquest.cc
 *
 * Output:
 *   - ADMIN_TOTP_SECRET (base32) → salin ke apps/api/.env (atau env VPS API)
 *   - otpauth:// URI + QR ASCII di terminal → scan dengan authenticator app.
 *     JANGAN pakai layanan QR online (quickchart.io dll) — secret akan bocor
 *     ke pihak ketiga. QR di sini dirender lokal oleh qrcode-terminal.
 *
 * Setelah secret diset: restart API. Login admin di production MENOLAK
 * request tanpa ADMIN_TOTP_SECRET (fail-closed) — jangan deploy lupa ini.
 *
 * Rotasi: jalankan ulang script ini dengan email sama, ganti nilai
 * ADMIN_TOTP_SECRET, restart API, lalu hapus entry lama di authenticator.
 */
'use strict';

const crypto = require('crypto');

const email = (process.argv[2] || process.env.ADMIN_PANEL_EMAIL || '')
  .trim()
  .toLowerCase();

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(
    'Usage: node scripts/gen-admin-totp.cjs <ADMIN_PANEL_EMAIL>\n' +
      '(atau set env ADMIN_PANEL_EMAIL lalu jalankan tanpa argumen)',
  );
  process.exit(1);
}

// 20 byte = 160 bit — standar TOTP (RFC 6238) untuk SHA1/6 digit/30 detik.
const secretBytes = crypto.randomBytes(20);
const base32 = base32Encode(secretBytes);

function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

const issuer = encodeURIComponent('CanQuest Admin');
const label = encodeURIComponent(email);
const uri = `otpauth://totp/${issuer}:${label}?secret=${base32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

console.log('=== Admin TOTP 2FA setup ===');
console.log();
console.log('1) Scan QR ini dengan authenticator app (Google Authenticator, Authy, 1Password):');
console.log();

// QR dirender lokal (qrcode-terminal). Kalau module tidak ada (mis. dijalankan
// di luar repo), fallback: entry manual pakai secret base32 di bawah.
try {
  const qrcode = require('qrcode-terminal');
  qrcode.generate(uri, { small: true });
} catch {
  console.log('    (qrcode-terminal tidak terpasang — pakai manual entry di bawah)');
}

console.log();
console.log(`    otpauth URI: ${uri}`);
console.log(`    Secret (base32, manual entry): ${base32}`);
console.log('    Manual entry: Google Authenticator → + → Enter a setup key →');
console.log('    Account: CanQuest Admin / <email>, Key: secret di atas, Time-based: ON');
console.log();
console.log('2) Set di env API (apps/api/.env di VPS):');
console.log();
console.log(`    ADMIN_TOTP_SECRET=${base32}`);
console.log();
console.log('3) Restart API, lalu login admin dengan email + password + kode 6 digit.');
console.log();
console.log('JANGAN commit nilai di atas ke repo manapun.');
