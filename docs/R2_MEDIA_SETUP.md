# Cloudflare R2 — Earn campaign images

Earn campaigns use **two images** per event:

| Field | Admin form | Stored as |
|--------|------------|-----------|
| Banner | Campaign banner | `Quest.bannerImageUrl` |
| Logo | Project logo | `Quest.logoUrl` |

Uploads go to **Cloudflare R2** (S3-compatible). URLs are full `https://…` links saved in Postgres and shown on `/earn`.

## 1. Create R2 bucket

1. Cloudflare Dashboard → **R2** → Create bucket (e.g. `canquest-media`).
2. Enable **public access** (R2.dev subdomain) **or** attach custom domain (e.g. `cdn.canquest.cc`).
3. Note **Account ID** (overview page).

## 2. API token

R2 → **Manage R2 API Tokens** → Create token:

- Permission: **Object Read & Write** on your bucket
- Copy **Access Key ID** and **Secret Access Key**

## 3. VPS `apps/api/.env`

```env
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=canquest-media
R2_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev
```

`R2_PUBLIC_BASE_URL` = public URL **without** trailing slash (R2.dev URL or custom domain).

Restart API after saving:

```bash
pm2 restart canquest-api
```

On boot you should see: `Cloudflare R2 enabled (bucket=…, public=…)`.

## 4. Admin upload flow

1. Admin → Earn → create/edit campaign.
2. Upload **logo** and **banner** (JPEG/PNG/WebP/GIF, max 5 MB).
3. BFF `POST /api/admin/uploads/quest-asset` → Nest `POST /api/admin/uploads/quest-asset` → R2.
4. Returned URL is saved on the quest (e.g. `https://pub-….r2.dev/quests/uuid.webp`).

## 5. Local dev (no R2)

If `R2_*` vars are empty, files save under `apps/api/uploads/quest-media/` and URLs look like:

`http://127.0.0.1:3001/api/uploads/quest-media/{uuid}.jpg`

## 6. CORS (custom domain only)

If the browser loads images from a custom CDN domain on the **web** app, ensure that domain allows hotlinking (R2 public bucket or CDN rule). R2.dev public URLs usually work without extra CORS for `<img>` tags.

## 7. Existing `/quest-media/` paths

Old campaigns may still use `/quest-media/…` paths from Vercel `public/`. Re-upload banner/logo in admin to move them to R2.
