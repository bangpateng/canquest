"use client";

import { Plus, Trash2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import {
  QUEST_SOCIAL_PLATFORM_OPTIONS,
  emptySocialLinkDraft,
  type QuestSocialLink,
  type QuestSocialPlatform,
} from "@/lib/quest/quest-social-links";

type Props = {
  links: QuestSocialLink[];
  onChange: (links: QuestSocialLink[]) => void;
  inputCls: string;
};

export function QuestSocialLinksEditor({ links, onChange, inputCls }: Props) {
  function updateRow(index: number, patch: Partial<QuestSocialLink>) {
    onChange(links.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    onChange(links.filter((_, i) => i !== index));
  }

  const usedPlatforms = new Set(links.map((l) => l.platform));

  return (
    <div className="space-y-3">
      {links.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          No social links yet. Add X, Discord, Telegram, or a website — icons appear under About on the campaign page.
        </p>
      ) : null}
      {links.map((row, index) => (
        <div
          key={`${row.platform}-${index}`}
          className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3 sm:flex-row sm:items-center"
        >
          <select
            value={row.platform}
            onChange={(e) =>
              updateRow(index, { platform: e.target.value as QuestSocialPlatform })
            }
            className={cn(inputCls, "sm:max-w-[11rem]")}
          >
            {QUEST_SOCIAL_PLATFORM_OPTIONS.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                disabled={
                  usedPlatforms.has(opt.value) && opt.value !== row.platform
                }
              >
                {opt.label}
              </option>
            ))}
          </select>
          <input
            type="url"
            value={row.url}
            onChange={(e) => updateRow(index, { url: e.target.value })}
            placeholder="https://x.com/yourproject"
            className={cn(inputCls, "min-w-0 flex-1")}
          />
          <button
            type="button"
            onClick={() => removeRow(index)}
            className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
            aria-label="Remove social link"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={links.length >= QUEST_SOCIAL_PLATFORM_OPTIONS.length}
        onClick={() => {
          const draft = emptySocialLinkDraft();
          const nextPlatform =
            QUEST_SOCIAL_PLATFORM_OPTIONS.find((o) => !usedPlatforms.has(o.value))
              ?.value ?? draft.platform;
          onChange([...links, { platform: nextPlatform, url: "" }]);
        }}
        className={cn(buttonVariants({ variant: "secondary" }), "gap-2 disabled:opacity-50")}
      >
        <Plus className="h-4 w-4" />
        Add social link
      </button>
    </div>
  );
}
