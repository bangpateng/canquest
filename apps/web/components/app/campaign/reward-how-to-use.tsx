"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";

/**
 * Bagian "How to use your code" — muncul di reveal setelah claim code.
 *
 * - redeemInstructions non-empty → tampilkan teks custom admin (whitespace-pre-line).
 * - else → template 3-step default: Register (→ redeemUrl) · Enter your code · Done.
 *
 * Self-gate: return null bila tidak ada redeemUrl & tidak ada instructions
 * (quest lama tanpa config redeem → tidak muncul section).
 */
export function RewardHowToUse({
  redeemUrl,
  redeemInstructions,
  inviteCode,
  className,
  flat = false,
}: {
  redeemUrl?: string | null;
  redeemInstructions?: string | null;
  inviteCode?: string | null;
  className?: string;
  /** flat=true → menyatu di card induk (tanpa border/bg sendiri). */
  flat?: boolean;
}) {
  const t = usePlatformT();

  const url = redeemUrl?.trim() || null;
  const instructions = redeemInstructions?.trim() || null;

  // Tidak ada instruksi apapun → jangan render.
  if (!url && !instructions) return null;

  return (
    <div
      className={cn(
        flat
          ? "" // menyatu di card induk (border/padding diatur induk)
          : "rounded-xl border border-canton-muted bg-canton-subtle/60 p-4",
        className,
      )}
    >
      <p className="text-sm font-bold text-[var(--foreground)]">
        {t("earnCampaigns.howToUseTitle")}
      </p>

      {instructions ? (
        // Instruksi custom admin — tampilkan apa adanya (hormati newline).
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--foreground)]">
          {instructions}
        </p>
      ) : (
        // Template 3-step default.
        <ol className="mt-3 space-y-2.5">
          <li className="flex items-start gap-3">
            <StepBadge n={1} />
            <div className="min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
              <span>{t("earnCampaigns.howToUseStepRegister")}</span>
              {url ? (
                <>
                  <span aria-hidden>: </span>
                  <Link
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-canton underline underline-offset-2 hover:text-canton/80 break-all"
                  >
                    {prettyUrl(url)}
                  </Link>
                </>
              ) : null}
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepBadge n={2} />
            <div className="min-w-0">
              <span className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                {t("earnCampaigns.howToUseStepUseCode")}
                {inviteCode ? (
                  <>
                    {": "}
                    <span className="font-mono font-bold tracking-widest text-canton">
                      {inviteCode}
                    </span>
                  </>
                ) : null}
              </span>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <StepBadge n={3} done />
            <div className="min-w-0">
              <span className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                {t("earnCampaigns.howToUseStepDone")} ✅
              </span>
            </div>
          </li>
        </ol>
      )}
    </div>
  );
}

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        done
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-canton/15 text-canton",
      )}
      aria-hidden
    >
      {done ? <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} /> : n}
    </span>
  );
}

/** Tampilkan URL lebih bersih: buang protokol + www, batasi panjang. */
function prettyUrl(raw: string): string {
  let s = raw.trim();
  try {
    const u = new URL(s);
    s = u.hostname.replace(/^www\./, "") + (u.pathname && u.pathname !== "/" ? u.pathname : "");
  } catch {
    s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  }
  return s.length > 48 ? `${s.slice(0, 45)}…` : s;
}
