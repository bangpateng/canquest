import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils/utils";

/**
 * Landing image slot — drop-in placeholder that you fill later.
 *
 * HOW TO USE:
 *   1. Put your screenshot in `apps/web/public/landing/` (e.g. `hero.png`).
 *   2. Pass `src="/landing/hero.png"`.
 *   3. That's it. While `src` is empty, an elegant placeholder is shown.
 *
 * No need to edit next.config.ts for images in /public — Next serves them
 * directly. Aspect ratio is controlled by `ratio` (height derived from width).
 *
 * `alt` is required for accessibility once you add a real image.
 */

type Ratio = "16/10" | "16/9" | "4/3" | "1/1" | "3/2";

const RATIO_PADDING: Record<Ratio, string> = {
  "16/10": "62.5%",
  "16/9": "56.25%",
  "4/3": "75%",
  "1/1": "100%",
  "3/2": "66.67%",
};

type LandingImageProps = {
  /** Path under /public, e.g. "/landing/hero.png". Empty = placeholder. */
  src?: string;
  alt?: string;
  ratio?: Ratio;
  className?: string;
  /** Show the "Replace me" hint on the placeholder. Default true. */
  showHint?: boolean;
};

export function LandingImage({
  src,
  alt = "",
  ratio = "16/10",
  className,
  showHint = true,
}: LandingImageProps) {
  return (
    <div
      className={cn(
        "gradient-hairline relative w-full overflow-hidden rounded-2xl ring-1 ring-[var(--border)]",
        className,
      )}
    >
      <div
        className="relative w-full"
        style={{ paddingBottom: RATIO_PADDING[ratio] }}
      >
        {src ? (
          <Image
            src={src}
            alt={alt}
            fill
            sizes="(max-width: 768px) 100vw, 960px"
            className="object-cover"
            priority={false}
          />
        ) : (
          // Placeholder — shown until you drop a real src
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
            style={{
              background:
                "radial-gradient(ellipse 70% 70% at 50% 30%, rgb(var(--canton-rgb) / 0.10), transparent 70%), var(--card)",
            }}
            aria-hidden
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/15">
              <ImageIcon className="h-5 w-5 text-canton" />
            </span>
            {showHint ? (
              <div className="px-4">
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  Add your screenshot
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  public/landing · {ratio} recommended
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
