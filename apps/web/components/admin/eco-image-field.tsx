"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Trash2, Upload, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

type EcoAsset = {
  filename: string;
  url: string;
  size: number;
  lastModified: string;
};

const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[rgb(111_230_0/0.45)]";

/**
 * Field gambar ecosystem — input URL + Upload file + Browse gallery (hapus).
 * Dipakai untuk logo partner & foto team di panel admin.
 */
export function EcoImageField({
  label,
  value,
  onChange,
  placeholder,
  compact,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [assets, setAssets] = useState<EcoAsset[] | null>(null);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/uploads/ecosystem", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => null)) as
        | { url?: string; message?: string }
        | null;
      if (!res.ok || !data?.url) {
        setError(data?.message ?? `Upload failed (HTTP ${res.status})`);
        return;
      }
      onChange(data.url);
    } catch {
      setError("Upload failed — check your connection.");
    } finally {
      setUploading(false);
    }
  };

  const loadAssets = async () => {
    setAssets(null);
    try {
      const res = await fetch("/api/admin/uploads/ecosystem", {
        cache: "no-store",
      });
      setAssets(res.ok ? await res.json() : []);
    } catch {
      setAssets([]);
    }
  };

  useEffect(() => {
    if (browseOpen && assets === null) void loadAssets();
  }, [browseOpen, assets]);

  const remove = async (asset: EcoAsset) => {
    if (
      !window.confirm(
        `Delete "${asset.filename}" from storage? Images using it will fall back to initials.`,
      )
    )
      return;
    setBusyFile(asset.filename);
    const res = await fetch("/api/admin/uploads/ecosystem", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: asset.filename }),
    });
    setBusyFile(null);
    if (res.ok) {
      if (value === asset.url) onChange("");
      void loadAssets();
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          onClick={() => setBrowseOpen(true)}
          className="text-[11px] font-semibold text-canton hover:underline"
        >
          Browse
        </button>
      </div>

      <div className={cn("flex gap-2", compact ? "items-center" : "items-stretch")}>
        <input
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "https://… atau upload"}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className={cn(
            buttonVariants({ variant: "secondary", size: "sm" }),
            "shrink-0 gap-1.5",
          )}
        >
          {uploading ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          Upload
        </button>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg border border-[var(--border)] object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-[var(--muted-foreground)]">
            <ImageIcon className="h-4 w-4" />
          </span>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />

      {error && <p className="text-xs text-red-500">{error}</p>}

      {browseOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(13_20_32/0.4)] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBrowseOpen(false);
          }}
        >
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold">Ecosystem images</h3>
              <button
                type="button"
                onClick={() => setBrowseOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {assets === null ? (
              <div className="flex min-h-[160px] items-center justify-center">
                <LoadingSpinner size="2xl" />
              </div>
            ) : assets.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">
                No images yet — upload one first via the Upload button.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {assets.map((a) => (
                  <div
                    key={a.filename}
                    className={cn(
                      "group relative overflow-hidden rounded-xl border transition-colors",
                      value === a.url
                        ? "border-[rgb(111_230_0/0.45)]"
                        : "border-[var(--border)] hover:border-[rgb(111_230_0/0.35)]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onChange(a.url);
                        setBrowseOpen(false);
                      }}
                      className="block aspect-square w-full bg-[var(--background)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.url}
                        alt={a.filename}
                        className="h-full w-full object-contain p-2"
                        loading="lazy"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(a)}
                      disabled={busyFile === a.filename}
                      title="Delete image"
                      className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--card)]/90 text-red-500 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                    >
                      {busyFile === a.filename ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
