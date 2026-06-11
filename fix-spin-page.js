const fs = require('fs');
const path = 'apps/web/app/(platform)/spin/reward/page.tsx';
let f = fs.readFileSync(path, 'utf8');

f = f.replace(
  'No prizes configured',
  'Create a wallet to spin'
).replace(
  'Check back soon \u2014 prizes are being set up!',
  'You need a wallet before you can spin. Create one on the Wallet page.'
);

fs.writeFileSync(path, f);
console.log('done');