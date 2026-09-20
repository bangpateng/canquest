/**
 * offer-tree-cid — pembaca contract id kontrak OFFER dari respons
 * submit-and-wait Canton JSON Ledger API.
 *
 * KENAPA MODUL TERPISAH:
 *   Fungsi ini dulu hidup di dalam canton-ledger.service.ts dan digantungkan
 *   pada label `transferKind` yang dilaporkan registry SEBELUM submit. Label
 *   itu terbukti salah pada produksi (log nyata 2026-09-12:
 *   `kind=direct` padahal penerima tanpa preapproval → hasil on-chain = offer).
 *   Akibatnya CID tidak pernah diekstrak: baris history pengirim tersimpan
 *   PENDING tanpa identitas offer, sehingga tidak bisa di-flip saat penerima
 *   accept (reconciler & markTransferInstructionSettled dua-duanya match by CID)
 *   dan tampak "pending selamanya".
 *
 * Sekarang penentuannya dari FAKTA tree: ada kontrak template offer atau tidak.
 * Dipisah ke modul murni (tanpa DB/state/jaringan) supaya bisa dikunci unit test
 * terhadap bentuk respons ledger yang sebenarnya.
 *
 * PURE: hanya mem-parsing JSON string.
 */

/** Template yang dianggap kontrak offer (butuh accept penerima). */
const OFFER_TEMPLATE_SUFFIXES = [
  ':TransferInstruction',
  ':AmuletTransferInstruction',
  ':TransferOffer',
];

/** True bila templateId adalah kontrak offer. */
export function isOfferTemplate(templateId: string): boolean {
  return OFFER_TEMPLATE_SUFFIXES.some((suffix) => templateId.endsWith(suffix));
}

/**
 * Ambil contract id kontrak offer dari respons submit-and-wait.
 *
 * Ledger membungkus created event dalam beberapa bentuk:
 *   - `{ eventsById: { "0": { templateId, contractId, ... } } }`
 *   - `{ transactionTree: { eventsById: { ... } } }`
 *   - `{ CreatedTreeEvent: { value: { templateId, contractId } } }`
 *   - bentuk datar (flat) untuk sebagian endpoint
 *
 * Ditelusuri rekursif tanpa asumsi bentuk. Mengembalikan null bila tidak ada
 * kontrak offer — artinya transfer langsung (penerima sudah preapprove), dan
 * pemanggil boleh memperlakukannya sebagai TX final.
 */
export function extractTransferInstructionCid(
  responseText: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return null; // bukan JSON — tidak ada yang bisa dibaca
  }

  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    const rec = cur as Record<string, unknown>;

    const templateId = typeof rec.templateId === 'string' ? rec.templateId : '';
    const contractId = typeof rec.contractId === 'string' ? rec.contractId : '';
    if (templateId && contractId && isOfferTemplate(templateId)) {
      return contractId;
    }

    // Wrapper PascalCase: { CreatedTreeEvent: { value: { ... } } }
    const tree = rec.CreatedTreeEvent as Record<string, unknown> | undefined;
    const inner = tree?.value as Record<string, unknown> | undefined;
    const innerTemplate =
      typeof inner?.templateId === 'string' ? inner.templateId : '';
    const innerContract =
      typeof inner?.contractId === 'string' ? inner.contractId : '';
    if (innerTemplate && innerContract && isOfferTemplate(innerTemplate)) {
      return innerContract;
    }

    for (const v of Object.values(rec)) stack.push(v);
  }
  return null;
}
