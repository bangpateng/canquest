import { apiFetch } from './client';

export interface LedgerStatus {
  canton: { reachable: boolean };
  splice: { reachable: boolean; configured: boolean };
  message: string;
}

export function getLedgerStatus() {
  return apiFetch<LedgerStatus>('/api/party/ledger-status', {
    signal: AbortSignal.timeout(5_000),
  });
}

export function allocateParty() {
  return apiFetch('/api/party/allocate', { method: 'POST' });
}
