"use client";

import Image from "next/image";
import Link from "next/link";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils/utils";

/**
 * Canonical asset size — `public/canquest-logo.svg` viewBox was cropped to
 * `0 40 600 90` to remove the large vertical whitespace above/below the
 * wordmark (it sat low in a 180px box, looking misaligned with adjacent
 * header icons). The drawn content now fills the box, so the wordmark centers
 * cleanly.
 */
export const CANQUEST_LOGO_WIDTH = 600;
export const CANQUEST_LOGO_HEIGHT = 90;
export const CANQUEST_LOGO_ASPECT = CANQUEST_LOGO_WIDTH / CANQUEST_LOGO_HEIGHT;

const LOCKUP_SRC = "/canquest-logo.svg";

/**
 * Display sizes — height drives width via aspect ratio. The SVG box is now
 * cropped to the wordmark (~6.67:1), so the width per unit height is larger
 * than before. maxWidth caps growth so the logo fits tight rows (mobile
 * headers) while keeping the target visual height.
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
          /* Wordmark is white in SVG — readable on light platform theme */
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
