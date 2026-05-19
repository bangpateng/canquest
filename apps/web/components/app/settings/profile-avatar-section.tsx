"use client";

import { MOCK_USER } from "@/lib/mock-demo";
import { cn } from "@/lib/utils";
import { Loader2, UserRound, ImagePlus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

const STORAGE_KEY = "canquest.profile.avatarDataUrl";

function fileToThumbnailJpeg(file: File, maxPx = 128, quality = 0.82): Promise<string> {
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

export function ProfileAvatarSection() {
  const inputId = useId();
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved?.startsWith("data:image")) setSrc(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const persist = useCallback((dataUrl: string | null) => {
    try {
      if (dataUrl) localStorage.setItem(STORAGE_KEY, dataUrl);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* quota / private mode */
    }
  }, []);

  const onPickFile = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file (PNG, JPG, WebP…).");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Max 4 MB for demo upload.");
      return;
    }
    setBusy(true);
    try {
      const jpeg = await fileToThumbnailJpeg(file);
      if (jpeg.length > 380_000) {
        setError("Processed image still too large — try another photo.");
        setBusy(false);
        return;
      }
      setSrc(jpeg);
      persist(jpeg);
    } catch {
      setError("Could not read that image.");
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setSrc(null);
    persist(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  if (!mounted) {
    return (
      <div className="flex items-start gap-5">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--muted)]">
          <UserRound className="h-10 w-10 text-[var(--muted-foreground)]" />
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">Loading profile…</p>
      </div>
    );
  }

  const initials =
    MOCK_USER.displayName
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="relative shrink-0">
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={(e) => onPickFile(e.target.files)}
        />
        <div
          className={cn(
            "relative flex h-28 w-28 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--muted)] shadow-inner sm:h-32 sm:w-32",
          )}
        >
          {busy ? (
            <div className="flex flex-1 items-center justify-center bg-[var(--card)]">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-2 text-center">
              <span className="font-[family-name:var(--font-space)] text-lg font-bold tracking-tight text-[var(--muted-foreground)]">
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
            Demo: stored as a thumbnail in your browser until the API persists to R2.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={inputId}
            className={cn(
              "inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--muted)]",
              busy && "pointer-events-none opacity-50",
            )}
          >
            <ImagePlus className="h-4 w-4" />
            {src ? "Change photo" : "Upload image"}
          </label>
          {src ? (
            <button
              type="button"
              onClick={clear}
              className="rounded-xl border border-[var(--border)] bg-transparent px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]"
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
