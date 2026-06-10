"use client";
import { CopyField } from "@/components/app/wallet/copy-field";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { formatPartyIdForDisplay, normalizeSendRecipientInput } from "@/lib/canton/canton-party-id";
import { cn } from "@/lib/utils/utils";
import { TransactionDetailModal } from "@/components/app/wallet/transaction-detail-modal";
import { ArrowDownLeft, ArrowUpRight, X, AlertCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useId, useState } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

type Sheet = null | "send" | "receive";
type SendState = "idle" | "loading" | "success" | "error";

interface WalletActionsProps { partyId: string; onBalanceRefresh?: () => void; }

export function WalletActions({ partyId, onBalanceRefresh }: WalletActionsProps) {
  const dp = formatPartyIdForDisplay(partyId);
  const stid = useId(); const rtid = useId();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [feeCc, setFeeCc] = useState(5);
  const [rec, setRec] = useState(""); const [amt, setAmt] = useState(""); const [memo, setMemo] = useState("");
  const [ss, setSs] = useState<SendState>("idle"); const [sm, setSm] = useState("");
  const [stx, setStx] = useState<string | null>(null);

  useEffect(() => { fetch("/api/party/fee-config", { credentials: "include" }).then(r => r.ok ? r.json() : null).then((d: any) => { if (d?.feeCc !== undefined) setFeeCc(d.feeCc); }).catch(() => {}); }, []);

  const close = useCallback(() => { setSheet(null); setSs("idle"); setSm(""); }, []);
  const cstx = useCallback(() => { setStx(null); setSs("idle"); setSm(""); }, []);
  useEffect(() => { if (!sheet) return; const cb = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", cb); return () => window.removeEventListener("keydown", cb); }, [sheet, close]);

  function os() { setRec(""); setAmt(""); setMemo(""); setSs("idle"); setSm(""); setSheet("send"); }

  async function sub(e: React.FormEvent) { e.preventDefault(); const r = normalizeSendRecipientInput(rec); const a = parseFloat(amt.trim()); if (!r || !a || a <= 0) return; setSs("loading"); setSm("");
    try { const res = await fetch("/api/party/send-cc", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientUsername: r, amount: a, memo: memo.trim() || undefined }) }); const d = await res.json() as any;
      if (!res.ok || d.success === false || d.accepted === false) { setSs("error"); setSm(d.message ?? d.error ?? "Transfer failed"); return; }
      setSheet(null); setSs("idle");
      if (typeof d.transactionId === "string" && d.transactionId) setStx(d.transactionId);
      else { setSs("success"); setSm(d.message ?? `Sent ${a} CC`); setSheet("send"); }
      onBalanceRefresh?.();
    } catch { setSs("error"); setSm("Network error"); }
  }

  return (<>
    <div className="grid grid-cols-2 gap-3"><button type="button" onClick={os} className={cn(buttonVariants({ size: "sm" }), "w-full justify-center gap-2 rounded-lg")}><ArrowUpRight className="h-4 w-4" />Send</button>
    <button type="button" onClick={() => setSheet("receive")} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-full justify-center gap-2 rounded-lg")}><ArrowDownLeft className="h-4 w-4" />Receive</button></div>

    {sheet === "send" && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation"><button type="button" className="fixed inset-0 bg-black/40" onClick={close} />
      <div role="dialog" aria-modal="true" aria-labelledby={stid} className="relative z-10 w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4"><h2 id={stid} className="text-base font-semibold text-[var(--foreground)]">Send CC</h2><button onClick={close} className="p-1 rounded-md hover:bg-[var(--muted)]"><X className="h-4 w-4 text-[var(--muted-foreground)]" /></button></div>
        {ss === "success" ? <div className="mt-4 text-center"><p className="text-sm text-[var(--foreground)]">{sm}</p><button onClick={close} className={cn(buttonVariants({ size: "sm" }), "mt-3")}>Done</button></div>
        : <form onSubmit={sub} className="mt-4 space-y-4">
          <div><label htmlFor="wsr" className="text-xs font-medium text-[var(--muted-foreground)]">Recipient</label><textarea id="wsr" required rows={2} value={rec} onChange={e => setRec(e.target.value)} placeholder="@alice or alice::1220..." disabled={ss==="loading"} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 font-mono text-sm text-[var(--foreground)] outline-none resize-none focus:border-[var(--primary)]/50 disabled:opacity-50" /></div>
          <div><label htmlFor="wsa" className="text-xs font-medium text-[var(--muted-foreground)]">Amount</label><input id="wsa" required inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} placeholder="10" disabled={ss==="loading"} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm font-bold tabular-nums text-[var(--foreground)] outline-none focus:border-[var(--primary)]/50 disabled:opacity-50" /></div>
          <div><label htmlFor="wsm" className="text-xs font-medium text-[var(--muted-foreground)]">Memo <span className="text-[var(--muted-foreground)]">(optional)</span></label><input id="wsm" value={memo} onChange={e => setMemo(e.target.value)} disabled={ss==="loading"} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]/50 disabled:opacity-50" /></div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">Fee: {feeCc} CC{amt && parseFloat(amt) > 0 ? ` · Total: ${(parseFloat(amt) + feeCc).toFixed(2)} CC` : ""}</div>
          {ss === "error" && <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" /><p className="text-xs text-red-300">{sm}</p></div>}
          <div className="flex gap-2"><button type="submit" disabled={ss==="loading"} className={cn(buttonVariants({ size: "sm" }), "gap-2 rounded-lg")}>{ss==="loading" ? <><LoadingSpinner size="sm" />Sending...</> : "Send"}</button><button type="button" onClick={close} disabled={ss==="loading"} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "rounded-lg")}>Cancel</button></div>
        </form>}
      </div></div>)}

    <TransactionDetailModal open={stx !== null} transactionId={stx} onClose={cstx} />

    {sheet === "receive" && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation"><button type="button" className="fixed inset-0 bg-black/40" onClick={close} />
      <div role="dialog" aria-modal="true" aria-labelledby={rtid} className="relative z-10 w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4"><h2 id={rtid} className="text-base font-semibold text-[var(--foreground)]">Receive CC</h2><button onClick={close} className="p-1 rounded-md hover:bg-[var(--muted)]"><X className="h-4 w-4 text-[var(--muted-foreground)]" /></button></div>
        <div className="mt-4 flex justify-center rounded-lg border border-[var(--border)] bg-white p-4"><QRCodeSVG value={dp} size={180} level="M" /></div>
        <div className="mt-4"><CopyField label="Your Canton Party ID" value={dp} /></div>
        <button type="button" onClick={close} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4 w-full rounded-lg")}>Done</button>
      </div></div>)}
  </>);
}