/** Nama queue BullMQ yang digunakan di seluruh aplikasi. */
export const QUEUE_LEDGER = 'ledger-jobs';
export const QUEUE_SPIN   = 'spin-jobs';

/** Job types untuk QUEUE_LEDGER */
export const JOB_SEND_CC_REWARD    = 'send-cc-reward';
export const JOB_DISTRIBUTE_REWARD = 'distribute-reward';
export const JOB_ACCEPT_OFFER      = 'accept-transfer-offer';

/** Job types untuk QUEUE_SPIN */
export const JOB_PROCESS_SPIN = 'process-spin';
