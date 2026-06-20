// scripts/probe-create-event.cjs — read-only. Ambil choiceArgument ASLI + holdings + amulet-rules penuh.
const path = require('path');
let loaded=null; try{ const d=require('dotenv'); for(const p of [path.resolve(__dirname,'../.env'),'/var/www/canquest/apps/api/.env','/var/www/canquest/.env']){const r=d.config({path:p}); if(!r.error){loaded=p;break;}} }catch(e){console.log('dotenv?',e.message);}
console.log('ENV dari:', loaded||'(none)');
if(typeof fetch!=='function'){console.error('FATAL: no fetch, Node',process.version);process.exit(1);}
const { KEYCLOAK_URL, KEYCLOAK_REALM, LEDGER_CLIENT_ID, LEDGER_CLIENT_SECRET, LEDGER_API_URL } = process.env;
const SCOPE=process.env.LEDGER_API_AUTH_SCOPE||'daml_ledger_api'; const SCAN_URL=process.env.CANTON_SCAN_URL;
const FP='12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb';
const FEE_PARTY=process.env.CANTON_FEE_RECIPIENT_PARTY_ID||`canquest-fee::${FP}`;
const VALIDATOR_PARTY=process.env.CANTON_VALIDATOR_PARTY_ID||`canquest-validator-1::${FP}`;
const dump=(l,o)=>{console.log(`\n===== ${l} =====`);console.log(typeof o==='string'?o:JSON.stringify(o,null,2));};
const flt=(parties)=>Object.fromEntries(parties.map(p=>[p,{cumulative:[{identifierFilter:{WildcardFilter:{value:{includeCreatedEventBlob:false}}}}]}]));

async function token(){const r=await fetch(`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:LEDGER_CLIENT_ID,client_secret:LEDGER_CLIENT_SECRET,scope:SCOPE})});if(!r.ok)throw new Error(`token ${r.status}`);return (await r.json()).access_token;}
async function end(t){const r=await fetch(`${LEDGER_API_URL}/v2/state/ledger-end`,{headers:{Authorization:`Bearer ${t}`}});return (await r.json()).offset;}
async function acs(t,party,off){const r=await fetch(`${LEDGER_API_URL}/v2/state/active-contracts`,{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({eventFormat:{filtersByParty:{[party]:{cumulative:[{identifierFilter:{WildcardFilter:{value:{includeCreatedEventBlob:false}}}}]}},verbose:true},activeAtOffset:off})});if(!r.ok)throw new Error(`acs ${r.status}: ${await r.text()}`);return r.json();}
const created=(e)=>e?.contractEntry?.JsActiveContract?.createdEvent||e?.createdEvent||e;

async function eventsByCid(t,cid,parties){const r=await fetch(`${LEDGER_API_URL}/v2/events/events-by-contract-id`,{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({contractId:cid,eventFormat:{filtersByParty:flt(parties),verbose:true}})});const b=await r.text();console.log(`\n[events-by-contract-id] HTTP ${r.status}`);console.log(b.slice(0,1500));try{return JSON.parse(b);}catch{return null;}}
async function byOffset(t,off,parties){const r=await fetch(`${LEDGER_API_URL}/v2/updates/update-by-offset`,{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({offset:off,updateFormat:{includeTransactions:{eventFormat:{filtersByParty:flt(parties),verbose:true},transactionShape:'TRANSACTION_SHAPE_LEDGER_EFFECTS'}}})});const b=await r.text();console.log(`\n[update-by-offset ${off}] HTTP ${r.status}`);console.log(b.slice(0,8000));}

(async()=>{
  const t=await token(); const off=await end(t); console.log('offset',off);
  // 1) cid preapproval canquest-fee
  let cid=null;
  for(const e of await acs(t,FEE_PARTY,off)){const ev=created(e);const tpl=ev?.templateId||'';if(tpl.includes('TransferPreapproval')){cid=ev.contractId;dump('PREAPPROVAL cid',cid);}}
  // 2) transaksi pembuatnya → choiceArgument ASLI
  if(cid){const ev=await eventsByCid(t,cid,[FEE_PARTY,VALIDATOR_PARTY]); const cOff=ev?.created?.createdEvent?.offset; console.log('createdEvent offset:',cOff); if(cOff!=null) await byOffset(t,cOff,[FEE_PARTY,VALIDATOR_PARTY]);}
  // 3) holdings provider (untuk inputs)
  const hold=[]; for(const e of await acs(t,VALIDATOR_PARTY,off)){const ev=created(e);const tpl=ev?.templateId||'';if(tpl.endsWith(':Splice.Amulet:Amulet'))hold.push({cid:ev.contractId,amount:ev.createArgument?.amount?.initialAmount});}
  dump('provider Amulet holdings',hold);
  // 4) amulet-rules PENUH (untuk blob disclosed)
  const ar=await fetch(`${SCAN_URL}/amulet-rules`,{headers:{Authorization:`Bearer ${t}`}}); dump('amulet-rules FULL',await ar.text());
})().catch(e=>{console.error('\nFATAL:',e.message);process.exit(1);});