/**
 * Debug flag gate — di-evaluasi SEKALI saat modul load (cached).
 *
 * Problem: NestJS log level (debug/verbose) tidak mencegah argumen log
 * dievaluasi. Template string + JSON.stringify di hot path (WSS updates,
 * balance events, SSE, poll 30s) tetap jalan tiap event walau outputnya
 * di-skip → CPU & GC churn yang signifikan di traffic tinggi.
 *
 * Solusi: bungkus log hot-path dengan `if (DEBUG_LEDGER)` sehingga seluruh
 * ekspresi argumen short-circuit di production. Nyalakan dengan env
 * `DEBUG_LEDGER=true` saat perlu investigasi.
 */
export const DEBUG_LEDGER: boolean = process.env.DEBUG_LEDGER === 'true';
