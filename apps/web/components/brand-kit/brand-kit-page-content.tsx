"use client";

import { Check, Copy, Download } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { LandingShell } from "@/components/landing/landing-shell";
import { cn } from "@/lib/utils/utils";

/* ── Brand tokens (mirror globals.css so the kit stays in sync with the product) ── */
type BrandColor = {
  name: string;
  /** Hex used in the dark product theme (CanQuest default) */
  dark: string;
  /** Matching light-theme value */
  light: string;
  /** CSS variable consumed across the app */
  token?: string;
  /** One-line usage note */
  usage: string;
};

const COLORS: BrandColor[] = [
  {
    name: "Canton Green",
    dark: "#5AD98A",
    light: "#38B478",
    token: "--primary / rgb(var(--canton-rgb))",
    usage: "Primary actions, links, focus rings, brand accents.",
  },
  {
    name: "Canton Ink",
    dark: "#B8F0D4",
    light: "#166534",
    token: "rgb(var(--canton-ink))",
    usage: "Brand text and the primary-on-dark wordmark glow.",
  },
  {
    name: "Accent Cyan",
    dark: "#5EEAD4",
    light: "#0D9488",
    token: "--accent",
    usage: "Secondary accents, tags, and highlights.",
  },
  {
    name: "Background",
    dark: "#07080D",
    light: "#F4F6FA",
    token: "--background",
    usage: "App canvas. Default theme is dark.",
  },
  {
    name: "Foreground",
    dark: "#EDEEF2",
    light: "#0F1117",
    token: "--foreground",
    usage: "Body text and headings.",
  },
  {
    name: "Muted Foreground",
    dark: "#6B6E7B",
    light: "#5C6070",
    token: "--muted-foreground",
    usage: "Secondary text, captions, and metadata.",
  },
];

type LogoAsset = {
  /** Public path served from /public */
  src: string;
  label: string;
  /** Short descriptor shown under the label */
  hint: string;
  /** Rendered on a dark or light chip so the lockup stays legible */
  chip: "dark" | "light";
};

/* Official logo variants — keep file names in sync with /public/brand-kit */
const LOGO_ASSETS: LogoAsset[] = [
  {
    src: "/brand-kit/canquest-transparant.png",
    label: "Primary wordmark",
    hint: "White on transparent · use on dark/photo backgrounds",
    chip: "dark",
  },
  {
    src: "/brand-kit/canquest-black.png",
    label: "Reversed wordmark",
    hint: "Black on transparent · use on light backgrounds",
    chip: "light",
  },
  {
    src: "/brand-kit/canquest-white.png",
    label: "On-dark wordmark",
    hint: "White on solid black · social & banner previews",
    chip: "dark",
  },
  {
    src: "/brand-kit/canquest-black-bulet.png",
    label: "App mark / badge",
    hint: "Gradient icon · favicon, avatar, app tile",
    chip: "dark",
  },
];

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard may be unavailable (insecure context) — silently no-op */
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      aria-label={`${label} ${value}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[var(--primary)]" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

function BrandSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-b border-[var(--border)] py-10 last:border-b-0 md:py-12"
    >
      <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)] sm:text-xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted-foreground)]">
          {description}
        </p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Swatch({ color }: { color: BrandColor }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div
        className="flex h-20 items-end justify-end p-2"
        style={{ backgroundColor: color.dark }}
      >
        <CopyButton value={color.dark} label={color.dark} />
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--foreground)]">{color.name}</p>
          <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
            {color.light}
          </span>
        </div>
        {color.token ? (
          <p className="font-mono text-[11px] text-[var(--muted-foreground)]">{color.token}</p>
        ) : null}
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{color.usage}</p>
      </div>
    </div>
  );
}

function LogoPreview({ asset }: { asset: LogoAsset }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div
        className={cn(
          "flex min-h-36 items-center justify-center p-6",
          asset.chip === "dark"
            ? "bg-[var(--background)]"
            : "bg-[var(--muted)]",
        )}
      >
        <Image
          src={asset.src}
          alt={`CanQuest ${asset.label}`}
          width={260}
          height={36}
          className="h-auto w-auto max-w-[260px] object-contain"
        />
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--foreground)]">{asset.label}</p>
          <a
            href={asset.src}
            download
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <Download className="h-3.5 w-3.5" />
            PNG
          </a>
        </div>
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{asset.hint}</p>
      </div>
    </div>
  );
}

export function BrandKitPageContent() {
  return (
    <div className="border-b border-[var(--border)]">
      <LandingShell className="py-10 pb-16 md:py-12">
        <header className="mb-8 max-w-2xl">
          <p className="type-eyebrow-brand">Brand Kit</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
            CanQuest Brand Kit
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
            Logos, colors, and type for press, partners, and community creators. Use
            these assets as-is — keep the wordmark legible and never recolor the lockup
            outside the palette below.
          </p>
        </header>

        <BrandSection
          id="logo"
          title="Logo"
          description="The default lockup is white-on-dark. Choose the variant that keeps the wordmark legible against its background — never place it over busy imagery."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LOGO_ASSETS.map((asset) => (
              <LogoPreview key={asset.src} asset={asset} />
            ))}
          </div>
        </BrandSection>

        <BrandSection
          id="colors"
          title="Colors"
          description="CanQuest ships dark-first. Each swatch shows the dark value (tap to copy) with its light-theme counterpart underneath."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {COLORS.map((color) => (
              <Swatch key={color.name} color={color} />
            ))}
          </div>
        </BrandSection>

        <BrandSection
          id="typography"
          title="Typography"
          description="Inter carries the UI; Space Grotesk is reserved for display headings."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
              <p className="type-eyebrow text-[var(--muted-foreground)]">UI / Body</p>
              <p
                className="mt-2 text-2xl font-semibold text-[var(--foreground)]"
                style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}
              >
                Inter
              </p>
              <p
                className="mt-2 text-sm text-[var(--muted-foreground)]"
                style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}
              >
                Aa Bb Cc 0123 — Quests, rewards, and verified humans on Canton.
              </p>
              <div className="mt-3">
                <CopyButton value="Inter" label="Font name" />
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
              <p className="type-eyebrow text-[var(--muted-foreground)]">Display</p>
              <p
                className="mt-2 text-2xl font-semibold text-[var(--foreground)]"
                style={{ fontFamily: "var(--font-space), system-ui, sans-serif" }}
              >
                Space Grotesk
              </p>
              <p
                className="mt-2 text-sm text-[var(--muted-foreground)]"
                style={{ fontFamily: "var(--font-space), system-ui, sans-serif" }}
              >
                Aa Bb Cc 0123 — Headings and hero typography.
              </p>
              <div className="mt-3">
                <CopyButton value="Space Grotesk" label="Font name" />
              </div>
            </div>
          </div>
        </BrandSection>

        <BrandSection
          id="usage"
          title="Usage guidelines"
        >
          <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
            <li>
              • Keep clear space around the wordmark equal to the height of the{" "}
              <span className="font-medium text-[var(--foreground)]">C</span> glyph.
            </li>
            <li>
              • Don&apos;t stretch, rotate, or add effects (shadows, outlines) to the
              lockup.
            </li>
            <li>
              • Don&apos;t recolor the logo outside the official palette above.
            </li>
            <li>
              • Minimum wordmark height: <span className="font-medium text-[var(--foreground)]">16px</span>{" "}
              on screen.
            </li>
            <li>
              • For print or merchandise, request a vector source via the Cooperation page.
            </li>
          </ul>
        </BrandSection>
      </LandingShell>
    </div>
  );
}
