/**
 * Replay ledger writes for a quest like QuestLedgerService does.
 * Usage: node scripts/replay-quest-ledger.cjs <questId> <userPartyId>
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const TPL = {
  QuestParticipation: 'CanQuest.Quest.Participation:QuestParticipation',
  QuestTaskSubmission: 'CanQuest.Quest.Task:QuestTaskSubmission',
  QuestCompletion: 'CanQuest.Quest.Completion:QuestCompletion',
};

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

function extractContractId(text) {
  const stack = [JSON.parse(text)];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (const x of cur) stack.push(x);
      continue;
    }
    if (typeof cur.contractId === 'string' && cur.contractId) {
      if (cur.CreatedTreeEvent || cur.CreatedEvent || cur.createArgument) return cur.contractId;
    }
    for (const v of Object.values(cur)) stack.push(v);
  }
  return null;
}

loadEnv();

const baseUrl = (process.env.CANTON_JSON_API_URL || 'http://127.0.0.1:7575').replace(/\/$/, '');
const secret = process.env.CANTON_SPLICE_SECRET || 'unsafe';
const audience = process.env.CANTON_LEDGER_API_AUDIENCE || 'https://canton.network.global';
const user = process.env.CANTON_LEDGER_API_USER || 'ledger-api-user';
const pkg = process.env.CANTON_DAML_PACKAGE_ID;
const operator = process.env.CANTON_OPERATOR_PARTY_ID || process.env.CANTON_VALIDATOR_PARTY_ID;
const questId = process.argv[2];
const userParty = process.argv[3];

async function create(label, templateSuffix, createArguments, commandId) {
  const templateId = `${pkg}:${templateSuffix}`;
  const res = await fetch(`${baseUrl}/v2/commands/submit-and-wait-for-transaction-tree`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt.sign({ sub: user, aud: audience }, secret, { algorithm: 'HS256', expiresIn: '5m' })}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      commands: [{ CreateCommand: { templateId, createArguments } }],
      userId: user,
      commandId,
      actAs: [operator],
      readAs: [operator],
    }),
  });
  const text = await res.text();
  const contractId = res.ok ? extractContractId(text) : null;
  console.log('\n', label, 'HTTP', res.status, 'contractId', contractId ? 'OK' : 'MISSING');
  if (!res.ok) console.log(text.slice(0, 400));
  else if (!contractId) console.log('body head:', text.slice(0, 200));
  return { ok: res.ok, contractId, error: res.ok ? null : text };
}

async function main() {
  if (!questId || !userParty) {
    console.error('Usage: node scripts/replay-quest-ledger.cjs <questId> <userPartyId>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const quest = await prisma.quest.findUnique({
    where: { id: questId },
    include: { tasks: true },
  });
  if (!quest) {
    console.error('Quest not found');
    process.exit(1);
  }
  const subs = await prisma.questSubmission.findMany({
    where: { questId, status: 'VERIFIED' },
    take: 5,
  });
  const questKind = quest.questKind === 'EARN_HUB' ? 'EARN_HUB' : 'CAMPAIGN';
  const now = new Date().toISOString();
  console.log('Quest', quest.title, 'tasks', quest.tasks.length);

  await create(
    'participation',
    TPL.QuestParticipation,
    {
      operator,
      user: userParty,
      questId,
      questKind,
      startedAt: now,
    },
    `quest-participation-${questId}-${userParty}`,
  );

  for (const task of quest.tasks) {
    const sub = subs.find((s) => s.taskId === task.id);
    await create(
      `task ${task.id}`,
      TPL.QuestTaskSubmission,
      {
        operator,
        user: userParty,
        questId,
        taskId: task.id,
        taskType: task.type,
        proof: sub?.proof ?? '',
        submittedAt: now,
        verified: true,
      },
      `quest-task-sub-${questId}-${task.id}-${userParty}`,
    );
  }

  await create(
    'completion',
    TPL.QuestCompletion,
    {
      operator,
      user: userParty,
      questId,
      questKind,
      rewardCc: String(quest.rewardCc),
      taskCount: quest.tasks.length,
      completedAt: now,
    },
    `quest-completion-${questId}-${userParty}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
