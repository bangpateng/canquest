/**
 * disposable-email.ts
 *
 * Dua lapis pertahanan anti-sybil saat registrasi:
 *
 * 1. ALLOWLIST domain webmail utama (gmail, yahoo, outlook, icloud, proton).
 *    Hanya email dari provider ini yang boleh daftar → menutup jalan nuyul
 *    referral pakai email catch-all / domain custom / provider kecil.
 * 2. BLOCKLIST domain sekali-pakai (throwaway) sebagai jaring pengaman.
 *
 * Catatan: allowlist lebih ketat dari blocklist. Blocklist sendiri tidak lengkap —
 * fokus ke provider yang paling sering dipakai. Untuk cakupan luas, fase berikutnya
 * bisa pakai daftar eksternal yang ter-maintain (mis. npm 'disposable-email-domains').
 */

const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  '0-mail.com',
  '10minutemail.com',
  '10minutemail.net',
  '10minutemail.org',
  '123mail.com',
  '1secmail.com',
  '1secmail.org',
  '20minutemail.com',
  '2prong.com',
  '33mail.com',
  '4mail.cf',
  '5mail.cf',
  '6mail.cf',
  '7mail.cf',
  '8mail.cf',
  '9mail.cf',
  'airmailbox.website',
  'anonbox.net',
  'anonymous-mail.com',
  'armyspy.com',
  'binkmail.com',
  'bio-muesli.com',
  'burnermail.io',
  'crazy mailbox.com',
  'cubiclink.com',
  'curryworld.de',
  'dayrep.com',
  'dcemail.com',
  'deadaddress.com',
  'despam.it',
  'dispostable.com',
  'dmail.university.edu',
  'dropoutlove.com',
  'edu.ufo.cx',
  'email-temp.com',
  'emailfake.com',
  'emailondeck.com',
  'emaillime.com',
  'emailsingularity.net',
  'example.com',
  'fakeinbox.com',
  'fakedemail.com',
  'filmakl.com',
  'freemail.tweakly.net',
  'getairmail.com',
  'getnada.com',
  'getairmail.net',
  'gishpuppy.com',
  'gowikibooks.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamailblock.com',
  'grr.la',
  'housat.com',
  'inboxbear.com',
  'inboxproxy.com',
  'junk1.com',
  'kasmail.com',
  'killmail.com',
  'klzlk.com',
  'lhsdv.com',
  'lifebyfood.com',
  'loketa.com',
  'lortemail.dk',
  'mail-temp.com',
  'mail.by',
  'mailcatch.com',
  'maildrop.cc',
  'maildrop.cf',
  'maildrop.ga',
  'mailfa.tk',
  'mailfall.com',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mailnull.com',
  'mailpoof.com',
  'mailshell.com',
  'maze.com',
  'meltmail.com',
  'messagebeamer.de',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'monumentmail.com',
  'msb.mefound.com',
  'mt2009.com',
  'mytemp.email',
  'mytrashmail.com',
  'nada.email',
  'nada.ltd',
  'neomailbox.com',
  'nepwk.com',
  'onewaymail.com',
  'online.ms',
  'ovpn.to',
  'pacipic.com',
  'page.pressford.org',
  'pancakemail.com',
  'papierkorb.me',
  'pay-mon.com',
  'paypal-verify.com',
  'pjjkp.com',
  'polarkingthemLots.com',
  'pooae.com',
  'pukims.com',
  'putthisinyourspamdatabase.com',
  'quickinbox.cc',
  'rcs.gaggle.net',
  'recruitume.com',
  'recolic.net',
  'reftoken.net',
  'regbypass.com',
  'rhyta.com',
  'rustydoor.com',
  'safenord.com',
  'samsclass.info',
  'scatmail.com',
  'selfdestructingmail.com',
  'sendfree.org',
  'sharklasers.com',
  'shitmail.me',
  'skeefmail.com',
  'slopsbox.com',
  'smwg.info',
  'sogetthis.com',
  'spam4.me',
  'spamgourmet.com',
  'spamtrap.ro',
  'stopmyspam.com',
  'supergreatmail.com',
  'supermailer.jp',
  'suremail.info',
  'tafmail.com',
  'teewars.org',
  'telewagon.com',
  'temp-mail.org',
  'temp-mail.ru',
  'tempail.com',
  'tempinbox.com',
  'tempmail.com',
  'tempmail.dev',
  'tempmail.net',
  'tempmailo.com',
  'tempr.email',
  'tempymail.com',
  'throwam.com',
  'throwawaymail.com',
  'throwawaymailaddress.com',
  'tipcakes.com',
  'tmails.net',
  'tradermail.info',
  'trash-mail.at',
  'trashmail.com',
  'trashmail.de',
  'trashmail.net',
  'trashmail.ws',
  'twinmail.de',
  'tyldd.com',
  'uggsrock.com',
  'up.edu',
  'validemail.net',
  'vipmail.name',
  'vipmail.pw',
  'vomoto.com',
  'vpn.st',
  'webm4il.info',
  'wfgdfhj.tk',
  'wickmail.net',
  'wmail.club',
  'wuzup.net',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'you-spam.com',
  'z1p.biz',
  'zehnminutenmail.de',
  'zetmail.com',
  'zippymail.info',
  'zoaxe.com',
]);

/**
 * Allowlist domain webmail permanen yang dipercaya.
 * Hanya email dari domain ini yang diperbolehkan mendaftar.
 * Lowercase, tanpa '@'.
 */
const ALLOWED_EMAIL_DOMAINS = new Set<string>([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.id',
  'yahoo.co.uk',
  'yahoo.ca',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.es',
  'yahoo.com.br',
  'yahoo.com.au',
  'yandex.com',
  'yandex.ru',
  'outlook.com',
  'outlook.co.id',
  'hotmail.com',
  'hotmail.co.id',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
]);

/** Ambil domain (lowercase) dari email. String kosong jika tidak valid. */
export function getDomainFromEmail(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

/**
 * true jika domain email termasuk provider sekali-pakai yang diblokir.
 * Aman dipanggil dengan input apa pun (mengembalikan false untuk input tak valid).
 */
export function isDisposableEmail(email: string | null | undefined): boolean {
  const domain = getDomainFromEmail(email);
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/** Untuk dipakai admin/observability: cek domain mentah. */
export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/**
 * true jika domain email termasuk allowlist webmail permanen.
 * Aman dipanggil dengan input apa pun (mengembalikan false untuk input tak valid).
 */
export function isAllowedEmailDomain(
  email: string | null | undefined,
): boolean {
  const domain = getDomainFromEmail(email);
  if (!domain) return false;
  return ALLOWED_EMAIL_DOMAINS.has(domain);
}

/** true jika domain mentah ada di allowlist. */
export function isAllowedDomain(domain: string): boolean {
  return ALLOWED_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/** Daftar domain allowlist (untuk ditampilkan ke UI / pesan error). */
export function getAllowedEmailDomainList(): string[] {
  return [...ALLOWED_EMAIL_DOMAINS];
}

/** Hasil validasi email saat registrasi. */
export type EmailValidationResult =
  | { ok: true }
  | { ok: false; reason: 'disposable' | 'not_allowed'; message: string };

/**
 * Validasi email saat registrasi: blok disposable, lalu cek allowlist.
 * Mengembalikan pesan error yang siap dipakai BadRequestException.
 */
export function validateRegistrationEmail(
  email: string | null | undefined,
): EmailValidationResult {
  if (isDisposableEmail(email)) {
    return {
      ok: false,
      reason: 'disposable',
      message: 'Please use a permanent email address.',
    };
  }
  if (!isAllowedEmailDomain(email)) {
    return {
      ok: false,
      reason: 'not_allowed',
      message:
        'Only Gmail, Yahoo, Outlook, Hotmail, Live, iCloud, Proton, or Yandex emails are allowed.',
    };
  }
  return { ok: true };
}
