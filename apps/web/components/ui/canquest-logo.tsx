"use client";

import Image from "next/image";
import Link from "next/link";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils/utils";

/**
 * Canonical asset size. `public/canquest-logo.svg` was re-cropped to the true
 * wordmark bounds: the glyphs span x[48.4, 596.5] on the original 600×180
 * canvas, so the prior `viewBox="0 40 600 90"` left a ~48px dead-zone on the
 * LEFT that made the lockup sit off-center ("jomplang") inside centered
 * wrappers, and clipped the gradient tail of the "Q" by ~2.6px at the bottom.
 * The viewBox is now `42 46 558 90` (left dead-zone removed, ~6px more at the
 * bottom so the accent is fully visible), giving an honest aspect of 558/90.
 */
export const CANQUEST_LOGO_WIDTH = 558;
export const CANQUEST_LOGO_HEIGHT = 90;
export const CANQUEST_LOGO_ASPECT = CANQUEST_LOGO_WIDTH / CANQUEST_LOGO_HEIGHT;

const LOCKUP_SRC = "/canquest-logo.svg";

/**
 * Display sizes — height drives width via the aspect ratio above, and
 * `maxWidth` is clamped to that computed width so tight rows (mobile headers,
 * sidebars) never reserve more horizontal space than the wordmark needs. This
 * keeps the logo from rendering oversized next to adjacent header icons.
 */
const sizes = {
  xs: { height: 16, maxWidth: 99 },
  /** Compact rows (still readable) */
  sm: { height: 20, maxWidth: 124 },
  /** Mobile platform / landing header */
  md: { height: 24, maxWidth: 149 },
  /** Sidebar & desktop nav */
  lg: { height: 28, maxWidth: 174 },
  /** Footer / hero */
  xl: { height: 36, maxWidth: 223 },
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
