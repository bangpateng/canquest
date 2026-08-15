/**
 * Full quest ledger smoke test (participation + 1 task). Usage:
 *   node scripts/test-quest-ledger-full.cjs <userCantonPartyId>
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

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
      if (cur.CreatedTreeEvent || cur.CreatedEvent || cur.createdEvent) return cur.contractId;
      if (cur.templateId || cur.createArgument) return cur.contractId;
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
const userParty = process.argv[2];

if (!userParty || !pkg || !operator) {
  console.error('Usage: node scripts/test-quest-ledger-full.cjs <userCantonPartyId>');
  process.exit(1);
}

const token = jwt.sign({ sub: user, aud: audience }, secret, { algorithm: 'HS256', expiresIn: '5m' });
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const actAs = [operator];

async function create(label, templateId, createArguments) {
  const res = await fetch(`${baseUrl}/v2/commands/submit-and-wait-for-transaction-tree`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      commands: [{ CreateCommand: { templateId, createArguments } }],
      userId: user,
      commandId: `smoke-${label}-${Date.now()}`,
      actAs,
      readAs: actAs,
    }),
  });
  const text = await res.text();
  const cid = res.ok ? extractContractId(text) : null;
  console.log(label, res.status, cid ? `contractId=${cid.slice(0, 24)}...` : text.slice(0, 200));
  return { ok: res.ok, contractId: cid };
}

(async () => {
  const participation = await create(
    'participation',
    `${pkg}:Main:QuestParticipation`,
    { operator, user: userParty, questId: 'smoke-quest', startedAt: new Date().toISOString() },
  );
  const task = await create('task', `${pkg}:Main:QuestTaskSubmission`, {
    operator,
    user: userParty,
    questId: 'smoke-quest',
    taskId: 'smoke-task-1',
    proof: 'smoke',
    submittedAt: new Date().toISOString(),
    verified: true,
  });
  console.log('\nSummary:', { participation: participation.contractId, task: task.contractId });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
