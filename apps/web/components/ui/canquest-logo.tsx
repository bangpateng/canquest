"use client";

import Image from "next/image";
import Link from "next/link";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils/utils";

/**
 * Canonical asset size — `public/canquest-logo.svg` viewBox is `0 45 600 95`,
 * cropped to the wordmark's true ink bounds (ink y:[53,132], vertical center
 * 92.5) so the text sits perfectly centered in the box. The earlier
 * `0 40 600 90` crop left the wordmark off-center, which made the logo sit
 * higher/lower than adjacent header badges.
 */
export const CANQUEST_LOGO_WIDTH = 600;
export const CANQUEST_LOGO_HEIGHT = 95;
export const CANQUEST_LOGO_ASPECT = CANQUEST_LOGO_WIDTH / CANQUEST_LOGO_HEIGHT;

const LOCKUP_SRC = "/canquest-logo.svg";

/**
 * Display sizes — height drives width via the SVG aspect ratio (600:95 ≈ 6.32).
 * Heights target standard web conventions for each placement so the lockup is
 * not oversized next to adjacent icons/controls:
 *   - headers (`h-16` ≈ 64px)  → logo height ~24px (about 1/3 of the bar)
 *   - desktop sidebar / footer → ~28px
 * maxWidth caps the rendered width so tight rows (mobile headers) never reserve
 * more horizontal space than the wordmark needs. If a placement feels too
 * small/large, bump its `height` here rather than overriding width at call sites.
 */
const sizes = {
  xs: { height: 16, maxWidth: 101 },
  /** Compact rows (inline, breadcrumbs) */
  sm: { height: 20, maxWidth: 126 },
  /** Headers — landing & platform (`h-16`), footer */
  md: { height: 24, maxWidth: 152 },
  /** Desktop sidebar / desktop nav */
  lg: { height: 28, maxWidth: 177 },
  /** Hero / large feature */
  xl: { height: 36, maxWidth: 228 },
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
        "inline-flex w-fit max-w-full items-center justify-start text-[var(--foreground)]",
        href || onClick ? "transition-opacity hover:opacity-90" : "",
        className,
      )}
    >
      <Image
        src={LOCKUP_SRC}
        alt="CanQuest"
        width={width}
        height={height}
        sizes={`(max-width: 640px) 100vw, ${maxWidth}px`}
        className={cn(
          /* width is capped at the natural max, but `min-w-0 max-w-full`
             lets the wordmark shrink to fit narrow mobile headers instead of
             overflowing/being cut off. `h-auto` + `max-h` keeps the target
             visual height when there is room. */
          "block h-auto w-auto min-w-0 max-w-full max-h-[var(--logo-h)] object-contain object-left",
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
        className="inline-flex w-fit max-w-full min-w-0 justify-start self-start"
      >
        {inner}
      </Link>
    );
  }

  return inner;
}
