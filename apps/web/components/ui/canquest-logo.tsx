"use client";

import Image from "next/image";
import Link from "next/link";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils/utils";

/**
 * Canonical asset size — taken directly from the SVG's real bounding box
 * (`getBBox()` → x≈3.42, y=0, w≈593, h=180). The wordmark fills the full
 * height of the box, so NO vertical cropping is needed. A previous version
 * cropped the viewBox to `0 40 600 90`, which sliced ~40px off the top and
 * ~50px off the bottom of the glyphs (making the logo look broken) and used
 * a wrong 6.67:1 aspect instead of the true ~3.29:1. The SVG viewBox should
 * be `3.42 0 593.14 180` to match these values.
 */
export const CANQUEST_LOGO_WIDTH = 593;
export const CANQUEST_LOGO_HEIGHT = 180;
export const CANQUEST_LOGO_ASPECT = CANQUEST_LOGO_WIDTH / CANQUEST_LOGO_HEIGHT; // ≈ 3.29

const LOCKUP_SRC = "/canquest-logo.svg";

/**
 * Display sizes — height drives width via aspect ratio. With the corrected
 * ~3.29:1 box, rendered width per unit height is roughly half of the old
 * (broken) values, so the maxWidth caps below are generous and effectively
 * never clip; they remain only as a safety ceiling for very tight rows.
 * If a size feels too small, bump its `height` rather than touching maxWidth.
 */
const sizes = {
  xs: { height: 18, maxWidth: 120 },
  /** Compact rows (still readable) */
  sm: { height: 24, maxWidth: 160 },
  /** Mobile platform / landing header */
  md: { height: 28, maxWidth: 188 },
  /** Sidebar & desktop nav */
  lg: { height: 34, maxWidth: 227 },
  /** Footer / hero */
  xl: { height: 44, maxWidth: 294 },
} as const;

type CanQuestLogoProps = {
  size?: keyof typeof sizes;
  href?: string;
  className?: string;
  onClick?: () => void;
};

export function CanQuestLogo({
  size = "md",
  href,
  className,
  onClick,
}: CanQuestLogoProps) {
  const { theme } = useTheme();
  const { height, maxWidth } = sizes[size];
  const width = Math.round(height * CANQUEST_LOGO_ASPECT);

  const inner = (
    <span
      className={cn(
        "inline-flex w-fit max-w-full shrink-0 items-center justify-start text-[var(--foreground)]",
        href || onClick ? "transition-opacity hover:opacity-90" : "",
        className,
      )}
    >
      <Image
        src={LOCKUP_SRC}
        alt="CanQuest"
        width={width}
        height={height}
        sizes={`(max-width: 640px) ${maxWidth}px, ${maxWidth}px`}
        className={cn(
          "block h-auto max-h-[var(--logo-h)] w-auto max-w-[var(--logo-max-w)] object-contain object-left",
          /* Wordmark is white in SVG — invert for readability on light theme */
          theme === "light" && "brightness-0",
        )}
        style={
          {
            "--logo-h": `${height}px`,
            "--logo-max-w": `${maxWidth}px`,
          } as React.CSSProperties
        }
        priority={size === "md" || size === "lg"}
      />
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className="inline-flex w-fit max-w-full shrink-0 justify-start self-start"
      >
        {inner}
      </Link>
    );
  }

  return inner;
}
