/**
 * Reset completion, login, submit quest, print Canton ledger result.
 * Usage: node scripts/e2e-quest-submit.cjs <email> <password> [questId]
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv();

const apiBase = `http://127.0.0.1:${process.env.PORT || 3001}/api`;
const email = process.argv[2]?.toLowerCase();
const password = process.argv[3];
let questId = process.argv[4];

async function main() {
  if (!email || !password) {
    console.error('Usage: node scripts/e2e-quest-submit.cjs <email> <password> [questId]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  if (!questId) {
    const q = await prisma.quest.findFirst({
      where: { title: 'tellaW' },
      select: { id: true, title: true },
    });
    questId = q?.id;
    console.log('Quest:', q?.title, questId);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error('User not found:', email);
    process.exit(1);
  }

  const deleted = await prisma.questCompletion.deleteMany({
    where: { userId: user.id, questId },
  });
  console.log('Reset completion rows deleted:', deleted.count);

  const loginRes = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await loginRes.json();
  if (!loginRes.ok) {
    console.error('Login failed', loginRes.status, loginBody);
    process.exit(1);
  }
  const token = loginBody.accessToken;
  console.log('Login OK:', email);

  const submitRes = await fetch(`${apiBase}/quests/${questId}/submit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const submitBody = await submitRes.json();
  console.log('\n=== Submit HTTP', submitRes.status, '===');
  console.log(JSON.stringify(submitBody, null, 2));

  const completion = await prisma.questCompletion.findUnique({
    where: { userId_questId: { userId: user.id, questId } },
  });
  console.log('\n=== DB completion ===');
  console.log(completion);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
