"use client";

import type { ReactNode } from "react";
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
        // Instruksi custom admin — URL di dalamnya otomatis jadi link klik.
        // Font/warna/ukuran samakan "Your rewards are ready below" (text-xs muted).
        <div className="mt-2 space-y-1.5">
          {instructions
            .split(/\n/)
            .filter((line) => line.trim().length > 0)
            .map((line, i) => (
              <p
                key={i}
                className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--muted-foreground)]"
              >
                {renderTextWithLinks(line)}
              </p>
            ))}
        </div>
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
                  <a
                    href={ensureAbsoluteUrl(url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-canton underline underline-offset-2 hover:text-canton/80 break-all"
                  >
                    {prettyUrl(url)}
                  </a>
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

/**
 * Pastikan URL absolut (punya protokol) supaya <a href> benar-benar redirect
 * ke web luar, bukan diperlakukan sebagai route internal app.
 * "www.canquest.cc" → "https://www.canquest.cc"
 */
function ensureAbsoluteUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

/**
 * Regex untuk mendeteksi URL (http/https atau www.) di dalam teks bebas.
 */
const URL_RE = /(?:https?:\/\/[^\s]+|www\.[^\s]+)/gi;

/**
 * Render teks bebas, mengubah SETIAP URL di dalamnya menjadi <a> yang bisa diklik
 * (buka tab baru). Dipakai untuk instruksi custom admin supaya URL-nya aktif.
 */
function renderTextWithLinks(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // Salin regex (stateful dengan /g) supaya bisa di-loop.
  const re = new RegExp(URL_RE.source, "gi");
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const rawUrl = match[0];

    // Teks sebelum URL.
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    const href = ensureAbsoluteUrl(rawUrl);
    parts.push(
      <a
        key={`url-${key++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-canton underline underline-offset-2 hover:text-canton/80 break-all"
      >
        {rawUrl}
      </a>,
    );

    lastIndex = start + rawUrl.length;
  }

  // Sisa teks setelah URL terakhir.
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}
