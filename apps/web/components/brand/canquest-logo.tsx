"use client";

import Image from "next/image";
import Link from "next/link";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils";

/** Canonical asset size — matches `public/canquest-logo.svg` (600×180) */
export const CANQUEST_LOGO_WIDTH = 600;
export const CANQUEST_LOGO_HEIGHT = 180;
export const CANQUEST_LOGO_ASPECT = CANQUEST_LOGO_WIDTH / CANQUEST_LOGO_HEIGHT;

const LOCKUP_SRC = "/canquest-logo.svg";

/**
 * Display sizes — height drives width via aspect ratio (10∶3 lockup).
 * maxWidth caps growth in tight nav rows.
 */
const sizes = {
  xs: { height: 20, maxWidth: 68 },
  /** Compact rows (still readable) */
  sm: { height: 28, maxWidth: 94 },
  /** Mobile platform / landing header */
  md: { height: 34, maxWidth: 114 },
  /** Sidebar & desktop nav */
  lg: { height: 42, maxWidth: 140 },
  /** Footer / hero */
  xl: { height: 56, maxWidth: 187 },
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
