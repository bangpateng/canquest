import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

type Params = { params: Promise<{ questId: string; taskId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { questId, taskId } = await params;
  const body = await req.text();
  return nestWithAccessCookie(
    req,
    `/quests/${questId}/tasks/${taskId}/submit`,
    {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
