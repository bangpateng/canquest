"use client";
import { CopyField } from "@/components/app/wallet/copy-field";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export function QuestReferralCard() {
  const t = usePlatformT();
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-5">
      <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("questReferral.title")}</h3>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t("questReferral.desc")}</p>
      <div className="mt-4"><CopyField label={t("questReferral.link")} value={typeof window !== "undefined" ? `${window.location.origin}/?ref=me` : "/?ref=me"} /></div>
    </div>
  );
}