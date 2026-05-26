#!/usr/bin/env node
/**
 * Check Cloudflare R2 config in apps/api/.env
 * Usage: node apps/api/scripts/diagnose-r2.cjs
 */
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const {
  S3Client,
  HeadBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

function normalizeBucketName(raw) {
  if (!raw?.trim()) return null;
  let s = raw.trim();
  if (s.startsWith('http')) {
    try {
      const u = new URL(s);
      const parts = u.pathname.split('/').filter(Boolean);
      s = parts[parts.length - 1] ?? s;
    } catch {
      /* ignore */
    }
  }
  return s.replace(/^\/+|\/+$/g, '') || null;
}

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = normalizeBucketName(process.env.R2_BUCKET_NAME);
  const publicBase = process.env.R2_PUBLIC_BASE_URL?.trim()?.replace(/\/$/, '');
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);

  console.log('=== R2 diagnose ===\n');
  console.log('R2_ACCOUNT_ID:', accountId ? `${accountId.slice(0, 8)}…` : '(missing)');
  console.log('R2_ACCESS_KEY_ID:', accessKeyId ? 'set' : '(missing)');
  console.log('R2_SECRET_ACCESS_KEY:', secretAccessKey ? 'set' : '(missing)');
  console.log('R2_BUCKET_NAME (raw):', process.env.R2_BUCKET_NAME ?? '(missing)');
  console.log('R2_BUCKET_NAME (normalized):', bucket ?? '(missing)');
  console.log('R2_PUBLIC_BASE_URL:', publicBase ?? '(missing)');
  console.log('R2_ENDPOINT:', endpoint ?? '(missing)');

  const rawPublic = process.env.R2_PUBLIC_BASE_URL?.trim()?.replace(/\/$/, '');
  if (rawPublic && /\.r2\.cloudflarestorage\.com/i.test(rawPublic)) {
    console.error(
      '\nFAIL: R2_PUBLIC_BASE_URL is the S3 API endpoint (private). Browsers cannot load images from it.',
    );
    console.error(
      'Fix: Cloudflare → R2 → bucket canquest-assets → Settings → Public access → Enable → copy',
    );
    console.error('     the https://pub-xxxxxxxx.r2.dev URL into R2_PUBLIC_BASE_URL');
    console.error('     (keep R2_ENDPOINT unset or as the cloudflarestorage.com URL for API only).');
    process.exit(1);
  }

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    console.error('\nFAIL: Fill all R2_* vars in apps/api/.env');
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  try {
    const list = await client.send(new ListBucketsCommand({}));
    const names = (list.Buckets ?? []).map((b) => b.Name);
    console.log('\nBuckets visible to this API token:', names.length ? names.join(', ') : '(none)');
  } catch (e) {
    console.warn('\nListBuckets failed (some tokens are bucket-scoped):', e.message);
  }

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`\nOK: HeadBucket "${bucket}"`);
  } catch (e) {
    console.error(`\nFAIL: HeadBucket "${bucket}" — ${e.name}: ${e.message}`);
    console.error(
      '\nFix: Cloudflare dashboard → R2 → create bucket OR fix R2_BUCKET_NAME to match exactly.',
    );
    process.exit(1);
  }

  const testKey = `quests/_diagnose-${Date.now()}.txt`;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: testKey,
        Body: Buffer.from('canquest-r2-ok'),
        ContentType: 'text/plain',
      }),
    );
    console.log(`OK: PutObject ${testKey}`);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: testKey }));
    console.log('OK: deleted test object');
  } catch (e) {
    console.error(`FAIL: PutObject — ${e.name}: ${e.message}`);
    process.exit(1);
  }

  if (!publicBase) {
    console.error('\nWARN: R2_PUBLIC_BASE_URL missing — set pub-….r2.dev public URL');
    process.exit(1);
  }
  console.log(`\nPublic URL example (for DB): ${publicBase}/quests/your-file.webp`);
  console.log('\nAll checks passed. Restart: pm2 restart canquest-api');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
