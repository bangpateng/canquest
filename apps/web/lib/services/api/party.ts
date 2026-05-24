import { apiFetch } from './client';

export interface LedgerStatus {
  canton: { reachable: boolean };
  splice: { reachable: boolean; configured: boolean };
  message: string;
}

export function getBalance() {
  return apiFetch<{ balance: number; unit: string }>('/api/party/balance');
}

export function getLedgerStatus() {
  return apiFetch<LedgerStatus>('/api/party/ledger-status', {
    signal: AbortSignal.timeout(5_000),
  });
}

export function setUsername(username: string) {
  return apiFetch('/api/party/username', {
    method: 'POST',
    json: { username },
  });
}

export function allocateParty() {
  return apiFetch('/api/party/allocate', { method: 'POST' });
}

export function sendCc(body: Record<string, unknown>) {
  return apiFetch('/api/party/send-cc', {
    method: 'POST',
    json: body,
  });
}

export function getTransactions(page: number, pageSize: number) {
  return apiFetch(`/api/party/transactions?page=${page}&pageSize=${pageSize}`);
}
