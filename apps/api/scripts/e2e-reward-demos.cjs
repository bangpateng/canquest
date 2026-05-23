/**
 * End-to-end smoke test for all five [DEMO] reward quests.
 *
 * Prereqs:
 *   - Docker postgres + redis, API on :3001, SSH tunnel :7575
 *   - node scripts/seed-reward-demo-quests.cjs --replace
 *   - node scripts/create-demo-test-users.cjs
 *   - Each demo user has a Canton wallet (cantonPartyId + username)
 *
 * Usage:
 *   node scripts/e2e-reward-demos.cjs
 *   node scripts/e2e-reward-demos.cjs --prepare          # seed + create users first
 *   node scripts/e2e-reward-demos.cjs --only cc,fcfs,mix
 *   node scripts/e2e-reward-demos.cjs --admin-draw       # run random draw after demo-random submits
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
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

const PASSWORD = 'TestPass123!';
const PREFIX = '[DEMO]';
const apiBase = `http://127.0.0.1:${process.env.PORT || 3001}/api`;

const CASES = [
  {
    key: 'cc',
    email: 'demo-cc@test.local',
    questTitle: `${PREFIX} Reward CC`,
    expectState: 'cc_reward',
    needsDraw: false,
  },
  {
    key: 'waitlist',
    email: 'demo-waitlist@test.local',
    questTitle: `${PREFIX} Reward Waitlist`,
    expectState: 'waitlist',
    needsDraw: false,
  },
  {
    key: 'random',
    email: 'demo-random@test.local',
    questTitle: `${PREFIX} Invite Random Draw`,
    expectState: 'winner',
    needsDraw: true,
  },
  {
    key: 'fcfs',
    email: 'demo-fcfs@test.local',
    questTitle: `${PREFIX} Invite FCFS`,
    expectState: 'winner_fcfs',
    needsDraw: false,
    expectInvite: true,
  },
  {
    key: 'mix',
    email: 'demo-mix@test.local',
    questTitle: `${PREFIX} CC + Invite FCFS`,
    expectState: 'winner_fcfs',
    needsDraw: false,
    expectInvite: true,
  },
];

const args = process.argv.slice(2);
const prepare = args.includes('--prepare');
const adminDraw = args.includes('--admin-draw');
let onlyKeys = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--only' && args[i + 1] && !args[i + 1].startsWith('--')) {
    onlyKeys = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
    break;
  }
  if (args[i].startsWith('--only=')) {
    onlyKeys = args[i].slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    break;
  }
}

async function checkHealth() {
  try {
    const res = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (e) {
    console.error('API not reachable at', apiBase, '-', String(e.message || e));
    console.error('Start: scripts/run-local-dev.ps1 (Docker + API + web)');
    return false;
  }
}

async function checkCanton() {
  const url = (process.env.CANTON_JSON_API_URL || 'http://127.0.0.1:7575').replace(/\/$/, '');
  try {
    const res = await fetch(`${url}/livez`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function login(email, password, admin = false) {
  const route = admin ? '/admin/auth/login' : '/auth/login';
  const res = await fetch(`${apiBase}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${route} ${res.status}: ${JSON.stringify(body)}`);
  return body.accessToken;
}

async function resetDemoState(prisma, userId, questId) {
  await prisma.questSubmission.deleteMany({ where: { userId, questId } });
  await prisma.questCompletion.deleteMany({ where: { userId, questId } });
  await prisma.winnerDraw.deleteMany({ where: { userId, questId } });
  await prisma.inviteCodePool.updateMany({
    where: { questId, userId },
    data: { userId: null, assignedAt: null },
  });
}

function taskProof(task, user) {
  const t = task.type === 'telegram_join' ? 'telegram_channel' : task.type;
  if (t === 'submit_party_id' || t === 'submit_canton_address') {
    return user.cantonPartyId || process.env.DEMO_CANTON_PARTY || '';
  }
  if (t === 'submit_email') return user.email;
  return undefined;
}

async function runCase(prisma, spec, adminToken) {
  const lines = [];
  const log = (msg) => {
    lines.push(msg);
    console.log(msg);
  };

  const user = await prisma.user.findUnique({ where: { email: spec.email } });
  if (!user) {
    log(`FAIL ${spec.key}: user missing — run create-demo-test-users.cjs`);
    return { key: spec.key, ok: false, lines };
  }

  const quest = await prisma.quest.findFirst({
    where: { title: spec.questTitle },
    include: { tasks: { orderBy: { order: 'asc' } } },
  });
  if (!quest) {
    log(`FAIL ${spec.key}: quest missing — run seed-reward-demo-quests.cjs`);
    return { key: spec.key, ok: false, lines };
  }

  if (!user.cantonPartyId || !user.username) {
    log(`FAIL ${spec.key}: no Canton wallet for ${spec.email} (login app → create wallet)`);
    return { key: spec.key, ok: false, lines };
  }

  await resetDemoState(prisma, user.id, quest.id);
  log(`\n=== ${spec.key.toUpperCase()} — ${quest.title} ===`);

  const token = await login(spec.email, PASSWORD);

  for (const task of quest.tasks) {
    const proof = taskProof(task, user);
    const res = await fetch(`${apiBase}/quests/${quest.id}/tasks/${task.id}/submit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(proof ? { proof } : {}),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      log(`  task FAIL ${task.type}: ${res.status} ${JSON.stringify(body)}`);
      return { key: spec.key, ok: false, lines };
    }
    log(`  task OK ${task.type} → ${body.status}`);
  }

  const submitRes = await fetch(`${apiBase}/quests/${quest.id}/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const submitBody = await submitRes.json();
  if (!submitRes.ok || !submitBody.ok) {
    log(`  submit FAIL: ${submitRes.status} ${JSON.stringify(submitBody)}`);
    return { key: spec.key, ok: false, lines };
  }

  log(`  submit OK rewardCc=${submitBody.rewardCc} invite=${submitBody.inviteCode ?? '—'}`);
  if (submitBody.ledger?.participationContractId) {
    log(`  ledger participation=${submitBody.ledger.participationContractId.slice(0, 20)}…`);
  } else if (submitBody.ledger?.errors?.length) {
    log(`  ledger warnings: ${submitBody.ledger.errors.join('; ')}`);
  }

  if (spec.needsDraw) {
    let drew = false;
    if (adminToken) {
      const drawRes = await fetch(`${apiBase}/admin/quests/${quest.id}/draw-winners`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userIds: [user.id] }),
      });
      const drawBody = await drawRes.json();
      if (drawRes.ok) {
        drew = true;
        log(`  admin draw OK winners=${drawBody.added ?? drawBody.winners?.length ?? '?'}`);
      } else {
        log(`  admin draw FAIL: ${drawRes.status} — trying DB fallback`);
      }
    }
    if (!drew) {
      const code = await prisma.inviteCodePool.findFirst({
        where: { questId: quest.id, userId: null },
        orderBy: { createdAt: 'asc' },
      });
      if (!code) {
        log('  draw FAIL: no invite codes in pool');
        return { key: spec.key, ok: false, lines };
      }
      await prisma.$transaction([
        prisma.inviteCodePool.update({
          where: { id: code.id },
          data: { userId: user.id, assignedAt: new Date() },
        }),
        prisma.winnerDraw.upsert({
          where: { questId_userId: { questId: quest.id, userId: user.id } },
          create: {
            questId: quest.id,
            userId: user.id,
            ccAmount: quest.rewardCc,
            inviteCode: code.code,
            distributed: false,
          },
          update: { inviteCode: code.code },
        }),
      ]);
      log(`  DB draw fallback OK code=${code.code}`);
    }
  }

  const rsRes = await fetch(`${apiBase}/quests/${quest.id}/reward-status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rewardStatus = await rsRes.json();

  const stateOk = rewardStatus.state === spec.expectState;
  const inviteOk = !spec.expectInvite || !!rewardStatus.inviteCode;
  const ok = stateOk && inviteOk;

  log(
    `  reward-status: state=${rewardStatus.state} invite=${rewardStatus.inviteCode ?? '—'} ${ok ? 'PASS' : 'FAIL (expected ' + spec.expectState + ')'}`,
  );

  return { key: spec.key, ok, lines, rewardStatus, submitBody };
}

async function main() {
  if (prepare) {
    console.log('Running seed + demo users…');
    execSync('node scripts/seed-reward-demo-quests.cjs --replace', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });
    execSync('node scripts/create-demo-test-users.cjs', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });
  }

  if (!(await checkHealth())) process.exit(1);

  const cantonOk = await checkCanton();
  console.log('Canton ledger API:', cantonOk ? 'OK' : 'DOWN (submit will skip on-chain contracts)');

  let adminToken = null;
  if (adminDraw) {
    const email = process.env.ADMIN_PANEL_EMAIL;
    const password = process.env.ADMIN_PANEL_PASSWORD;
    if (!email || !password) {
      console.error('Set ADMIN_PANEL_EMAIL and ADMIN_PANEL_PASSWORD in apps/api/.env');
      process.exit(1);
    }
    adminToken = await login(email, password, true);
    console.log('Admin panel login OK');
  }

  const prisma = new PrismaClient();
  const selected = onlyKeys
    ? CASES.filter((c) => onlyKeys.includes(c.key))
    : CASES;

  if (selected.length === 0) {
    console.error('No cases matched --only filter');
    process.exit(1);
  }

  const results = [];
  for (const spec of selected) {
    results.push(await runCase(prisma, spec, adminToken));
  }

  await prisma.$disconnect();

  console.log('\n=== Summary ===');
  let passed = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.key}`);
    if (r.ok) passed++;
  }
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
