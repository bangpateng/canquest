/**
 * Debug quest DAML creates on ledger.
 * Usage: node scripts/test-quest-ledger-create.cjs <userPartyId> [operatorPartyId]
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

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

const baseUrl = (process.env.CANTON_JSON_API_URL || 'http://127.0.0.1:7575').replace(/\/$/, '');
const secret = process.env.CANTON_SPLICE_SECRET || 'unsafe';
const audience = process.env.CANTON_LEDGER_API_AUDIENCE || 'https://canton.network.global';
const user = process.env.CANTON_LEDGER_API_USER || 'ledger-api-user';
const pkg = process.env.CANTON_DAML_PACKAGE_ID;
const operator =
  process.argv[3]?.trim() ||
  process.env.CANTON_OPERATOR_PARTY_ID?.trim() ||
  process.env.CANTON_VALIDATOR_PARTY_ID?.trim();
const userParty = process.argv[2];

if (!userParty || !pkg || !operator) {
  console.error('Usage: node scripts/test-quest-ledger-create.cjs <userPartyId> [operatorPartyId]');
  console.error('  If submit fails with NO_SYNCHRONIZER, run: node scripts/ensure-quest-operator.cjs');
  process.exit(1);
}

const token = jwt.sign({ sub: user, aud: audience }, secret, { algorithm: 'HS256', expiresIn: '5m' });
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

async function submit(label, actAs, templateId, createArguments) {
  const res = await fetch(`${baseUrl}/v2/commands/submit-and-wait-for-transaction-tree`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      commands: [{ CreateCommand: { templateId, createArguments } }],
      userId: user,
      commandId: randomUUID(),
      actAs,
      readAs: actAs,
    }),
  });
  const text = await res.text();
  console.log('\n---', label, '---');
  console.log('operator:', operator.split('::')[0]);
  console.log('actAs parties:', actAs.length);
  console.log('HTTP', res.status);
  console.log(text.slice(0, 800));
  return res.ok;
}

(async () => {
  const tpl = `${pkg}:Main:QuestTaskSubmission`;
  const args = {
    operator,
    user: userParty,
    questId: 'debug-quest',
    taskId: 'debug-task-1',
    proof: 'test',
    submittedAt: new Date().toISOString(),
    verified: true,
  };
  const ok = await submit('operator-only (signatory)', [operator], tpl, args);
  if (!ok) {
    console.log('\nTip: administrator::* from /v2/parties often cannot submit on TestNet.');
    console.log('Run: node scripts/ensure-quest-operator.cjs');
    process.exit(1);
  }
  console.log('\n✅ Quest DAML create works with this operator party.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
