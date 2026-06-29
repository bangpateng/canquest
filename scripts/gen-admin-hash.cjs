#!/usr/bin/env node
// Generate a bcrypt hash for ADMIN_PANEL_PASSWORD_HASH.
//
// Usage (picks the password from ADMIN_PW env so it never hits shell history):
//   ADMIN_PW='your-strong-password' node scripts/gen-admin-hash.cjs
//
// Or interactive prompt (reads stdin line by line):
//   node scripts/gen-admin-hash.cjs
//
// Output: the bcrypt hash on its own line, ready to paste into .env.

const bcrypt = require('bcrypt');

async function main() {
  let password = process.env.ADMIN_PW;

  if (!password) {
    // Interactive prompt via readline (more reliable on Windows/Git Bash
    // than raw process.stdin.on('data') in node -e mode).
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    password = await new Promise((resolve) => {
      rl.question('Password admin baru: ', (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  password = (password || '').trim();
  if (password.length < 8) {
    console.error('ERROR: password minimal 8 karakter.');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  console.log('\n=== Salin hash di bawah ini ke ADMIN_PANEL_PASSWORD_HASH= ===');
  console.log(hash);
  console.log('=== (JANGAN salin password aslinya ke .env) ===\n');
  console.log('Verifikasi (harus true):', bcrypt.compareSync(password, hash));
}

main();
