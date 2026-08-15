/**
 * Read users directly from SQLite dev.db (bypasses Prisma schema provider).
 * Usage: node scripts/read-sqlite.cjs
 */
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'prisma', 'dev.db');

if (!fs.existsSync(dbPath)) {
  console.error('❌ dev.db not found at:', dbPath);
  process.exit(1);
}

try {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });

  console.log('\n=== USERS ===');
  const users = db.prepare('SELECT id, email, "displayName", username, "emailVerified", "isAdmin", "createdAt" FROM User').all();
  console.table(users);

  console.log('\n=== CC BALANCES ===');
  const balances = db.prepare('SELECT u.email, b."balanceMicroCc", CAST(b."balanceMicroCc" AS REAL)/1000000 as "CC" FROM CcBalance b JOIN User u ON u.id = b."userId"').all();
  console.table(balances);

  db.close();
} catch (e) {
  // better-sqlite3 not available, fall back to printing raw SQL to run manually
  console.log('better-sqlite3 not available. Run this manually:\n');
  console.log(`sqlite3 "${dbPath}" "SELECT id, email, displayName, username FROM User;"`);
  console.log(`sqlite3 "${dbPath}" "SELECT userId, balanceMicroCc FROM CcBalance;"`);
}
