import { apiFetch } from './client';

/**
 * Saldo points pengguna — single source of truth (mirror backend /users/me/points).
 * - total: lifetime earned (reconciled)
 * - used: total EarnEntry.pointsSpent (terpakai di Earn events)
 * - remaining: max(0, total - used) = saldo yang tersedia
 */
export interface PointsBalance {
  total: number;
  used: number;
  remaining: number;
}

export function getPointsBalance() {
  return apiFetch<PointsBalance>('/api/points');
}
