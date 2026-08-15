import type { Request } from 'express';

/** Tipe request ter-auth — dishare semua controller domain party. */
export type AuthedReq = Request & { user: { userId: string; email: string } };
