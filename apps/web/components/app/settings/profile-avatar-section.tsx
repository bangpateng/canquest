"use client";
export function ProfileAvatarSection({ avatarUrl, twitterUsername, displayName }: { avatarUrl?: string | null; twitterUsername?: string | null; displayName?: string | null }) {
  if (!twitterUsername || !avatarUrl) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <img src={avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover ring-1 ring-[var(--border)]" />
      <div className="min-w-0"><p className="text-sm font-semibold text-[var(--foreground)] truncate">{displayName ?? twitterUsername}</p><p className="text-xs text-[var(--muted-foreground)]">@{twitterUsername}</p></div>
    </div>
  );
}