"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatApiError } from "@/lib/format-api-error";
import { UserRound, ImagePlus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

function fileToThumbnailJpeg(file: File, maxPx = 256, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(maxPx / img.width, maxPx / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("image"));
    };
    img.src = objectUrl;
  });
}

function initialsFrom(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

type ProfileAvatarSectionProps = {
  displayName?: string | null;
  avatarUrl?: string | null;
  onUpdated?: (avatarUrl: string | null) => void;
};

export function ProfileAvatarSection({
  displayName,
  avatarUrl: initialAvatarUrl,
  onUpdated,
}: ProfileAvatarSectionProps) {
  const inputId = useId();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAvatarUrl(initialAvatarUrl ?? null);
  }, [initialAvatarUrl]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (dataUrl: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/me/avatar", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }),
        });
        const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!res.ok) {
          setError(formatApiError(raw));
          return;
        }
        const url =
          typeof raw?.avatarUrl === "string"
            ? `${raw.avatarUrl}?t=${Date.now()}`
            : null;
        setAvatarUrl(url);
        onUpdated?.(url);
      } finally {
        setBusy(false);
      }
    },
    [onUpdated],
  );

  const onPickFile = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file (PNG, JPG, WebP…).");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Max 4 MB.");
      return;
    }
    setBusy(true);
    try {
      const jpeg = await fileToThumbnailJpeg(file);
      await upload(jpeg);
    } catch {
      setError("Could not read that image.");
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/avatar", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        setError(formatApiError(raw));
        return;
      }
      setAvatarUrl(null);
      onUpdated?.(null);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setBusy(false);
    }
  };

  const initials = initialsFrom(displayName?.trim() || "User");

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="relative shrink-0">
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={(e) => void onPickFile(e.target.files)}
        />
        <div
          className={cn(
            "relative flex h-28 w-28 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--muted)] shadow-inner sm:h-32 sm:w-32",
          )}
        >
          {busy ? (
            <div className="flex flex-1 items-center justify-center bg-[var(--card)]">
              <LoadingSpinner size="2xl" tone="muted" />
            </div>
          ) : avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-2 text-center">
              <span className="type-section-title text-[var(--muted-foreground)]">
                {initials}
              </span>
              <UserRound className="h-6 w-6 text-[var(--muted-foreground)] opacity-50" />
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-xs font-medium text-[var(--muted-foreground)]">Profile photo</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Shown on the leaderboard. Stored in your account folder on the server.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={inputId}
            className={cn(
              buttonVariants({ size: "sm" }),
              "cursor-pointer gap-2",
              busy && "pointer-events-none opacity-50",
            )}
          >
            <ImagePlus className="h-4 w-4" />
            {avatarUrl ? "Change photo" : "Upload image"}
          </label>
          {avatarUrl ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void clear()}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "disabled:opacity-50")}
            >
              Remove
            </button>
          ) : null}
        </div>
        {error ? <p className="text-xs font-medium text-red-700 dark:text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
