import { CQ_ADMIN_ACCESS_COOKIE } from '@/lib/auth-cookies';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function extFromMime(mime: string): string | null {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ message: 'Expected multipart body' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return NextResponse.json({ message: 'Missing file field' }, { status: 400 });
  }

  const f = file as File;
  if (!ALLOWED.has(f.type)) {
    return NextResponse.json({ message: 'Only JPEG, PNG, WebP, or GIF allowed' }, { status: 400 });
  }

  const ext = extFromMime(f.type);
  if (!ext) {
    return NextResponse.json({ message: 'Unsupported image type' }, { status: 400 });
  }

  const buf = Buffer.from(await f.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ message: 'File too large (max 4 MB)' }, { status: 400 });
  }

  const publicDir = path.join(process.cwd(), 'public', 'quest-media');
  await mkdir(publicDir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  const fsPath = path.join(publicDir, name);
  await writeFile(fsPath, buf);

  const urlPath = `/quest-media/${name}`;
  return NextResponse.json({ url: urlPath });
}
