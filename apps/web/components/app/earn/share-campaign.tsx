"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, Link2, Check } from "lucide-react";
import { cn } from "@/lib/utils/utils";

interface ShareCampaignProps {
  /** URL publik campaign. Default: URL halaman saat ini. */
  url?: string;
  /** Judul campaign (dipakai di teks share). */
  title: string;
  /** Teks tambahan, mis. reward ("Earn 1 CC"). */
  text?: string;
  className?: string;
}

/**
 * Tombol Share untuk campaign Earn.
 *
 * - Mobile: pakai native share sheet (`navigator.share`) → semua app sosial muncul.
 * - Desktop / fallback: dropdown X (Twitter), Telegram, WhatsApp, Copy link.
 *   (Discord tidak punya share-intent web → tercakup oleh "Copy link".)
 */
export function ShareCampaign({ url, title, text, className }: ShareCampaignProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const shareUrl =
    url ?? (typeof window !== "undefined" ? window.location.href : "");
  const shareText = text ? `${title} — ${text}` : title;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const handleClick = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text: shareText, url: shareUrl });
        return;
      } catch {
        /* dibatalkan / tak didukung → buka dropdown */
      }
    }
    setOpen((v) => !v);
  };

  const openLink = (href: string) => {
    window.open(href, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const enc = encodeURIComponent;
  const targets = [
    {
      label: "X (Twitter)",
      href: `https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(shareUrl)}`,
    },
    {
      label: "Telegram",
      href: `https://t.me/share/url?url=${enc(shareUrl)}&text=${enc(shareText)}`,
    },
    {
      label: "WhatsApp",
      href: `https://wa.me/?text=${enc(`${shareText} ${shareUrl}`)}`,
    },
  ];

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger icon-only glass dark — pas di atas banner (mockup v2) */}
      <button
        type="button"
        onClick={handleClick}
        aria-label="Share campaign"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/30 bg-[#0f1714]/45 text-white shadow-[0_6px_14px_-10px_rgba(22,36,27,0.5)] backdrop-blur-md transition-all duration-200 hover:bg-[#0f1714]/65"
      >
        <Share2 className="h-4 w-4" />
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-[188px] rounded-[14px] border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-[0_16px_32px_-18px_rgba(22,36,27,0.4)]">
          <button
            type="button"
            onClick={copyLink}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]",
              copied && "text-canton",
            )}
          >
            {copied ? (
              <Check className="h-[15px] w-[15px] text-canton" />
            ) : (
              <Link2 className="h-[15px] w-[15px] text-[var(--muted-foreground)]" />
            )}
            {copied ? "Copied" : "Copy link"}
          </button>
          {targets.map((tgt) => (
            <button
              key={tgt.label}
              type="button"
              onClick={() => openLink(tgt.href)}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
            >
              <ShareTargetIcon label={tgt.label} />
              {tgt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Ikon kecil utk tiap target share di menu (mockup v2). */
function ShareTargetIcon({ label }: { label: string }) {
  const cls = "h-[15px] w-[15px] shrink-0 text-[var(--muted-foreground)]";
  if (label.startsWith("X")) {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }
  if (label === "Telegram") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    );
  }
  if (label === "WhatsApp") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
      </svg>
    );
  }
  return <Share2 className={cls} aria-hidden />;
}