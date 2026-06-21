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
      <button
        type="button"
        onClick={handleClick}
        aria-label="Share campaign"
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-white/10"
      >
        <Share2 className="h-4 w-4" />
        Share
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#0a0c14] shadow-xl">
          {targets.map((tgt) => (
            <button
              key={tgt.label}
              type="button"
              onClick={() => openLink(tgt.href)}
              className="flex w-full items-center px-3 py-2.5 text-left text-sm text-slate-200 transition-colors hover:bg-white/5"
            >
              {tgt.label}
            </button>
          ))}
          <button
            type="button"
            onClick={copyLink}
            className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-2.5 text-left text-sm text-slate-200 transition-colors hover:bg-white/5"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      ) : null}
    </div>
  );
}