/**
 * disposable-email.ts
 *
 * Blocklist ringan untuk domain email sekali-pakai / throwaway, dipakai saat registrasi
 * untuk menaikkan biaya pembuatan banyak akun (anti-sybil dasar).
 *
 * Catatan: ini BUKAN daftar lengkap — fokus ke provider yang paling sering dipakai.
 * Untuk cakupan luas, fase berikutnya bisa pakai daftar eksternal yang ter-maintain
 * (mis. paket npm 'disposable-email-domains') atau layanan verifikasi email.
 */

const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonbox.net',
  'burnermail.io',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamailblock.com',
  'grr.la',
  'inboxbear.com',
  'mail-temp.com',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mailpoof.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'nada.email',
  'sharklasers.com',
  'spam4.me',
  'temp-mail.org',
  'tempmail.com',
  'tempmail.dev',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.net',
]);

/**
 * true jika domain email termasuk provider sekali-pakai yang diblokir.
 * Aman dipanggil dengan input apa pun (mengembalikan false untuk input tak valid).
 */
export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/** Untuk dipakai admin/observability: cek domain mentah. */
export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}
