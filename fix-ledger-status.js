const fs = require('fs');
let f = fs.readFileSync('apps/api/src/party/party.controller.ts', 'utf8');

f = f.replace(
  "'Both Canton JSON API and Splice Validator API are reachable.'",
  "'Node connected.'"
);
f = f.replace(
  "'Canton JSON API NOT reachable. Check CANTON_JSON_API_URL and SSH tunnel to port 7575.'",
  "'Node connection issue'"
);
f = f.replace(
  /'Canton OK\. Splice Validator API not reachable .*?'/,
  "'Node connection issue'"
);

fs.writeFileSync('apps/api/src/party/party.controller.ts', f);
console.log('done');