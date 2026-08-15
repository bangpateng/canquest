// scripts/query-preapproval-data.cjs — probe NYATA, read-only. Node>=18 (fetch global).
const path = require('path');
let loaded = null;
try {
  const dotenv = require('dotenv');
  for (const p of [path.resolve(__dirname,'../.env'), '/var/www/canquest/apps/api/.env', '/var/www/canquest/.env']) {
    const r = dotenv.config({ path: p }); if (!r.error) { loaded = p; break; }
  }
} catch (e) { console.log('dotenv?', e.message); }
console.log('ENV dari:', loaded || '(none)');
if (typeof fetch !== 'function') { console.error('FATAL: tak ada fetch global, Node', process.version); process.exit(1); }

const { KEYCLOAK_URL, KEYCLOAK_REALM, LEDGER_CLIENT_ID, LEDGER_CLIENT_SECRET, LEDGER_API_URL } = process.env;
const SCOPE = process.env.LEDGER_API_AUTH_SCOPE || 'daml_ledger_api';
const SCAN_URL = process.env.CANTON_SCAN_URL;
const FP = '12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb';
const FEE_PARTY = process.env.CANTON_FEE_RECIPIENT_PARTY_ID || `canquest-fee::${FP}`;
const VALIDATOR_PARTY = process.env.CANTON_VALIDATOR_PARTY_ID || `canquest-validator-1::${FP}`;
const dump = (l, o) => { console.log(`\n===== ${l} =====`); console.log(typeof o==='string'?o:JSON.stringify(o,null,2)); };

async function token() {
  const r = await fetch(`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'client_credentials',client_id:LEDGER_CLIENT_ID,client_secret:LEDGER_CLIENT_SECRET,scope:SCOPE}) });
  if(!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`); return (await r.json()).access_token;
}
async function end(t){ const r=await fetch(`${LEDGER_API_URL}/v2/state/ledger-end`,{headers:{Authorization:`Bearer ${t}`}}); if(!r.ok) throw new Error(`end ${r.status}`); return (await r.json()).offset; }
async function acs(t, party, off){
  const r = await fetch(`${LEDGER_API_URL}/v2/state/active-contracts`, { method:'POST',
    headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},
    body: JSON.stringify({ eventFormat:{ filtersByParty:{ [party]:{ cumulative:[{ identifierFilter:{ WildcardFilter:{ value:{ includeCreatedEventBlob:true } } } }] } }, verbose:true }, activeAtOffset: off }) });
  if(!r.ok) throw new Error(`acs ${r.status}: ${await r.text()}`); return r.json();
}
const created = (e) => e?.contractEntry?.JsActiveContract?.createdEvent || e?.createdEvent || e;
async function scan(t, sfx){ try{ const r=await fetch(`${SCAN_URL}${sfx}`,{headers:{Authorization:`Bearer ${t}`}}); const b=await r.text(); console.log(`\n[scan ${sfx}] HTTP ${r.status}`); console.log(b.slice(0,3000)); }catch(e){ console.log(`\n[scan ${sfx}] ERR ${e.message}`);} }

(async () => {
  console.log('LEDGER:',LEDGER_API_URL,'\nSCAN:',SCAN_URL,'\nFEE:',FEE_PARTY,'\nVAL:',VALIDATOR_PARTY);
  const t = await token(); console.log('token OK len',t.length);
  const off = await end(t); console.log('offset', off);

  const fee = await acs(t, FEE_PARTY, off); let n=0;
  for (const e of fee){ const ev=created(e); const tpl=ev?.templateId||''; if(tpl.includes('TransferPreapproval')){ n++; dump('PREAPPROVAL canquest-fee templateId', tpl); dump('PREAPPROVAL canquest-fee createArgument', ev.createArgument); } }
  if(!n) console.log('\n(TIDAK ada TransferPreapproval di ACS canquest-fee — cek party id)');

  await scan(t,'/dso-party-id'); await scan(t,'/amulet-rules'); await scan(t,'/open-and-issuing-mining-rounds');

  const val = await acs(t, VALIDATOR_PARTY, off); let a=0;
  for (const e of val){ const tpl=created(e)?.templateId||''; if(tpl.endsWith(':Splice.Amulet:Amulet')) a++; }
  console.log('\nprovider Amulet count:', a);
})().catch(e=>{console.error('\nFATAL:',e.message);process.exit(1);});