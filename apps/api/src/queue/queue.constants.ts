/** Nama queue BullMQ yang digunakan di seluruh aplikasi. */
export const QUEUE_LEDGER = 'ledger-jobs';

/** Job types untuk QUEUE_LEDGER */
export const JOB_SEND_CC_REWARD = 'send-cc-reward';

/** Queue email notifikasi campaign (Resend batch) — v32. */
export const QUEUE_EMAIL = 'email-jobs';

/** Job types untuk QUEUE_EMAIL — payload: { logIds: string[] }. */
export const JOB_CAMPAIGN_EMAIL_CHUNK = 'campaign-email-chunk';
